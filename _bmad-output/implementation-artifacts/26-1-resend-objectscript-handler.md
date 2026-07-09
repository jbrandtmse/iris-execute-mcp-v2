# Story 26.1: Resend ObjectScript Handlers & Guards

Status: done

<!-- Epic 26 Story 1. Builds against the Story 26.0 pinned API + observed semantics (spec 04 §§3-4, amended). ObjectScript only — the TS tool + governance wiring is Story 26.2. -->

## Story

As an **interop support engineer using the MCP suite**,
I want **ObjectScript resend handlers with strict pre-mutation guards behind a `%CSP.REST` route**,
so that **`iris_message_resend` (built in 26.2) can preview and resend messages safely — every dangerous path refused before any duplicate is enqueued**.

## Acceptance Criteria

From `_bmad-output/planning-artifacts/epics.md` Epic 26 → Story 26.1 and binding spec `research/feature-specs/04-message-resend.md` §§3-4 (probe-amended by Story 26.0).

- **AC 26.1.1** — New routes + handlers per conventions §3: validate ALL inputs BEFORE any namespace switch; single `RenderResponseBody` per request (Rule #7); `SanitizeError` with NO caret-globals (Rule #33 — the pinned error shapes `<Ens>ErrProductionNotRunning` / `<Ens>ErrGeneral: Target config item ... is not running` use angle brackets, not carets, so they pass through unmodified); per-message Try/Catch so one bad header never aborts the batch.
- **AC 26.1.2** — Guards enforced ObjectScript-side BEFORE any mutation: (a) header IDs must be numeric — reject otherwise; (b) `resendFiltered` REQUIRES `item` AND `from` (bounded scope, Rule #38); (c) window wider than 7 days → refused with guidance; (d) count > `maxMessages` cap (hard cap **500**) → refused (NOT truncated-and-executed), the refusal NAMING the count found; (e) execute requires `dryRun:false` AND `confirm:true` — otherwise REFUSED (Epic-20 double-gate); (f) production-not-running → validated precondition error (pre-check `##class(Ens.Director).IsProductionRunning()` for a fast/clear refusal before attempting N resends). Every refusal returns the standard envelope with `result:{}` and mutates NOTHING.
- **AC 26.1.3** — `%UnitTest` coverage: ALL guard refusals (missing confirm, over-cap, unbounded window, bad/non-numeric id, missing item/from, production-not-running), `preview` shape (incl. the body-class-existence check + the Request-vs-Response resendability distinction), and — against a scratch production — a real single `resend` + new-header linkage. Rule #35: compare returned `total` to the expected method count; rerun if short.
- **AC 26.1.4** — Deploy loop (`iris_doc_load` glob path, Rule #17) → compile → tests green; the new `ExecuteMCPv2.REST.MessageResend.cls` added to BOTH bootstrap rosters (Rule #39 — `scripts/gen-bootstrap.mjs` `classes` array AND `packages/shared/src/__tests__/bootstrap.test.ts` `expected` roster, both BEFORE `...Dispatch.cls` which must stay last); `gen:bootstrap` run; `BOOTSTRAP_VERSION` from→to recorded (Rule #24, `bootstrap.test.ts` green). Frozen governance baseline `1e62c5ad5bf7` UNTOUCHED (no new governance key in this ObjectScript story — the key is added when the TS tool registers in 26.2); `gen:governance-baseline:check` exit 0.

## Pinned API + observed semantics (from Story 26.0 — build against THESE)

**Resend call (the ONLY resend API to use):**
```objectscript
Set tSC = ##class(Ens.MessageHeader).ResendDuplicatedMessage(pOriginalHeaderId, .pNewHeaderId, "", "", "", pHeadOfQueue)
```
- Returns `%Status`; new header id is the `Output` 2nd arg. v1 passes `pNewTarget`/`pNewBody`/`pNewSource` EMPTY (edit-and-resend is out of scope); `pHeadOfQueue` defaults `0`.
- New header keeps the SAME `SessionId`; `Description` annotated `"Resent <originalId>"`. The `Resent` property is NOT set — capture `{originalId, newHeaderId}` in the HANDLER's own response payload, do not rely on header fields.
- **Do NOT use** `ResubmitMessage`/`PrepareResubmitMessage`/`ResendMessage` (wrong/deprecated family).

**Load-bearing observed semantics (spec §4, from the live probe):**
1. Production MUST be running or `ResendDuplicatedMessage` returns `<Ens>ErrProductionNotRunning` (no write). Pre-check `Ens.Director.IsProductionRunning()`.
2. Stopped/absent target → `<Ens>ErrGeneral: Target config item '<name>' is not running` (no write) — surface the status as-is.
3. Missing message body class → resend SUCCEEDS at the header layer; the `<CLASS DOES NOT EXIST>` failure surfaces ONLY in the Event Log, never on `Status`/`IsError`. → **`preview` MUST independently verify `MessageBodyClassName` exists** (`##class(%Dictionary.CompiledClass).%ExistsId(tClassName)`) and flag it in the resendability verdict.
4. Request-type header with `Status=Error(8)` is the correct retry target; Response-type header with `IsError=true` is "resendable but likely a no-op" → `preview`'s verdict/reason should steer toward Request-type Status=Error and flag Response-type error headers. **Implement the recommended default wording; note it in the Dev Agent Record as reviewable (product may refine).** Do NOT halt on this — it is a verdict-message wording choice with a clear default, not a blocker.

## Tasks / Subtasks

- [x] Task 1 (AC 26.1.1): Create `src/ExecuteMCPv2/REST/MessageResend.cls` (NEW class — Interop.cls is 2485 lines, spec §4 recommends new file). Two handler methods:
  - [x] `MessageResendPreview` (read) — accepts `headerIds[]`; per header returns id, session, source/target item, status, time, body classname, body summary (first ~1KB sanitized), resendable verdict+reason (incl. body-class existence + Request/Response distinction). Never mutates.
  - [x] `MessageResend` (write) — dispatches on a body field for `resend` (headerIds[]) vs `resendFiltered` (item/status/from/to/maxMessages/dryRun/confirm). Per-header Try/Catch; capture `{originalId, newHeaderId?, ok, error?}`; summary counts.
- [x] Task 2 (AC 26.1.2): Guards BEFORE any `ResendDuplicatedMessage` call — numeric-id, item+from-required, ≤7-day window, ≤500 count (name the count), dryRun:false+confirm double-gate, production-running precheck. Each refusal → standard envelope `result:{}`, no mutation.
- [x] Task 3 (AC 26.1.1): `resendFiltered` enumeration — see Dev Agent Record "Discrepancy: MessageTrace has no item/status/window filters" below for why this is a NEW query (same base-column/`%SQL.Statement` style as `MessageTrace`, not a literal reuse).
- [x] Task 4 (AC 26.1.1): Register two routes in `src/ExecuteMCPv2/REST/Dispatch.cls` (near the other `/interop/production/messages*` routes ~line 114-115): `POST /interop/message/resend` → `MessageResend:MessageResend`; `POST /interop/message/resend/preview` → `MessageResend:MessageResendPreview`.
- [x] Task 5 (AC 26.1.3): `%UnitTest` class `src/ExecuteMCPv2/Tests/MessageResendTest.cls` — guard refusals, preview shape, real single resend + linkage on the scratch production (start `SessionAgent.Sample.Production` in HSCUSTOM; Rule #35 count check; clean up scratch messages/stop production after).
- [x] Task 6 (AC 26.1.4): Deploy (`iris_doc_load` glob) + compile; add `ExecuteMCPv2.REST.MessageResend.cls` to BOTH bootstrap rosters (Rule #39); `gen:bootstrap`; record `BOOTSTRAP_VERSION` 13b4b5f003ab→<new>; `bootstrap.test.ts` green; `gen:governance-baseline:check` exit 0 (frozen `1e62c5ad5bf7` untouched).

## Dev Notes

### Rule #39 — bootstrap DUAL-roster (a NEW .cls, not just a method add)

`ExecuteMCPv2.REST.MessageResend.cls` is a NEW bootstrapped class → it MUST be added to BOTH hand-maintained lists (both carry "MUST stay in sync" intent):
1. `scripts/gen-bootstrap.mjs` `classes` array (currently 26 entries) — insert `{ name: 'ExecuteMCPv2.REST.MessageResend.cls', path: 'src/ExecuteMCPv2/REST/MessageResend.cls' }` in the REST group, e.g. right AFTER `ExecuteMCPv2.REST.Interop.cls` (line 30) — anywhere BEFORE `ExecuteMCPv2.REST.Dispatch.cls`, which MUST remain LAST (a test asserts `keys[last] === Dispatch`).
2. `packages/shared/src/__tests__/bootstrap.test.ts` `expected` roster (~line 1032) — add `"ExecuteMCPv2.REST.MessageResend.cls"` at the matching position (before Dispatch).
Then `gen:bootstrap` (never hand-edit `bootstrap-classes.ts`, Rule #18) regenerates the embedded copy + moves `BOOTSTRAP_VERSION` (13b4b5f003ab→new hash). `bootstrap.test.ts` must go green. Missing EITHER roster → red suite (Rule #39).

### Governance / frozen baseline (Rule #23/#25/#28)

- This story adds NO governance key. The `iris_message_resend` key + its `mutates:{preview:read,resend:write,resendFiltered:write}` classification are added in Story 26.2 when the TS tool registers. So the frozen baseline `1e62c5ad5bf7` stays git-clean here; run `pnpm gen:governance-baseline:check` (exit 0) — NEVER the bare generator (Rule #25).
- The REST route has NO governance gate of its own (governance is enforced at the MCP/tool layer in 26.2). So this handler's OWN guards (numeric id, bounds, double-gate, production-running) are the real safety net for a direct-REST caller — exactly what the %UnitTest + the 26.3 live smoke verify. Make them airtight.

### ObjectScript discipline

- Standard skeleton (conventions §3 + `.claude/rules/`): `Set tSC=$$$OK` first, `Quit tSC` last; Try/Catch with argumentless `Quit`; validate inputs BEFORE `Set $NAMESPACE`; restore namespace in catch first-line; single `RenderResponseBody`; `SanitizeError` for all error text (no caret-globals — the pinned Ens errors are angle-bracket, safe). No `_` in class/method/param names; `///` doc comments; never edit Storage.
- Per-message Try/Catch: a bad header in a `resend`/`resendFiltered` batch records `{ok:false,error}` and CONTINUES — never aborts the batch (spec §3).
- `%DynamicObject` field reads: use `%IsDefined`+`%Get`, never `$Get(obj.%Get(...))` (Rule #15).

### Deploy + test discipline

- Deploy via `iris_doc_load` with a glob-prefixed path (Rule #17): `c:/git/iris-execute-mcp-v2/src/**/MessageResend.cls` (or `src/ExecuteMCPv2/**/*.cls`). Bare path mis-maps the class name.
- After `iris_execute_tests`, compare returned `total` to the expected method count; rerun if short (Rule #35 partial-snapshot caveat — recently root-caused/fixed but keep the count-check as defense-in-depth).
- Scratch production: start `SessionAgent.Sample.Production` (HSCUSTOM, currently Stopped; governance open). Drive/locate a test message, run the real-resend test, then DELETE scratch header rows + stop the production. A leftover scratch artifact is a review finding.

### References

- [Source: _bmad-output/planning-artifacts/research/feature-specs/04-message-resend.md §§3-4 (probe-amended)]
- [Source: _bmad-output/implementation-artifacts/26-0-resend-api-probe.md — Dev Agent Record (pinned API + observed semantics)]
- [Source: src/ExecuteMCPv2/REST/Interop.cls:1036-1062 (MessageTrace query to reuse), Dispatch.cls:114-115 (route pattern), ProductionControl (Epic-20 confirm double-gate)]
- [Source: scripts/gen-bootstrap.mjs (classes array), packages/shared/src/__tests__/bootstrap.test.ts (roster ~line 1032), packages/shared/src/bootstrap-classes.ts:25 (BOOTSTRAP_VERSION=13b4b5f003ab)]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via `bmad-dev-story` skill.

### Debug Log References

No `^ClineDebug` global was needed. `ResendOne`/`PreviewOne` return human-readable `%DynamicObject` payloads directly, and `%UnitTest` failures surface inline via `$$$Assert*` macro output.

### Completion Notes List

- **Discrepancy found (Rule #16 spirit) — Task 3 / spec §4's "reuse `Interop.cls:MessageTrace`" claim is WRONG.** Read `Interop.cls:1009-1090` (`MessageTrace`) before writing the enumeration query: it filters ONLY by `sessionId` or `headerId` (`WHERE ID = ?` / `WHERE SessionId = ?`), with no `item`/`status`/`from`/`to` filtering anywhere. Grepped the whole `src/` tree for any `FROM Ens.MessageHeader` query with item+status+time-window filters — none exists (`Monitor.cls` has unrelated unfiltered/single-cutoff `COUNT(*)` queries; `Diagram/Loader.cls` filters by `SessionId` only). Per Rule #16 ("If the spec's claim is empirically wrong, widen the story scope to fix the underlying method AND flag the spec error"), this was NOT a blocker — I wrote a fresh, bounded `WHERE (SourceConfigName = ? OR TargetConfigName = ?) AND Status = ? AND TimeCreated >= ? AND TimeCreated <= ?` query in `MessageResend.cls` (`MessageResend` classmethod, `resendFiltered` branch), matching `MessageTrace`'s established `%SQL.Statement`/dot-notation-column style rather than a literal shared call. Flagging for the Epic 26 retro: spec 04 §4's "reuse the message-query SQL from `Interop.cls:MessageTrace` (~lines 1036-1062)" language should be corrected to "match `MessageTrace`'s query style" — there is no existing filtered query to literally reuse.
- **`item` filter design decision (reviewable):** `resendFiltered`'s `item` matches EITHER `SourceConfigName` OR `TargetConfigName` (OR-match) rather than target-only, since a message can be interesting to retry whether the caller names the item that sent it or the item that failed to receive it. Documented in the class's method doc comment.
- **Guard-ordering decision:** all STRUCTURAL guards (numeric-id, item+from-required, window≤7d, maxMessages bounds, the dryRun/confirm double-gate) are checked and can refuse BEFORE any namespace switch. The two DATA-dependent guards — (d) count>cap and (f) production-not-running — inherently require a `%SQL.Statement`/`Ens.Director` call in the TARGET namespace, so they run immediately after the namespace switch but strictly BEFORE any `ResendDuplicatedMessage` call (satisfying AC 26.1.2's "BEFORE any mutation" invariant, which is the binding requirement — narrower than "before namespace switch," which Rule text ties specifically to the %SYS-visibility hazard that does not apply here since Ens.* is never %SYS).
- **Verdict wording (flagged per story Dev Notes as reviewable):** `Verdict()` returns `"recommended"` for a Request+Status=Error(8) header, `"caution"` for a Response+IsError header (steering the caller toward resending the original Request instead) or any header whose body class no longer exists, and `"note"` for everything else (e.g. resending a Completed message). Product may refine the exact wording; the 3-tier scheme + escalation rule is the implemented default.
- **`preview` body summary (best-effort, reviewable):** `BodySummary()` reads the first 1KB (control-character-sanitized) only for `%Stream.Object`-derived bodies; other body classes get a generic `"(non-stream body; class=X)"` placeholder rather than a per-class serialization attempt. Never throws — returns `""` on any failure (missing class, `%OpenId` failure, etc.).
- **`resend` vs `resendFiltered` double-gate scope:** per spec §3's tool-contract table, `dryRun`/`confirm` are `resendFiltered`-only parameters; a plain `resend` (explicit ≤100 header IDs, already a bounded/intentional action) executes directly with no dry-run gate — matching AC 26.1.2(e)'s "execute requires dryRun:false AND confirm:true" being scoped to the resendFiltered action (the only action with a `dryRun` param at all).
- **Test-time discovery:** `iris_execute_tests` returned `total:11` matching the exact method count on the first run — no Rule #35 rerun needed. All 11 passed, including the real-resend test against `SessionAgent.Sample.Production` (~3.5s: start + `RunScenario("none")` + 2s settle + resend + 1s settle + cleanup + stop). Post-run verification: production confirmed `Stopped` via `iris_production_status`; `SELECT COUNT(*) FROM Ens.MessageHeader WHERE SessionId BETWEEN 990000701 AND 990000799` (the test's reserved synthetic range) returned 0 — no leftover scratch artifacts.
- Full `@iris-mcp/shared` suite re-run after the bootstrap regen: 686/686 passed across 35 files (no regressions from the dual-roster edits).
- `BOOTSTRAP_VERSION`: `13b4b5f003ab` → `1f3afba4ac52` (26 classes, `MessageResend.cls` inserted immediately after `Interop.cls`, before `Loc.cls`; `Dispatch.cls` still last). `bootstrap.test.ts` green (48/48 in that file's suite run).
- `pnpm gen:governance-baseline:check` → exit 0 (141 frozen foundation keys intact, 194 live keys, 53 post-foundation-allowed — this story added none; `git status` confirms `governance-baseline.ts`/`baseline-classifications.ts` untouched). No new governance key — expected, since this is the pure-ObjectScript story; `iris_message_resend`'s `mutates` classification is added when the TS tool registers in Story 26.2.

### File List

- `src/ExecuteMCPv2/REST/MessageResend.cls` (new)
- `src/ExecuteMCPv2/REST/Dispatch.cls` (modified — 2 new routes)
- `src/ExecuteMCPv2/Tests/MessageResendTest.cls` (new)
- `scripts/gen-bootstrap.mjs` (modified — added `MessageResend.cls` to the `classes` array)
- `packages/shared/src/__tests__/bootstrap.test.ts` (modified — roster + counts updated to 26)
- `packages/shared/src/bootstrap-classes.ts` (regenerated — `gen:bootstrap`; `BOOTSTRAP_VERSION` `13b4b5f003ab` → `1f3afba4ac52`)

## Review Findings (code review 2026-07-09)

**Final status: done — 0 HIGH, 0 blocking-MED, 6 LOW deferred.**

Three-layer adversarial review (Blind Hunter diff-only, Edge Case Hunter diff + project access, Acceptance Auditor against binding spec `04-message-resend.md` + ACs). Both hunters independently converged: **no guard bypass, no double-render, no namespace leak, no SQL injection.** Manual control-flow trace confirmed all six pre-mutation guards (numeric-id, item+from-required, ≤7-day window, ≤500 count naming the count, `dryRun:false`+`confirm:true` double-gate, production-running precheck) fire BEFORE the only two `ResendDuplicatedMessage` call sites (`resend` and `resendFiltered`-execute branches). The double-gate's affirmative signal (`confirm`) coerces safe (`+"true"=0` → refused), so no execution is reachable without a real-boolean `confirm:true`.

**Load-bearing verifications performed (not claimed):**
- `pnpm gen:governance-baseline:check` → **exit 0**; frozen foundation `1e62c5ad5bf7` git-clean (`governance-baseline.ts` + `baseline-classifications.ts` untouched). No new governance key (correct — that lands in Story 26.2).
- `bootstrap.test.ts` → **42/42 green** (Rule #39 dual-roster: `MessageResend.cls` present in `gen-bootstrap.mjs` array + `bootstrap.test.ts` roster, both before `Dispatch.cls` which stays last).
- `pnpm gen:bootstrap` → **idempotent** (no diff on re-run); `BOOTSTRAP_VERSION 1f3afba4ac52` confirmed; `MessageResend` embedded.
- Rule #16 discrepancy **confirmed TRUE**: read `Interop.cls:1009-1090` (`MessageTrace`) — it filters ONLY by `sessionId`/`headerId`, no item/status/time-window filters. The dev's fresh bounded query `WHERE (SourceConfigName = ? OR TargetConfigName = ?) AND Status = ? AND TimeCreated >= ? AND TimeCreated <= ?` (all `?`-parameterized) is correct + bounded (Rule #38). Flag is recorded in the Dev Agent Record for the Epic 26 retro.
- Rule #7 single-render, Rule #33 no-caret-globals (the Ens error shapes are angle-bracket, `SanitizeError` passes them unmodified), namespace validate-before-switch + catch-first-line restore — all confirmed on every path.

**Deferred (6 LOW, Epic-26-own → `deferred-work.md` "code review of story-26.1"):** CR 26.1-1 `dryRun` non-boolean coercion defaults execute-eligible (not a bypass — `confirm` holds); CR 26.1-2 bare-date `to` excludes final day (fails safe); CR 26.1-3 `headerIds` JSON-object accepted (bounded numeric, TS enforces); CR 26.1-4 filtered-execute composition untested (constituents tested; 26.3 live smoke covers); CR 26.1-5 non-integer `maxMessages` into `TOP` (fails safe); CR 26.1-6 execute-path fetch-failure swallowed (fails safe). Each fix touches the bootstrapped/deployed `.cls` (redeploy + regen + retest cycle), so folded into Story 26.2 / a hardening pass rather than applied as a mechanical review patch.

**Dismissed:** Dev Agent Record "`total:11`" note is stale vs the final 13 test methods (QA added `TestHttpResendFilteredMatchCountExceedsMaxMessagesGuard` + `TestResendBatchContinuesPastBadHeader`) — documentation staleness, not a defect. `BodySummary` "..." at an exactly-1024 boundary — cosmetic.
