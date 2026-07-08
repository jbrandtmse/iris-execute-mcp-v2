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

## 2. MANDATORY Story 0 — API probe (Rule #16)

The exact resend API is **unverified**. Before ANY spec-driven coding:

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

**Output notes:** timestamps converted to ISO 8601 with `*Raw` preserved (Rule #11 — reuse the
existing `horologToIso` helper in the interop package).

## 4. ObjectScript work

New routes in `Dispatch.cls`: `POST /interop/message/resend`, `POST /interop/message/resend/preview`.
Handler methods in `Interop.cls` (or new `MessageResend.cls` if Interop.cls is at size limit):

- Standard skeleton (conventions §3): validate ALL inputs → resolve namespace → per-message
  Try/Catch so one bad header doesn't abort the batch → single render.
- Batch enumeration for `resendFiltered`: reuse/extract the message-query SQL already used by
  the production-messages handler (same filters: item, status, time window) — do not write a
  second divergent query.
- Resend call per pinned Story-0 API; capture the new header ID linkage.
- Error text: SanitizeError; no caret-globals (Rule #33); include the per-header reason.
- `%UnitTest` coverage: guard refusals (missing confirm, over-cap, unbounded window, bad id),
  preview shape, and (against the scratch production) a real single resend + linkage.

## 5. TypeScript work

`packages/iris-interop-mcp/src/tools/message-resend.ts` per conventions §2. Description MUST
state: what each action does, that `resend`/`resendFiltered` are **default-disabled by
governance** (with the `IRIS_GOVERNANCE` snippet to enable), the dry-run-first workflow, the
caps, and the duplication hazard ("resending a processed message delivers its data again
downstream"). Unit tests: schema validation, guard-refusal envelope passthrough, result
mapping, horolog conversion.

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
