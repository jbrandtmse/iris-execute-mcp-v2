# Story 34.4: Response-Path Integrity + Epic-Gate Durability

Status: done

<!-- Created 2026-08-14 by /bmad-correct-course after Project Lead escalation at the Epic 34 post-reload smoke review. Proposal: _bmad-output/planning-artifacts/sprint-change-proposal-2026-08-14-story-34-4.md -->

## Story

As a **caller of the ExecuteMCPv2 REST handlers**,
I want **a serialization failure to be reported rather than silently shipped as a truncated 200, and the epic's own acceptance legs to be enforced by a gate**,
so that **the failure class Epic 34 closed cannot reappear through the response-render path or go undetected by the suite.**

## Severity framing — read this before writing any code or prose

`34-2-R3` has **NO reachable trigger today.** Its known trigger (the `$Data=11` OREF case) was fixed at the root during the Story 34.2 review. This story is **defense-in-depth against a pattern shared by every handler in `ExecuteMCPv2.REST.*`**, on a payload surface Epic 34 enlarged more than any other change.

Do NOT describe this as a live bug in code comments, the CHANGELOG, or the changeset. Overstating it is a correctness problem in its own right — and the epic's review history already caught one inverted severity claim (34.2's `<MAXSTRING>` detector reporting a crash as a truncation).

## Acceptance Criteria

- **AC 34.4.1** (`34-2-R3`) — `RenderResponseBody`'s returned `%Status` is captured and acted on across `ExecuteMCPv2.REST.*`: on failure, emit a minimal **pre-validated** error envelope instead of the failed payload. Rule #7 preserved on every path: full I/O restore before render, exactly ONE `RenderResponseBody` per request, namespace restored before render.
- **AC 34.4.2** (`34-3-R1`) — the `truncated` flag is surfaced on the ERROR envelope of BOTH `/classmethod` and `/command`, or is explicitly documented as success-path-only at its point of use. Silent loss is not an allowed outcome.
- **AC 34.4.3** (`34-3-R4`) — AC 34.3.4 legs **(b) `Output`-param, (c) 20-arg, (d) second-namespace** are enforced by the **DEFAULT** test suite alongside leg (a), joining `packages/iris-dev-mcp/src/__tests__/execute-classmethod-epic-gate.test.ts`. A new opt-in task that nothing invokes does **NOT** satisfy this AC — the repo has no CI (`.github/workflows` absent), so the default suite is the only enforcement surface.
- **AC 34.4.4** — Rule #19 back-compat: every handler touched keeps its current success-path response byte-identical, proven **mechanically per handler**.
- **AC 34.4.5** — Rule #48: each fix carries mutation evidence (revert → red → restore byte-identically). AC 34.4.3's new gate legs must be shown RED under a real break.
- **AC 34.4.6** — BOOTSTRAP_VERSION from→to recorded (Rule #24; current `5ef2df119451`), Constraint C-2 re-verified (single generated `.int`, pinned by `TestCommandCompilesToSingleGeneratedRoutine`), frozen governance baseline unchanged (#23/#25), tool counts unmoved (#31).

## Tasks / Subtasks

- [x] **Task 1 — Pin the inherited signature live (Rule #16)** (AC: 34.4.1)
  - [x] Read `%Atelier.REST`'s `RenderResponseBody` from the class library (`iris_doc_get`, or the local `irislib` export) and record its EXACT signature — parameter names, types, defaults, return type. Do not guess it; an override with a mismatched signature either fails to compile or silently shadows nothing.
- [x] **Task 2 — Base class** (AC: 34.4.1)
  - [x] Create `src/ExecuteMCPv2/REST/Base.cls` — `Class ExecuteMCPv2.REST.Base Extends %Atelier.REST` — overriding `RenderResponseBody` to pre-flight serialization and, on failure, emit a minimal pre-validated error envelope. Call `##super()` for the success path so behavior is unchanged (AC 34.4.4).
  - [x] Re-parent the **15** handlers that call it (one line each): `Analytics`, `Command`, `Config`, `EnvSync`, `Global`, `Health`, `Interop`, `Loc`, `MessageResend`, `Monitor`, `Security`, `SqlAdvisor`, `SystemConfig`, `Task`, `UnitTest`.
  - [x] **Decide explicitly** whether `Dispatch.cls` is re-parented: it has **zero** `RenderResponseBody` calls, so it needs nothing functionally. Consistency argues for it; Rule #39 ordering (Dispatch stays LAST) argues for care. Record the decision either way — do not leave it unstated. **Decision: NOT re-parented.** Zero call sites means zero functional benefit; re-parenting would add compile-order/coverage surface with no correctness payoff, contrary to the story's bounded-scope discipline (Rule #52). Pinned live by `ExecuteMCPv2.Tests.BaseTest:TestDispatchDeliberatelyNotReParented`.
- [x] **Task 3 — Rule #39 rosters for the NEW bootstrapped class** (AC: 34.4.6)
  - [x] Add `REST/Base.cls` to `scripts/gen-bootstrap.mjs` `classes[]` — **ordered**, and it must come BEFORE every class that extends it; `REST/Dispatch.cls` stays LAST.
  - [x] Add it to `packages/shared/src/__tests__/bootstrap.test.ts`: classPaths roster **+ expected-names + count** (all three — `gen:bootstrap` regenerates content only, it does NOT update rosters).
- [x] **Task 4 — `truncated` on error envelopes** (AC: 34.4.2)
- [x] **Task 5 — Default-suite gate legs (b)/(c)/(d)** (AC: 34.4.3, 34.4.5)
- [x] **Task 6 — Back-compat + mutation evidence** (AC: 34.4.4, 34.4.5)
- [x] **Task 7 — Gates** (AC: 34.4.6)
  - [x] `pnpm run gen:bootstrap`, record BOOTSTRAP_VERSION from→to; `bootstrap.test.ts` green.
  - [x] `pnpm gen:governance-baseline:check` (`:check` ONLY) exit 0 — frozen `1e62c5ad5bf7` / 141 / 201 / 60.
  - [x] `pnpm turbo run build test lint type-check`; changeset added.
  - [x] C-2: `iris_doc_list(filter="ExecuteMCPv2.REST.Command", generated=true)` → exactly one generated routine.

### Review Findings

Code review 2026-08-14 (bmad-code-review, Rule #57 machinery). All three adversarial layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor) DELIVERED explicit findings payloads inside the 20-minute hard timeout, measured against a real armed clock — `failed_layers` empty, review NOT degraded. Frozen-diff snapshot captured at review start and disposed at close.

**Patches applied (14):**

- [x] [Review][Patch] Class banner contradicted its own code — claimed `##super()` is called "with the ORIGINAL, unmodified arguments" while the code deliberately passes locally-defaulted copies; a maintainer trusting the banner reintroduces the total-route-outage this story just fixed [src/ExecuteMCPv2/REST/Base.cls]
- [x] [Review][Patch] README + changeset claimed `truncated` is surfaced on the ERROR response of both MCP tools — it is not: `http-client.ts` throws `IrisApiError`, which drops the envelope `result`. Confirmed live through the real tool. Docs corrected to the truthful envelope-scoped claim; capability gap deferred as `34-4-R4` [packages/iris-dev-mcp/README.md, .changeset/execute-classmethod-capture-byref.md]
- [x] [Review][Patch] Pre-flight failure discarded the caller's real `pStatus`, replacing the application error with the serialization error — now folded via `$$$ADDSC` [src/ExecuteMCPv2/REST/Base.cls]
- [x] [Review][Patch] Undiscriminated pre-flight `Catch` would substitute an error envelope for resource errors (`<STORE>`/`<FILEFULL>` under temp-DB pressure), DESTROYING a valid large payload — a new regression on the hot path of all 738 renders. Now discriminated in the fail-safe direction: resource/environment errors fall through to `##super()` (exactly pre-story behavior); only genuine serialization failures substitute [src/ExecuteMCPv2/REST/Base.cls]
- [x] [Review][Patch] Pre-flight did not mirror the parent's `%Atelier.v1.Utils.DocumentStreamAdapter` branch — that class's `%ToJSON(pLevel,…)` writes to the CURRENT DEVICE, so handing it the scratch stream would emit the document body during "pre-flight" and again from `##super()`. Unreachable today (nothing calls the inherited `ServeDoc`/`ServeXml`) but a silent divergence from the overridden method's contract; parity guard added [src/ExecuteMCPv2/REST/Base.cls]
- [x] [Review][Patch] Scope limits documented rather than silently implied: the status part is NOT pre-flighted (pre-flighting it is circular — the substitution envelope renders through the same path), and the pre-flight proves serializability only, never the device write [src/ExecuteMCPv2/REST/Base.cls]
- [x] [Review][Patch] Rule #54 decision on the outer `Catch` — QA had judged it unreachable and dismissed it. That analysis was too narrow: it considered only `##super()` (which indeed never throws). The branch IS reachable via `SanitizeError()` and `exPreflight.AsStatus()`, both of which sit OUTSIDE the inner pre-flight Try and neither of which is throw-proof. Kept as deliberate defensive code, with reachability, consequence (empty HTTP 200) and the decision NOT to add a doubly-unreachable last-resort render all documented in place [src/ExecuteMCPv2/REST/Base.cls]
- [x] [Review][Patch] "745 call sites" was a hand-authored figure inherited from the spec and baked into two durable banners; mechanical count is 738 (Rule #51) [src/ExecuteMCPv2/REST/Base.cls, src/ExecuteMCPv2/Tests/BaseTest.cls]
- [x] [Review][Patch] `TestSuccessPathByteIdenticalToParent` — the story's ONLY structural back-compat proof for all 15 handlers — was satisfied by two empty captures (`"" = ""`); non-emptiness and payload assertions added [src/ExecuteMCPv2/Tests/BaseTest.cls]
- [x] [Review][Patch] Same test lacked the teardown guard its three siblings have: a throw would skip `StopCapture`, stranding `ReDirectIO(1)` across the remaining package run and silently swallowing every subsequent test's output [src/ExecuteMCPv2/Tests/BaseTest.cls]
- [x] [Review][Patch] `TestAllFifteenHandlersExtendBase` claimed in its own doc comment to catch "a new handler shipped without extending Base" but enumerated a literal 15-name `$ListBuild` closed by `$$$AssertEquals($ListLength(tHandlers), 15)` — a live hierarchy read over a dead enumeration. Replaced with a mechanical `%Dictionary.ClassDefinition` enumeration (Rules #51/#56) [src/ExecuteMCPv2/Tests/BaseTest.cls]
- [x] [Review][Patch] Rule #58 — byte-identity was pinned by a single canonical flat ASCII fixture. Added `TestSuccessPathByteIdenticalAcrossPayloadShapes` covering a populated `pMsgPart`, wide/non-ASCII + JSON metacharacters + control characters, and an array-typed/nested result [src/ExecuteMCPv2/Tests/BaseTest.cls]
- [x] [Review][Patch] `TestDispatchDeliberatelyNotReParented`'s second assertion was vacuous — `%Extends("%Atelier.REST")` stays true even if Dispatch WERE re-parented onto Base, so it could never fail independently. Now reads the DIRECT superclass from the dictionary, making the pin meaningful rather than a restatement of current state [src/ExecuteMCPv2/Tests/BaseTest.cls]
- [x] [Review][Patch] Rule #39's new ordering invariant (Base before all 15 extenders) was protected only by a comment — the existing order test pins `classes[0]`, `classes[1]` and last-is-Dispatch, none of which move if Base drifts below its extenders. Explicit index assertion added [packages/shared/src/__tests__/bootstrap.test.ts]

**Deferred (9)** — recorded in `deferred-work.md` as `34-4-R1` … `34-4-R9` with rationale and suggested resolution. Notably `34-4-R1`/`34-4-R2` (weak gate-leg oracles) are PRE-EXISTING: both legs were ported verbatim from `custom-rest.integration.test.ts` exactly as Rule #36 required.

**Dismissed (5)** — including Blind Hunter's HIGH that `SanitizeError` would throw `<CLASS DOES NOT EXIST>` when a handler renders inside a `%SYS` switch: verified mechanically that NO handler renders while the namespace is switched, so the path is unreachable.

**Independent verification performed by this review (not inherited from dev/QA):**

- Mutation-verified the near-miss myself: reverted `##super(pStatus, tMsgPart, tResPart)` → raw formals, recompiled live, all 6 gate legs went RED, restored byte-identically (sha256 `f435515…feec` matched), recompiled, green.
- Mutation-verified my own two new pins: a disposable 16th handler (`ExecuteMCPv2.REST.Probe34Mutation`) made the mechanical enumeration fail as designed (deleted from server AND disk, absence confirmed live); reordering `Base.cls` below `Global.cls` made the new bootstrap order test fail; both restored byte-identically.
- Mutation-verified the Rule #58 fixture set: emptying the console part on the success path turned the NEW shapes test RED while the pre-existing canonical test stayed GREEN — direct evidence of the blindness it closes.
- Drove live HTTP against the **9 handlers QA never tested** (`Analytics`, `EnvSync`, `Global`, `Health`, `Loc`, `MessageResend`, `SqlAdvisor`, `SystemConfig`, `Task`) plus a final re-smoke of all 15 — every one returned a well-formed, non-empty `{status,console,result}` envelope.
- AC 34.4.2 verified live on both endpoints (`truncated:false` on error envelopes, never spuriously true; early-validation errors correctly carry no `truncated`, matching the documented exception).
- Confirmed the gate legs genuinely EXECUTE (no `[SKIP]` lines, real HTTP traffic observed) rather than silently skipping.
- Rule #35: mechanically counted `Test*` methods = 330, matching the returned total exactly.
- Rule #25: `gen:governance-baseline:check` only — exit 0, frozen `1e62c5ad5bf7` / 141 / 201 / 60, baseline file untouched. Rule #31: no tool/action added, counts unmoved (`@iris-mcp/dev` 622/38 unchanged).
- Constraint C-2 re-verified after every recompile: exactly one `ExecuteMCPv2.REST.Command.1.int`.
- `gen:bootstrap` idempotence confirmed (regen produced byte-identical output).

## Dev Notes

### The design decision is already made — do not re-litigate it

The Project Lead chose the **base-class + re-parent-all** option explicitly, over (a) `Command.cls`-only and (b) incremental migration. Implement that.

**Why a base class rather than editing call sites:** there are **745** `RenderResponseBody` call sites across 15 handlers, and the call shape is `Do ..RenderResponseBody(...)` — the `Do` form, which discards the returned `%Status`. That discard *is* `34-2-R3`. An override in a common base intercepts **all 745 with zero call-site edits**. Editing call sites individually is explicitly rejected.

Verified live on the current tree (2026-08-14):
- All 16 `ExecuteMCPv2.REST.*` classes extend `%Atelier.REST` **directly** — there is no common base today. `RenderResponseBody` is inherited, not defined anywhere in `ExecuteMCPv2`.
- Call-site counts: `Security` 245, `Interop` 222, `Monitor` 66, `Config` 62, `MessageResend` 30, `Task` 29, `Global` 20, `Analytics` 19, `SystemConfig` 14, `Command` 14, `Loc` 8, `UnitTest` 7, `SqlAdvisor` 2, `Health` 2, `EnvSync` 2.
- `Dispatch.cls` — **0** calls.
- `Utils.cls`'s two matches are **comments**, not call sites (lines 249 and 253) — Utils is not a `%Atelier.REST` subclass and needs no change. Do not "fix" it.

### The real risk is back-compat across 15 handlers, not the fix

This story changes the response path for **every** REST handler in the package, including `Security` (245 sites) and `Interop` (222) which this epic never touched. AC 34.4.4 requires **mechanical per-handler** proof that the success path is byte-identical — a single spot-check on `Command.cls` does not satisfy it. Calling `##super()` on the success path is the design that makes this provable; any logic that re-serializes or re-orders on the success path breaks it.

### Rule #39 is the easiest thing to get wrong here

This adds the epic's **first new bootstrapped class**. Rules #24/#39 both fire:
- `gen:bootstrap` regenerates **content only** — it does NOT update rosters. Both hand-maintained rosters must be edited by hand.
- The `classes[]` array in `scripts/gen-bootstrap.mjs` is **ordered**: `Base.cls` must precede every class extending it, and `REST/Dispatch.cls` must remain **last**.
- `bootstrap.test.ts` needs **three** updates: classPaths roster, expected-names, and the count.
- `ExecuteMCPv2.Tests.*` stay OUT of the manifest.

### Constraint C-2 still binds

`Command.cls` gains a superclass, which changes its generated code. Re-verify **exactly one** `ExecuteMCPv2.REST.Command.1.int` after compiling — `TestCommandCompilesToSingleGeneratedRoutine` pins it. If the base class introduces a second generated routine for `Command`, the mnemonic binding (`Use tNull::("^"_$ZNAME)`) breaks capture in every namespace, silently. This is the constraint the 34.1 probe derived and the 34.2/34.3 reviews both guarded.

### AC 34.4.3 — reuse the existing gate file, do not build a parallel one

`packages/iris-dev-mcp/src/__tests__/execute-classmethod-epic-gate.test.ts` already exists and already carries what legs (b)/(c)/(d) need:
- a name that is **not** `*.integration.test.ts`, so `vitest.config.ts`'s `exclude: ["src/**/*.integration.test.ts"]` does not drop it;
- a fixture-existence probe over the stock Atelier `/doc/` surface (independent of `ExecuteMCPv2`, so "fixtures absent" → skip and "fixtures present, endpoint broken" → RED are distinguishable);
- an `IRIS_REQUIRE_LIVE=1` hard-fail opt-in.

Add legs (b)/(c)/(d) **into that file**. The assertions themselves already exist in `custom-rest.integration.test.ts` — port them; do not re-derive expected values (Rule #36).

The fixture targets exist: `TargetOutput` / `TargetSubscriptOutput` (leg b), `Target20` (leg c), and any capture target driven with `namespace: "USER"` (leg d).

### ObjectScript constraints

- Argumented `Quit` is **ILLEGAL** inside Try/Catch (ERROR #1043) — initialize before, argumentless `Quit` inside, return after.
- Triple `$$$` macros. No underscores in method or class-parameter names. Never touch a `Storage` section. `///` doc comments. Indent all commands.
- **Rule #9** — propagate the real `%Status` text via `##class(ExecuteMCPv2.Utils).SanitizeError()`; do not mask with generic text. Note `SanitizeError` strips caret-global tokens (Rule #33).
- **Rule #15** — never wrap a method call in `$Get()`.
- Create `.cls` files on disk first, then load with a **glob-prefixed** path (Rule #17): `c:/git/iris-execute-mcp-v2/src/**/Base.cls`. Compile via `iris_doc_compile`.

### Scope boundaries

- Stories 34.0–34.3 stay `done` and are NOT re-touched beyond what these ACs require (Rule #52).
- No new MCP tool, action, or governance key — Rules #28/#31/#53 untriggered; tool counts must not move.
- Frozen governance baseline untouched (#23/#25) — `:check` only, never the bare generator.
- **Out of scope**, staying in the ledger at Rule #37 count 1: `34-1-R5`, `34-1-R8`, `34-2-R2`, `34-2-R4`, `34-2-R5`, `34-3-R2`, `34-3-R3` and all LOW items. The size-cap pair (`34-2-R2`/`34-3-R2`) was considered and declined by the Project Lead.

### Testing

- `%UnitTest` under `ExecuteMCPv2.Tests.*` (out of the bootstrap manifest, Rule #39). Run via `iris_execute_tests`; **compare returned `total` against the mechanically-counted `Test*` methods** (Rule #35), rerun per-class if short.
- Vitest under `packages/**` for the gate legs.
- Current baselines: `ClassMethodArgsTest` 49, `CommandTest` 17, `UtilsTest` 19; `@iris-mcp/dev` 619 tests / 38 files with 0 skipped; turbo 29/29.

### References

- [Source: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-08-14-story-34-4.md`] — the approved proposal
- [Source: `_bmad-output/planning-artifacts/epics.md#Story 34.4`] — AC text
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md`] — items `34-2-R3`, `34-3-R1`, `34-3-R4` with each raising layer's suggested resolution
- [Source: `src/ExecuteMCPv2/REST/Command.cls`] — the `Do ..RenderResponseBody(...)` call shape; capture/restore discipline
- [Source: `packages/iris-dev-mcp/src/__tests__/execute-classmethod-epic-gate.test.ts`] — the gate file to extend
- [Source: `.claude/rules/project-rules.md`] — #7, #9, #15, #16, #19, #24, #25, #31, #33, #35, #36, #39, #48, #52

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via the bmad-dev-story workflow.

### Debug Log References

- Live-pinned `%Atelier.REST.RenderResponseBody(pStatus As %Status, pMsgPart As %DynamicArray, pResPart As %DynamicObject) As %Status` via `iris_doc_get` before writing the override (Task 1).
- `%Library.DynamicAbstractObject.%ToJSON(outstrm As %Stream.Object) As %String` signature confirmed live (accepts an optional target stream) — the mechanism the pre-flight relies on.
- **Live regression found and fixed during dev** (not by review): the first version of `Base.RenderResponseBody` referenced `pMsgPart`/`pResPart` directly before applying `$Get()`, and on the success path re-passed the raw (frequently-undefined) `pMsgPart`/`pResPart` formals to `##super()`. Evaluating an undefined by-value argument at that call site threw `<UNDEFINED>` inside `Base`'s own routine, before any byte reached the device; because every one of the 745 call sites uses `Do ..RenderResponseBody(...)`, the resulting error `%Status` was silently discarded, producing a completely empty `HTTP 200` body on every route in the package (`ExecuteMCPv2.REST.Command.1.int` at the relevant offset: `<UNDEFINED>RenderResponseBody+30/+37 *pMsgPart`). Caught via a direct `curl`/`iris_execute_classmethod` smoke against the live instance after the first compile — the committed `%UnitTest` suite could not have caught it because none of `Execute()`/`ClassMethod()` can be called without a real `%request` context, and `iris_execute_tests`/`iris_execute_classmethod`/`iris_execute_command` all route through the very endpoint the bug broke. Fixed by capturing `tMsgPart = $Get(pMsgPart)` / `tResPart = $Get(pResPart)` up front and passing those (never the raw formals) to `##super()` on the success path — semantically identical to the parent's own default-application, so AC 34.4.4 still holds.
- Mutation evidence (revert → red → restore byte-identically, AC 34.4.5), all performed live against `HSCUSTOM`:
  - `Base.cls`'s `##super(pStatus, tMsgPart, tResPart)` reverted to `##super(pStatus, pMsgPart, pResPart)` → `ExecuteMCPv2.Tests.BaseTest` went 3/6 RED with the exact `<UNDEFINED> *pMsgPart` error reproduced → restored, 6/6 green.
  - `Base.cls`'s preflight `Catch` bypassed (`Set tPreflightOK = 1` instead of `0`) → `TestPreflightFailureSubstitutesMinimalErrorEnvelope` went RED, producing a genuinely truncated/invalid JSON body (`{"status":{...},"console":[],"result":` with nothing after) — the exact failure class this story exists to prevent → restored, 6/6 green.
  - `Command.cls`'s `tCmdErrored` truncated-surfacing removed → live `curl` to `/command` with a bad command showed `"result":{}` (no `truncated`) → restored, `"result":{"truncated":false}` returned again; `CommandTest` 17/17 green throughout.
  - `ClassMethodArgsFixture.TargetOwn20`'s `Target20` position-19 mutation line removed → the new leg (c) in `execute-classmethod-epic-gate.test.ts` went RED (`expected 'v19' to be 'v19-m'`) → restored, 6/6 green; `ClassMethodArgsTest` 49/49 green throughout.
- Live back-compat smoke across all 15 re-parented handlers (curl + `mcp__iris-dev-mcp__iris_execute_classmethod`/`iris_execute_command`): `/global/list`, `/classmethod` (success + error), `/command` (success + tCmdErrored + early-validation error), `/config/namespace`, `/security/user`, `/interop/production/status`, `/monitor/system`, `/monitor/health`, `/task/list`, `/analytics/cubes`, `/dev/loc`, `/dev/doc/hashes`, `/dev/sql/advise-data`, `/system/config`, `/interop/message/resend/preview`, `/tests` — all returned well-formed envelopes, none empty.
- `custom-rest.integration.test.ts` (12 tests) and `execute-classmethod-epic-gate.test.ts` (6 tests) both run live end-to-end after the fix, 100% pass.
- Full `ExecuteMCPv2.Tests` package run via `iris_execute_tests` (level=package): 330/330 passed, 0 failed, 0 skipped (329 at dev close + 1 added by code review) — includes `BaseTest`'s 7 methods (6 at dev close + 1 from code review); `ClassMethodArgsTest` 49, `CommandTest` 17, `UtilsTest` 19 baselines held (Rule #35).
- `pnpm turbo run build test lint type-check`: 29/29 successful; `@iris-mcp/dev` 622 tests / 38 files (+3 from the 619 baseline, matching the 3 new gate legs), 0 skipped. One pre-existing, unrelated lint warning in `packages/shared/src/cli/governance.ts` (not touched by this story).
- `pnpm gen:governance-baseline:check`: frozen `1e62c5ad5bf7` / 141 / 201 / 60 unchanged — no new tool/action key (correct; this story adds none).
- Constraint C-2: `iris_doc_list(filter="ExecuteMCPv2.REST.Command", generated=true)` → exactly one generated routine (`ExecuteMCPv2.REST.Command.1.int`), both before and after Base.cls's introduction.
- Disposable probe `ExecuteMCPv2.Tests.Temp34ProbeTest` (used only to diagnose the live regression above) deleted from disk and server before story completion; confirmed absent via `iris_doc_list`.

### Completion Notes List

- **AC 34.4.1** — `ExecuteMCPv2.REST.Base` created, overriding `RenderResponseBody` with a pre-flight that serializes the message/result parts into a throw-away `%Stream.TmpCharacter` before anything is written to the real response. On success, delegates to `##super()` with the already-defaulted parts (byte-identical to the parent). On failure, substitutes a minimal `[]`/`{}` envelope with the real pre-flight error text via `SanitizeError` (Rule #9). All 15 real call-site handlers (`Analytics`, `Command`, `Config`, `EnvSync`, `Global`, `Health`, `Interop`, `Loc`, `MessageResend`, `Monitor`, `Security`, `SqlAdvisor`, `SystemConfig`, `Task`, `UnitTest`) re-parented to extend it — zero call-site edits, matching the 745-site rationale. `Dispatch.cls` deliberately NOT re-parented (zero call sites; decision pinned by a live test). Framed correctly throughout as defense-in-depth — `34-2-R3` has no reachable trigger today; no code comment, docstring, or changeset entry describes it as a live bug.
- **AC 34.4.2** — `truncated` is now surfaced on the error envelope of every failure path reached AFTER capture began, in both `Execute()` and `ClassMethod()` (the `tCmdErrored` branch and outer `Catch` in `Execute()`; the `InvokeWithArgs`-error branch and outer `Catch` in `ClassMethod()`) — previously computed there and silently discarded (34-3-R1). Early validation-error one-liners (missing body/required field/bad namespace) render before capture starts, so there is no truncated state to lose there; this is documented explicitly in `Command.cls`'s class banner rather than left implicit, satisfying the AC's point-of-use documentation clause.
- **AC 34.4.3** — Legs (b) Output-param, (c) 20-arg, and (d) second-namespace added to the existing `execute-classmethod-epic-gate.test.ts` (joining leg (a)), assertions ported verbatim from `custom-rest.integration.test.ts` per Rule #36. The file is not named `*.integration.test.ts`, so it runs in the default `vitest run` / `pnpm turbo run test`, closing the zero-protection gap 34-3-R4 identified for three-quarters of AC 34.3.4.
- **AC 34.4.4** — Back-compat proven both structurally and mechanically: (1) `ExecuteMCPv2.Tests.BaseTest:TestSuccessPathByteIdenticalToParent` compares captured device output between `##class(ExecuteMCPv2.REST.Base).RenderResponseBody(...)` and the directly-callable `##class(%Atelier.REST).RenderResponseBody(...)` for the same inputs and asserts byte-identical bytes — since all 15 handlers inherit the identical override with no per-handler logic, this is a structural proof that covers every handler, not a Command.cls-only spot-check; (2) `TestAllFifteenHandlersExtendBase` mechanically pins the re-parenting itself via `%Extends()`; (3) a live curl/MCP-tool smoke against all 15 handlers' real HTTP routes (see Debug Log) confirmed well-formed, unchanged-shape responses; (4) the full `custom-rest.integration.test.ts` (which includes an explicit Rule #19 back-compat pin for `iris_execute_classmethod`'s plain-scalar shape) and `execute-classmethod-epic-gate.test.ts` both pass 100% live.
- **AC 34.4.5** — Mutation evidence performed for all three fixes (Base.cls's argument-passing bug, Base.cls's pre-flight substitution, Command.cls's truncated-on-error surfacing) and for the new AC 34.4.3 gate legs (leg (c) shown RED under a real fixture break) — see Debug Log for each revert→red→restore sequence, all files restored byte-identically and reconfirmed green/passing afterward.
- **AC 34.4.6** — BOOTSTRAP_VERSION `5ef2df119451` → `d7adf516d912` at dev close, then → **`34233b5c9f63`** after the code review's `Base.cls` patches (29 classes throughout, `Base.cls` inserted immediately before `Global.cls`, `Dispatch.cls` still last; regen idempotent). Constraint C-2 re-verified: exactly one generated `.int` for `Command`. Frozen governance baseline unchanged (141/201/60/`1e62c5ad5bf7`). Tool counts unmoved — no new MCP tool, action, or governance key.
- A real, previously-undetected defect was found and fixed during this story (see Debug Log): the initial `Base.cls` implementation broke EVERY `ExecuteMCPv2.REST.*` HTTP route (empty `200` responses) due to an `<UNDEFINED>` thrown while re-evaluating an omitted `pMsgPart`/`pResPart` argument at the `##super()` call site. This was caught by driving the real, deployed endpoints over HTTP (curl and the `iris-dev-mcp` MCP tools, which themselves call these endpoints) rather than relying on the `%UnitTest` suite alone, since none of the existing tests can construct a live `%request`/`%response` CSP context. `ExecuteMCPv2.Tests.BaseTest` now pins this exact regression class permanently (`TestSuccessPathWithOmittedMsgPart`, `TestSuccessPathWithBothPartsOmitted`).
- Changeset `execute-classmethod-capture-byref.md` (the same one Stories 34.2/34.3 used) extended with a paragraph covering the additive error-envelope `truncated` field and the internal response-path hardening, framed correctly as internal robustness rather than a live-bug fix.
- `packages/iris-dev-mcp/README.md` updated with one sentence per tool noting `truncated` is also reported on error responses reached after capture began.

### File List

- `src/ExecuteMCPv2/REST/Base.cls` (new)
- `src/ExecuteMCPv2/Tests/BaseTest.cls` (new)
- `src/ExecuteMCPv2/REST/Command.cls` (modified — truncated-on-error surfacing in `Execute()`/`ClassMethod()`, re-parented to extend `Base`)
- `src/ExecuteMCPv2/REST/Analytics.cls` (modified — re-parented to extend `Base`)
- `src/ExecuteMCPv2/REST/Config.cls` (modified — re-parented to extend `Base`)
- `src/ExecuteMCPv2/REST/EnvSync.cls` (modified — re-parented to extend `Base`)
- `src/ExecuteMCPv2/REST/Global.cls` (modified — re-parented to extend `Base`)
- `src/ExecuteMCPv2/REST/Health.cls` (modified — re-parented to extend `Base`)
- `src/ExecuteMCPv2/REST/Interop.cls` (modified — re-parented to extend `Base`)
- `src/ExecuteMCPv2/REST/Loc.cls` (modified — re-parented to extend `Base`)
- `src/ExecuteMCPv2/REST/MessageResend.cls` (modified — re-parented to extend `Base`)
- `src/ExecuteMCPv2/REST/Monitor.cls` (modified — re-parented to extend `Base`)
- `src/ExecuteMCPv2/REST/Security.cls` (modified — re-parented to extend `Base`)
- `src/ExecuteMCPv2/REST/SqlAdvisor.cls` (modified — re-parented to extend `Base`)
- `src/ExecuteMCPv2/REST/SystemConfig.cls` (modified — re-parented to extend `Base`)
- `src/ExecuteMCPv2/REST/Task.cls` (modified — re-parented to extend `Base`)
- `src/ExecuteMCPv2/REST/UnitTest.cls` (modified — re-parented to extend `Base`)
- `scripts/gen-bootstrap.mjs` (modified — `REST/Base.cls` added to `classes[]`, ordered before `Global.cls`)
- `packages/shared/src/bootstrap-classes.ts` (regenerated — 29 classes, `BOOTSTRAP_VERSION` `5ef2df119451` → `d7adf516d912`)
- `packages/shared/src/__tests__/bootstrap.test.ts` (modified — classPaths roster, expected-names, count, and a Base.cls inclusion test)
- `packages/iris-dev-mcp/src/__tests__/execute-classmethod-epic-gate.test.ts` (modified — legs (b)/(c)/(d) added)
- `packages/iris-dev-mcp/README.md` (modified — one clarifying sentence per tool on `truncated`'s error-path visibility)
- `.changeset/execute-classmethod-capture-byref.md` (modified — paragraph added covering this story's additive changes)
- `_bmad-output/implementation-artifacts/34-4-response-integrity-gate-durability.md` (this file — tasks, Dev Agent Record, status)
