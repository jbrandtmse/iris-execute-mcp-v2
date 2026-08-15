# Story 34.4: Response-Path Integrity + Epic-Gate Durability

Status: ready-for-dev

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

- [ ] **Task 1 — Pin the inherited signature live (Rule #16)** (AC: 34.4.1)
  - [ ] Read `%Atelier.REST`'s `RenderResponseBody` from the class library (`iris_doc_get`, or the local `irislib` export) and record its EXACT signature — parameter names, types, defaults, return type. Do not guess it; an override with a mismatched signature either fails to compile or silently shadows nothing.
- [ ] **Task 2 — Base class** (AC: 34.4.1)
  - [ ] Create `src/ExecuteMCPv2/REST/Base.cls` — `Class ExecuteMCPv2.REST.Base Extends %Atelier.REST` — overriding `RenderResponseBody` to pre-flight serialization and, on failure, emit a minimal pre-validated error envelope. Call `##super()` for the success path so behavior is unchanged (AC 34.4.4).
  - [ ] Re-parent the **15** handlers that call it (one line each): `Analytics`, `Command`, `Config`, `EnvSync`, `Global`, `Health`, `Interop`, `Loc`, `MessageResend`, `Monitor`, `Security`, `SqlAdvisor`, `SystemConfig`, `Task`, `UnitTest`.
  - [ ] **Decide explicitly** whether `Dispatch.cls` is re-parented: it has **zero** `RenderResponseBody` calls, so it needs nothing functionally. Consistency argues for it; Rule #39 ordering (Dispatch stays LAST) argues for care. Record the decision either way — do not leave it unstated.
- [ ] **Task 3 — Rule #39 rosters for the NEW bootstrapped class** (AC: 34.4.6)
  - [ ] Add `REST/Base.cls` to `scripts/gen-bootstrap.mjs` `classes[]` — **ordered**, and it must come BEFORE every class that extends it; `REST/Dispatch.cls` stays LAST.
  - [ ] Add it to `packages/shared/src/__tests__/bootstrap.test.ts`: classPaths roster **+ expected-names + count** (all three — `gen:bootstrap` regenerates content only, it does NOT update rosters).
- [ ] **Task 4 — `truncated` on error envelopes** (AC: 34.4.2)
- [ ] **Task 5 — Default-suite gate legs (b)/(c)/(d)** (AC: 34.4.3, 34.4.5)
- [ ] **Task 6 — Back-compat + mutation evidence** (AC: 34.4.4, 34.4.5)
- [ ] **Task 7 — Gates** (AC: 34.4.6)
  - [ ] `pnpm run gen:bootstrap`, record BOOTSTRAP_VERSION from→to; `bootstrap.test.ts` green.
  - [ ] `pnpm gen:governance-baseline:check` (`:check` ONLY) exit 0 — frozen `1e62c5ad5bf7` / 141 / 201 / 60.
  - [ ] `pnpm turbo run build test lint type-check`; changeset added.
  - [ ] C-2: `iris_doc_list(filter="ExecuteMCPv2.REST.Command", generated=true)` → exactly one generated routine.

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

### Debug Log References

### Completion Notes List

### File List
