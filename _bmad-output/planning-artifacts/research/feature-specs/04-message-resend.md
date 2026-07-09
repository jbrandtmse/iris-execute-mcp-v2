# Spec 04 — `iris_message_resend`: Interoperability Message Resend / Replay

**Server:** `@iris-mcp/interop` (package tool) | **Priority:** 4 (strategic, core market) | **Effort:** ~4 stories
**Governance:** per-action map — `preview: "read"`, `resend: "write"`, `resendFiltered: "write"`;
writes **default-disabled** (do NOT use `defaultEnabled` — resend duplicates clinical data flow;
it is not a recovery-of-last-resort like `clean`)
**Prereqs:** none | **Read first:** [`00-conventions.md`](00-conventions.md),
`src/ExecuteMCPv2/REST/Interop.cls` (message-query + production-control patterns, incl. the
Epic-20 `confirm` double-gate), `packages/iris-interop-mcp/src/tools/` (messages + control tools),
`irislib/Ens/MessageHeader.cls`, `irislib/EnsPortal/MessageResend.cls` (SMP's own resend plumbing)

## 1. Objective

Complete the interop troubleshooting loop. The suite can find, trace, and diagram a failed
message — then abandons the engineer at "go to the Management Portal to resend." This tool
resends messages by header ID (single/small batch) or by bounded filter (item + status + time
window), with dry-run counts and confirmation gates. No MCP competitor offers this; it is the
highest-frequency interop write in real production support.

## 2. MANDATORY Story 0 — API probe (Rule #16) — RESOLVED (Story 26.0, 2026-07-09)

Story 26.0 completed the source-read + live probe. Full findings (pinned API table +
observed-semantics detail) are recorded in
`_bmad-output/implementation-artifacts/26-0-resend-api-probe.md` → Dev Agent Record. Summary
folded into §3/§4 below; Stories 26.1+ build against the pinned API, not the original
candidate-name guesses.

<details><summary>Original probe brief (superseded by the findings above/below; kept for
historical context)</summary>

1. Read `irislib/EnsPortal/MessageResend.cls` (and `EnsPortal.MessageResendEdit` if present) —
   this is what the SMP button actually calls. Trace to the underlying
   `Ens.MessageHeader` / `Ens.MessageHeaderBase` method family (candidates:
   `ResendDuplicatedMessage`, resubmit variants — pin the real names, signatures, and
   return values from source, not memory).
2. Build a disposable `ExecuteMCPv2.Temp.ResendProbe` class; on a scratch production
   (create/start one via existing tools if needed) send a test message, then probe:
   - resend of a completed message (does it create a NEW header? capture new header ID),
   - resend of an errored message,
   - resend targeting a stopped/absent item (error shape),
   - whether the production must be running for resend to succeed,
   - behavior when the message body class no longer exists.
3. Amend §3/§4 of this spec with pinned signatures + observed semantics. Delete probe class
   and scratch artifacts. **If the probe reveals resend requires the production running, add
   that as a validated precondition returning a clear error.**

</details>

## 3. Tool contract

```
name:  iris_message_resend
scope: "NS"
annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
mutates: { preview: "read", resend: "write", resendFiltered: "write" }
```

**Actions:**

| Action | Params | Behavior |
|---|---|---|
| `preview` | `headerIds: string[]` (1–100) | Read-only: per header — id, session, source/target item, status, time, body classname, body summary (first ~1KB, sanitized), resendable verdict + reason. Never mutates. |
| `resend` | `headerIds: string[]` (1–100), `namespace?` | Resend each listed header. Per-header result: `{originalId, newHeaderId?, ok, error?}`. Partial failures do not abort the batch; summary counts returned. |
| `resendFiltered` | `item: string` (required), `status?: enum[Errored\|Discarded\|Suspended\|...]` (default `Errored`), `from: string` (required, ISO or $HOROLOG-accepted), `to?: string` (default now), `maxMessages?: number` (default 100, **hard cap 500**), `dryRun?: boolean` (**default true**), `confirm?: boolean`, `namespace?` | Enumerates matching headers via the same query plumbing as `iris_production_messages`. `dryRun:true` (default) returns the count + first 20 header summaries and resends NOTHING. Executing requires `dryRun:false` AND `confirm:true` — otherwise REFUSED with an explanatory error (Epic-20 `killAppData` double-gate pattern). |

**Guards (all enforced ObjectScript-side, before any mutation):**
- Header IDs must be numeric — reject otherwise (input hygiene, Rule #29 spirit).
- `resendFiltered` REQUIRES `item` and `from` (bounded scope — Rule #38: no "resend everything").
  Window wider than 7 days → refused with guidance.
- Count > `maxMessages` cap → refused (not truncated-and-executed), telling the caller to
  narrow the window; the refusal names the count found.
- Every refusal returns the standard error envelope with `result:{}` and mutates nothing —
  each is a live-smoke assertion (Rule #26).

**Output notes (CORRECTED — Story 26.0, AC 26.0.4):** the original claim here ("reuse the
existing `horologToIso` helper in the interop package") is **wrong** — `grep -r horolog
packages/iris-interop-mcp/src/` returns zero matches; no such helper exists in this package.
The only `horologToIso` in the monorepo is package-local to `packages/iris-data-mcp/src/tools/analytics.ts`
(not published via `@iris-mcp/shared`), used to convert a RAW `$HOROLOG` string returned
directly by a non-SQL system API. It does not apply here: this tool's timestamps come from
`SELECT ... TimeCreated FROM Ens.MessageHeader` (the same query plumbing as
`iris_production_messages`/`Interop.cls:1036-1062`), and SQL SELECT of `Ens.DataType.UTC`
(a `%TimeStamp`-based type) already returns an ODBC-formatted string (e.g.
`"2026-07-02 10:00:01.298"`) — never raw `$HOROLOG`. No client-side horolog conversion is
needed. If ISO-8601 `T`/`Z` formatting is wanted for consistency, Story 26.2 should write a
small local transform in `message-resend.ts` (`" " → "T"`, append `"Z"`) rather than importing
a nonexistent helper; preserve the raw ODBC string in a `*Raw` field alongside it per Rule #11's
spirit.

## 4. ObjectScript work

New routes in `Dispatch.cls`: `POST /interop/message/resend`, `POST /interop/message/resend/preview`.
Handler methods in `Interop.cls` (or new `MessageResend.cls` if Interop.cls is at size limit —
**recommended**: `Interop.cls` is already 2485 lines, near practical size limits per Story 26.0
Dev Notes; put the new handlers in a NEW `src/ExecuteMCPv2/REST/MessageResend.cls`).

### Pinned resend API (Story 26.0, from `irislib/Ens/MessageHeader.cls`)

The SMP "Resend" button (`irislib/EnsPortal/MessageResend.cls:370`, `ReallyResend()`) calls:

```objectscript
Set tSC = ##class(Ens.MessageHeader).ResendDuplicatedMessage(tMsgId, .tNewHeaderId, pNewTarget, , , pHeadOfQueue)
```

Pinned signature — **this is the ONLY API `iris_message_resend` should call** for the `resend`/
`resendFiltered` actions:

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

- Returns `%Status`; the new header id is an `Output` argument, not the return value.
- Clones the original header (`%ConstructClone`), enqueues the clone (`Ens.Queue.EnQueue`),
  audits via `$$$AuditResendMessage`. New header keeps the SAME `SessionId`; `Description` is
  annotated `"Resent <originalId>"` — this is the only structural linkage back to the original
  (the `Resent` property on `Ens.MessageHeaderBase` is NOT set by this call — do not rely on
  it). v1 handler should capture `{originalId, newHeaderId}` pairs itself rather than relying
  on any header field to reconstruct linkage later.
- `pNewTarget`/`pNewBody`/`pNewSource`/`pHeadOfQueue` map directly to v1's out-of-scope
  edit-and-resend inputs — v1 (`resend`/`resendFiltered`) always passes them empty/default;
  only `pOriginalHeaderId` and `pHeadOfQueue` (defaulted `0`) are used.
- **Do NOT use** `Ens.MessageHeader.ResubmitMessage`/`PrepareResubmitMessage` — different
  method family (in-place resubmit of the SAME header, not a new one); not what the SMP button
  calls; has an inconsistent production-not-running error shape. `ResendMessage(pHeaderId)` is
  `[Internal, Deprecated]` (passthrough to `ResubmitMessage`) — do not use either.

### Observed semantics (Story 26.0 live probe, HSCUSTOM `SessionAgent.Sample.Production`)

Full detail in the story's Dev Agent Record; load-bearing points for the handler:

1. **Production-must-be-running precondition — CONFIRMED, validate explicitly.**
   `ResendDuplicatedMessage` fails with `<Ens>ErrProductionNotRunning: No production is
   running` (macro `$$$EnsErrProductionNotRunning` = `"<Ens>ErrProductionNotRunning"`,
   `EnsErrors.inc:126`) when no production is running; `pNewHeaderId` stays empty (no write).
   The handler should either trust this returned status directly (it's already a clean,
   caret-free message — safe through `SanitizeError`, Rule #33) or pre-check
   `##class(Ens.Director).IsProductionRunning()` and return a validated precondition error
   before calling resend, per §2's original ask. Recommendation: pre-check for a faster/clearer
   refusal, since a `resendFiltered` batch would otherwise attempt N calls that all fail the
   same way.
2. **Stopped/absent target item** (bad `pNewTarget`, or original `TargetConfigName` no longer
   resolves a queue) → clean refusal: `<Ens>ErrGeneral: Target config item '<name>' is not
   running`; `pNewHeaderId` empty (no write). No special handling needed — surface the status
   text as-is.
3. **Resend of a completed Request-type message** succeeds and re-enters the FULL downstream
   pipeline from that hop (not a single-hop retry) — expected/desired behavior for `resend`.
4. **"Errored message" ambiguity — important for `preview`'s resendability verdict.**
   Resending the **Response**-type header carrying `IsError=true` (the error payload FROM a
   failed operation) technically succeeds but is typically a no-op (delivered with
   `Status=Discarded` since the original correlation is gone) — not useful for retry. Resending
   the **Request**-type header with `Status=Error(8)` (the request TO the failing host) is the
   semantically correct "retry" target and reproduces the original failure/success outcome.
   `preview`'s resendability verdict/reason should steer toward Request-type, Status=Error
   headers, and flag Response-type error headers as "resendable but likely a no-op" or exclude
   them from the default `resendFiltered status:Errored` semantics — clarify with product
   before 26.2/26.1 land the exact wording.
5. **Message body class no longer exists — resend succeeds regardless; downstream failure is
   invisible on the header.** `MessageBodyClassName`/`MessageBodyId` are plain `%String`
   properties, never opened during resend, so a missing body class does NOT block
   `ResendDuplicatedMessage`. The redelivered header IS still routed to its target, and if the
   target opens the body (most do), it throws `<CLASS DOES NOT EXIST>` — logged ONLY to the
   Ensemble Event Log (`Ens_Util.Log`), NOT reflected in `Ens.MessageHeader.Status`/`IsError`
   (both stayed clean in the probe). **`preview` should independently verify
   `MessageBodyClassName` exists** (e.g. `$$$comClassDefined(tClassName)` or
   `##class(%Dictionary.CompiledClass).%ExistsId(tClassName)`) and flag it in the resendability
   verdict/reason, since neither the resend call nor the post-resend header state will surface
   this failure mode.

- Batch enumeration for `resendFiltered`: reuse/extract the message-query SQL already used by
  the production-messages handler (same filters: item, status, time window) — do not write a
  second divergent query.
- Resend call per the pinned API above; capture the new header ID linkage in the handler's own
  response payload (not from any header field — see point 1 above).
- Error text: SanitizeError; no caret-globals (Rule #33) — note `<Ens>ErrProductionNotRunning`
  and `<Ens>ErrGeneral: Target config item ... is not running` both use angle brackets, not
  carets, so they pass through `SanitizeError` unmodified.
- `%UnitTest` coverage: guard refusals (missing confirm, over-cap, unbounded window, bad id),
  preview shape (including the body-class-existence check and the Request-vs-Response
  resendability distinction), and (against the scratch production) a real single resend +
  linkage.

## 5. TypeScript work

`packages/iris-interop-mcp/src/tools/message-resend.ts` per conventions §2. Description MUST
state: what each action does, that `resend`/`resendFiltered` are **default-disabled by
governance** (with the `IRIS_GOVERNANCE` snippet to enable), the dry-run-first workflow, the
caps, and the duplication hazard ("resending a processed message delivers its data again
downstream"). Unit tests: schema validation, guard-refusal envelope passthrough, result
mapping, timestamp pass-through/ISO formatting (CORRECTED — Story 26.0, AC 26.0.4: no
`horologToIso` helper exists or is needed here; see §3 "Output notes").

## 6. Story breakdown

1. **Story 0 — probe (0.5):** §2 above; spec amended with pinned API.
2. **Story 1 — ObjectScript (1):** routes + handlers + guards + unit tests; deploy loop +
   bootstrap regen.
3. **Story 2 — TS tool (1):** tool + registration + counts + unit tests.
4. **Story 3 — docs + smokes (1):** docs rollup (Rule #30 — write actions default-disabled
   stated everywhere); live smokes: single resend of a disposable test message on the scratch
   production (verify new header via `iris_production_messages`); rejection smokes —
   `resendFiltered` without `confirm` REFUSED, over-cap REFUSED, unbounded window REFUSED,
   governance-disabled write REFUSED when not enabled (all no-write verified); second
   interop-enabled namespace smoke (Rule #34) or explicit residual-risk note.

## 7. Acceptance criteria

1. Story-0 probe findings documented in the story file; probe classes deleted.
2. `preview` returns resendability verdicts without mutating anything.
3. Single `resend` of a test message succeeds and returns the new header ID; the new message
   is visible in the trace tools.
4. Batch `resendFiltered` in dry-run returns count + sample and resends nothing (verified by
   message counts before/after).
5. All four guard refusals verified LIVE with no-write integrity (Rule #26).
6. Writes default-disabled under empty `IRIS_GOVERNANCE`; enabling via policy works;
   `preview` enabled by default (unit tests over the policy engine).
7. Partial batch failure reports per-header errors and continues.
8. Docs state the duplication hazard + default-disabled status on all four doc surfaces.
9. Conventions §6 checklist complete.

## 8. Out of scope (v1)

- Edit-and-resend (modify body before resend) — follow-up feature after v1 telemetry.
- Cross-namespace batch resend; resend scheduling/throttling.
- Automatic root-cause classification of why messages errored (Spec 03's trace prompt covers
  the workflow).
