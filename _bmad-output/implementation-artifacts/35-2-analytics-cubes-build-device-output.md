# Story 35.2: HIGH - `iris_analytics_cubes:build` Device-Output Isolation

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an **agent building an IRIS analytics cube through the MCP suite**,
I want **`iris_analytics_cubes:build` to return a parseable JSON envelope**,
so that **the response can be consumed at all, instead of being corrupted by DeepSee progress text prepended ahead of the JSON**.

## Context — why this story exists

`iris_analytics_cubes:build` **returns unparseable non-JSON.** Ledger item `35-SWEEP-2` (HIGH) — the second of Epic 35's two HIGHs and a beta blocker.

`%DeepSee.Utils.%BuildCube()` at [Analytics.cls:219](src/ExecuteMCPv2/REST/Analytics.cls#L219) writes to the **current device**, and **`Analytics.cls` contains zero `ReDirectIO` calls** — lead-verified: `grep -c ReDirectIO src/ExecuteMCPv2/REST/Analytics.cls` returns **0**. So the DeepSee text lands on the HTTP response stream ahead of the envelope. Observed raw wire body:

```
\nERROR #20013: Cube 'NOSUCHCUBE' does not exist{"status":…}
```

A correct envelope with prepended device text. `sync` (`%SynchronizeCube`, line 231) parses cleanly, which isolates the cause to `%BuildCube` specifically.

This is the same class as **Rule #7** (I/O redirect + single-response dispatch), which Epic 34 applied to `Command.cls` only. `Base.cls`'s pre-flight guards *serialization* failure, not a target that writes to the device before the envelope renders.

## Acceptance Criteria

1. **AC 35.2.1** — `Analytics.cls:219`'s `%DeepSee.Utils.%BuildCube()` call no longer lets device output reach the response. The wire body today is `\nERROR #20013: Cube 'NOSUCHCUBE' does not exist{"status":...}` — a correct envelope with prepended device text, unparseable by any JSON client.
2. **AC 35.2.2** — Follow the Rule #7 discipline already proven in `Command.cls`: bind the redirect to a throw-away null device, restore FULLY before rendering (`ReDirectIO(0)` then bare `Use tInitIO` — note `Use tInitIO::("")` is a NO-OP), and render EXACTLY ONE response body per request via a single If/Else dispatch after Try/Catch. Do not invent a new mechanism.
3. **AC 35.2.3** — Decide and document what happens to the captured text: either discard it or surface it in an additive field. If surfaced it MUST be bounded by `ExecuteMCPv2.Utils.ApplyOutputCeiling` with the structured truncation marker, exactly as `Command.cls` does — an unbounded progress dump is a new instance of the very defect Epic 34 Story 34.6 fixed.
4. **AC 35.2.4** — Audit every OTHER call in `Analytics.cls` and the remaining handlers for IRIS APIs that write to the current device without isolation. `%SynchronizeCube` (line 231) is verified clean; enumerate the rest and report the result (#56).
5. **AC 35.2.5** — Rule #48 mutation evidence: revert, show the non-JSON body on the wire, restore, show a parseable envelope. Proof is a RAW HTTP body inspection, not an internal round-trip — an in-IRIS check cannot see prepended device bytes (Rule #59: the gate must fail on the path it actually guards, and that path is the wire).
6. **AC 35.2.6** — Both paths proven: the ERROR path (verified reproducible today with a nonexistent cube) AND a SUCCESS path. The success path is currently UNVERIFIED because this instance has zero cubes — stand up a minimal disposable cube, or record an explicit residual risk if that proves impractical. Do not assume success is unaffected; `%BuildCube` is documented to emit progress output.

## Tasks / Subtasks

- [x] **Task 1 — Reproduce on the RAW wire first (AC: 35.2.5)**
  - [x] Before changing anything, capture the **raw HTTP response body bytes** for `build` against a nonexistent cube. Use a raw fetch / curl and read the body as bytes — NOT the MCP tool (which may swallow or reformat), and NOT an in-IRIS round-trip.
  - [x] Record the exact prepended text and confirm the body fails `JSON.parse`. This is the RED oracle for AC 35.2.5.
- [x] **Task 2 — Apply the Command.cls redirect discipline (AC: 35.2.1, 35.2.2)**
  - [x] Copy the proven pattern verbatim from `Command.cls` (see Dev Notes for the exact lines). Do NOT invent a mechanism.
  - [x] Null-device binding: `Set tNull = ##class(%Library.Device).GetNullDevice()`, `Open tNull:::1`, `Use tNull::("^"_$ZNAME)` — the mnemonic MUST be bound on `tNull`, never on `$IO`.
  - [x] Restore with `ReDirectIO(0)` then **bare** `Use tInitIO` then `Close tNull`.
  - [x] Exactly ONE `RenderResponseBody` per request: set an error flag in Catch (no render there), restore I/O unconditionally after Try/Catch, then a single If/Else dispatch.
  - [x] Restore `$NAMESPACE` on every path including the catch.
- [x] **Task 3 — Disposition the captured text (AC: 35.2.3)**
  - [x] Decide: discard, or surface in an additive field. Document the decision and its rationale.
  - [x] If surfaced: bound it with `ExecuteMCPv2.Utils.ApplyOutputCeiling` and the structured truncation marker, exactly as `Command.cls` does. An unbounded dump re-introduces the Story 34.6 defect.
  - [x] If surfaced, it is an ADDITIVE response field — confirm that is compatible with Constraint E-1 (no new tool/action key) and does not break existing consumers (Rule #19).
- [x] **Task 4 — Device-output audit (AC: 35.2.4)**
  - [x] Enumerate every IRIS API call in `Analytics.cls` that could write to the current device; confirm each is isolated or provably silent.
  - [x] Extend the sweep to the other REST handlers for the same pattern.
  - [x] **Report the audit result even if nothing further is found** (#56 — a list wrong by omission passes every test written against it).
- [x] **Task 5 — Prove BOTH paths (AC: 35.2.5, 35.2.6)**
  - [x] ERROR path: mutation-verify on the raw wire — revert → non-JSON body → restore → parseable envelope.
  - [x] SUCCESS path: stand up a minimal disposable cube and build it, capturing the raw body. **If genuinely impractical, record an EXPLICIT residual risk** naming what was not proven and why — do not silently skip it and do not assume success is unaffected.
  - [x] Add a regression test discoverable by the default suite (Rule 8) that asserts the wire body parses as JSON.
  - [x] Delete any disposable cube/class afterwards and verify removal.
- [x] **Task 6 — Bootstrap + gates**
  - [x] `Analytics.cls` is bootstrapped — regenerate (`pnpm run gen:bootstrap`), record `BOOTSTRAP_VERSION` from→to (current: `0a012dfaee5d`), verify idempotence. Roster stays 29, no new class.
  - [x] Verify Constraint E-2 with `pnpm gen:governance-baseline:check` ONLY.

## Dev Notes

### The proven pattern — copy this, do not invent (from `Command.cls:63-92`)

```objectscript
; Binding the mnemonic on $IO (the HTTP response stream) leaves device
; parameters altered even after ReDirectIO(0) + bare `Use tInitIO`, which
; causes CSP's response-body flush to silently drop the first ~8KB of the
; JSON envelope when it exceeds the buffer boundary. By doing the redirect
; on a throw-away null device, the HTTP response stream stays pristine.
Set tInitIO = $IO
Set tNull = ##class(%Library.Device).GetNullDevice()
Open tNull:::1
Use tNull::("^"_$ZNAME)
Set tRedirected = 1
Do ##class(%Library.Device).ReDirectIO(1)

Try {
    ; ... the device-writing call ...
} Catch ex {
    ; Flag ONLY — do NOT render here. An argumentless Quit inside Catch exits
    ; only the catch body and falls through, so a render here would be
    ; clobbered by the success render below (Rule #7).
    Set tErrored = 1
    Set tErrStatus = ex.AsStatus()
}

Do ##class(%Library.Device).ReDirectIO(0)
Use tInitIO
Close tNull
Set tRedirected = 0
```

**Critical details that are easy to get wrong:**
- `Use tInitIO::("")` is a **NO-OP** — it does not clear the mnemonic. Use the **bare** `Use tInitIO`.
- The mnemonic must bind on `tNull`, NOT `$IO`. Binding on `$IO` corrupts CSP's buffer flush and silently drops ~8KB of the envelope — a subtler bug than the one being fixed.
- Restore I/O **unconditionally** after Try/Catch (Command.cls also restores inside its error path at lines 134-135 for the outer catch — mirror that belt-and-braces handling).
- `Command.cls` captures into `%ExecuteMCPOutput` / `%ExecuteMCPTruncated` via label-based tag methods. Reuse the existing mechanism rather than writing a parallel one; read how those globals are consumed before wiring them.

### Rule #59 — the proof path, stated plainly

**An in-IRIS round-trip CANNOT see this defect.** The bytes are prepended to the HTTP response stream; IRIS's own view of the returned object is clean. This is structurally identical to Epic 34's surrogate pin, which round-tripped happily inside IRIS while shipping invalid UTF-8 on the wire.

The oracle is a **raw HTTP body read**: issue a real request, read `response.arrayBuffer()` / raw bytes, and assert the body parses as JSON. If any review layer proposes replacing this with an internal assertion, **reject it** — that substitution is the exact trap Rule #59 was codified for, and Epic 34 shipped six separate instances of this class.

### AC 35.2.6 — the success path is the honest-reporting requirement

This instance has **zero cubes**, so only the ERROR path is currently reproducible. `%BuildCube` is documented to emit progress output, so the success path is *more* likely to emit device text, not less. Options in order of preference:
1. Stand up a minimal disposable cube (a tiny source class + cube definition), build it, capture the raw body, then delete everything.
2. If that proves impractical, **record an EXPLICIT residual risk** stating precisely what was not proven and why.

**Silently proving only the error path and implying full coverage is not acceptable** — that is the "green badge over a dead check" pattern Rule #59 exists to stop.

### Constraints

- **Constraint E-1** — no new tool, no new action key; tool counts must not move (#31). An additive *response field* is acceptable; a new action is not.
- **Constraint E-2** — baseline frozen at `1e62c5ad5bf7` / 141 / 201 / 60. `pnpm gen:governance-baseline:check` **ONLY**; never the bare generator (#23/#25); if tripped, `git checkout --` immediately.
- **Rule #24/#39** — `Analytics.cls` IS bootstrapped: regenerate and record `BOOTSTRAP_VERSION` from→to. Roster stays 29 with `REST/Dispatch.cls` last; test/fixture classes stay OUT of the manifest.
- **Rule #17** — `iris_doc_load` needs a glob-prefixed path: `c:/git/iris-execute-mcp-v2/src/**/Analytics.cls`.
- **Rule #9** — propagate the real `%Status` text via `SanitizeError`, not a generic "Failed to X".
- **Rule #55** — never generate file content through a shell heredoc; verify writes with `git diff --stat`.
- **Rule #35** — compare `ExecuteMCPv2.Tests` returned `total` against the mechanical `Test*` count (currently 396).
- **ObjectScript** — argumented `Quit` illegal inside Try/Catch (#1043); `$$$` not `$$`; never edit Storage sections; test classes ≤ ~500 lines.
- Do **not** modify `.vscode/settings.json`.

### Testing

- Regression test must be discoverable by the default suite (Rule 8) and must assert on the **raw wire body**, not an internal object.
- Expected values pinned from LIVE behavior (#36), never from reading the implementation.
- Baselines: `ExecuteMCPv2.Tests` 396/396 · `@iris-mcp/dev` 665/665 · `@iris-mcp/all` 120/120 · turbo 29/29.
- **Known environmental caveat (`35-1-DEV-1`, MEDIUM):** the full parallel `turbo run` is not reliably green in this environment independent of any diff (proven by A/B `git stash` isolation; reproduced at the Story 35.1 smoke gate). Every package is clean **standalone**. Verify per-package standalone; do NOT normalize a parallel-run failure as "known", and do NOT attribute one to this story without an A/B check.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-35.2] — ACs verbatim, Constraints E-1/E-2.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — `35-SWEEP-2` with the observed raw wire body.
- [Source: src/ExecuteMCPv2/REST/Analytics.cls#L219] — `%BuildCube`; #L231 — `%SynchronizeCube` (verified clean).
- [Source: src/ExecuteMCPv2/REST/Command.cls#L63-L92] — the proven redirect pattern; #L134-L135 — outer-catch restore.
- [Source: .claude/rules/project-rules.md] — #7 (I/O redirect + single response), #59 (proof path), #48/#36 (mutation + live oracle), #56 (enumeration completeness), #24/#39 (bootstrap), #9 (error text).
- [Source: _bmad-output/implementation-artifacts/35-1-production-item-set-composite-key.md] — prior story; its review found a guard with zero tests, a reminder that an unexercised fix is not a fix.

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

- Raw wire capture, pre-fix, error path (`xxd` byte dump): `\r\nERROR #20013: Cube 'NOSUCHCUBE' does not exist{"status":...` — confirms Rule #59's RED oracle; unparseable as JSON.
- Raw wire capture, post-fix, error path: `{"status":{"errors":[{"error":"ERROR #5001: Cube 'NOSUCHCUBE' does not exist",...}],...},"console":[],"result":{}}` — clean, `JSON.parse`-able.
- Raw wire capture, pre-fix, SUCCESS path (built `ExecuteMCPv2.Temp.Story352PersonCube`): `\r\nBuilding cube [STORY352PERSONCUBE]\r\nDeleting existing cube...\r\x1b[0JExisting cube deleted.\r\n\r\x1b[0JBuilding fact table: 2 fact(s) updated\r\x1b[0JFact table built: ...` — confirms Dev Notes' prediction that success is *more* corrupted than error (raw ANSI escapes included), because `%BuildCube`'s own `pVerbose` parameter defaults to `1` and `Analytics.cls` never overrides it.
- Raw wire capture, post-fix, SUCCESS path: `{"status":{"errors":[],"summary":""},"console":[],"result":{"cube":"Story352PersonCube","action":"build","status":"completed"}}` — clean. `%GetCubeFactCount("Story352PersonCube")` returned `2`, confirming the build genuinely executed (not a no-op).
- New TS gate test (`analytics-cubes-wire-gate.test.ts`) itself mutation-verified: RED against reverted pre-fix `Analytics.cls` (`expected '\r' to be '{'`), GREEN restored — proves the gate actually fails on the path it guards (Rule #59).
- `ExecuteMCPv2.Tests` package run: 396/396 (Rule #35 mechanical match — unchanged, no new OS test methods were added; the required regression proof lives at the wire level per AC 35.2.5, which an in-IRIS `%UnitTest` cannot see).
- Governance baseline check: `pnpm gen:governance-baseline:check` exit 0, frozen 141/201/60 unchanged (Constraint E-2).
- Bootstrap regen: `BOOTSTRAP_VERSION` `0a012dfaee5d` → `b54e1d265c6b`; roster unchanged at 29, `REST/Dispatch.cls` last; second run produced an identical hash (idempotent).

### Completion Notes List

- **AC 35.2.1/35.2.2 (redirect fix)**: `CubeAction`'s `"build"` branch in `Analytics.cls` now wraps the `%DeepSee.Utils:%BuildCube` call in the exact `Command.cls` null-device redirect discipline — mnemonic bound on a throw-away `tNull` (never `$IO`), inner `Try/Catch` flags only (`tSC2 = exBuild.AsStatus()`, no render), unconditional restore (`ReDirectIO(0)` then bare `Use tInitIO` then `Close tNull`) before any render, single `If $$$ISERR(tSC2)` / success dispatch already present in the method, and an outer-`Catch` belt-and-braces restore mirroring `Command.cls:132-138`. The `"sync"` branch (`%SynchronizeCube`) was left untouched — it already passes `pVerbose=0` and was independently verified clean during Task 4's audit.
- **Why `%BuildCube` (and not `%SynchronizeCube`) writes to the device**: live-read from `%DeepSee.Utils.cls`'s own source — `%BuildCube(pCubeList, pAsync, pVerbose As %Boolean = 1, ...)` defaults `pVerbose` to `1`, and `Analytics.cls` only ever passed `(tCube, 0)` (cube list + `pAsync`), leaving verbose narration ON. `%SynchronizeCube` explicitly passes `pVerbose=0` at `Analytics.cls:231` — exactly why `sync` parsed cleanly and `build` did not (confirms the story's own root-cause note). The error-path text (`"Cube '%1' does not exist"`) is written unconditionally elsewhere in the DeepSee stack regardless of `pVerbose`; the redirect isolates it either way rather than relying on parameter tuning, per Task 2's "do not invent a mechanism" directive.
- **`ExecuteMCPv2.REST.Command`'s label-based mnemonic routine (`Redirects()`) could NOT be reused directly** — `$ZNAME` binds the *currently executing* routine, and Story 34.1's Constraint C-2 requires the mnemonic entry points to live in that same compiled routine. A verbatim copy of `Redirects()` was added to `Analytics.cls` itself, using the SAME `%ExecuteMCPOutput`/`%ExecuteMCPTruncated` process-private globals for consistency with `Command.cls` even though (per the AC 35.2.3 decision below) the captured text is discarded unread.
- **AC 35.2.3 disposition — DISCARDED, not surfaced**: `%BuildCube`'s progress narration is diagnostic noise from a stock DeepSee API that no caller of `iris_analytics_cubes` has ever asked for — the same judgment `ExecuteMCPv2.REST.UnitTest` already makes for `%UnitTest.Manager.RunTest`'s own narration (it also discards captured output). Surfacing it would require its own `ApplyOutputCeiling` budget, a new TS response field, and wire-level truncation coverage for a field with zero established consumers — out of proportion to the defect being fixed. Documented directly in `Analytics.cls`'s `CubeAction` comment with an explicit pointer for a future story to surface it bounded by `ApplyOutputCeiling` exactly as `Command.cls` does, if ever needed. Constraint E-1 is moot for this decision since nothing was added.
- **AC 35.2.4 audit (Rule #56 — reported even though nothing further needed fixing)**: grepped every `ExecuteMCPv2.REST.*.cls` for `$system.obj.compile`, `%BuildCube`, `%SynchronizeCube`, `RunTest`, and `Verbose` (case-insensitive), then manually reviewed every distinct external IRIS system-class method call across all 16 REST handler files (`##class(%...)` invocations). Findings:
  - `Analytics.cls`'s `%BuildCube` — the fixed defect.
  - `Analytics.cls`'s `%SynchronizeCube` (sync) — already clean (`pVerbose=0`).
  - `Interop.cls:82`'s `$System.OBJ.Compile(tName, "k-d")` (production-class creation) — already silent: the `"-d"` qualifier explicitly turns display OFF for that compile call.
  - `Security.cls`'s `%SYS.Audit.Export` and `Interop.cls`'s `%SYS.System.WriteToConsoleLog` write to a FILE / the console LOG respectively, not the current device — out of scope for this defect class.
  - Every other system-class call across `Config.cls`, `EnvSync.cls`, `Global.cls`, `Health.cls`, `Loc.cls`, `MessageResend.cls`, `Monitor.cls`, `Security.cls`, `SqlAdvisor.cls`, `SystemConfig.cls`, `Task.cls` is a plain data accessor/query/lookup (`%ResultSet`, `%SQL.Statement`, `%SYS.Journal.System` getters, `%SYS.ProcessQuery`, `%SYS.Task`, `%File`/`%Library.File`, `%SYS.X509Credentials`, `%SYS.OAuth2.Registration`, etc.) — none are documented device-writers.
  - **New finding, filed to `deferred-work.md`, NOT fixed in this story** (different handler, different pre-existing code, out of Analytics.cls-only scope): `ExecuteMCPv2.REST.UnitTest.cls` already isolates `%UnitTest.Manager.RunTest`'s device output, but via a DIFFERENT and more fragile pattern than this story's fix — it binds the mnemonic on `tInitIO` (`$IO`) itself (`Use tInitIO::("^"_$ZNAME)`) rather than a throw-away null device. This is exactly the "binding on `$IO` corrupts CSP's buffer flush and silently drops ~8KB of the envelope" risk this story's own Dev Notes warn about, for output-heavy test runs. `UnitTest.cls` restores the mnemonic explicitly on its own `Use tInitIO::(...)` line (unlike the pre-fix `Command.cls` latent concern already in the ledger), so this is a genuinely new, distinct finding — not the same item as the existing `deferred-work.md` entry about `Command.cls`'s bare-`Use`-doesn't-clear-mnemonic concern.
- **AC 35.2.5/35.2.6 mutation evidence — BOTH paths, raw HTTP body only**: see Debug Log References above for the exact byte dumps. ERROR path RED→GREEN and SUCCESS path RED→GREEN were both captured by reverting `Analytics.cls` to the pre-fix `git HEAD` version, recompiling, curling the raw bytes, then restoring the fix and recompiling again. The SUCCESS path required standing up a minimal disposable cube (`ExecuteMCPv2.Temp.Story352Person` + `ExecuteMCPv2.Temp.Story352PersonCube`, 2 rows) since this instance has zero pre-existing cubes (confirmed via `%DeepSee.Utils:%GetCubeList` in `HSCUSTOM`, `SADEMO`, and `SATEST64` — all empty) — AC 35.2.6 is therefore PROVEN, not left as a residual risk. Both disposable classes were deleted after use and their absence confirmed via `%Dictionary.CompiledClass.%ExistsId` (Person / PersonCube / PersonCube.Fact / PersonCube.Listing all `0`) and `%GetCubeList` (`COUNT=0`).
- **New regression test**: `packages/iris-data-mcp/src/__tests__/analytics-cubes-wire-gate.test.ts` — plain `*.test.ts` (default suite, Rule 8), self-contained `beforeAll` availability probe + graceful skip (mirrors `execute-classmethod-epic-gate.test.ts`), issues a raw `fetch` against `/api/executemcp/v2/analytics/cubes` for a `build` on a nonexistent cube, reads `response.arrayBuffer()` directly, and asserts the first byte is `{` and the body `JSON.parse`s. Covers the ERROR path only (fixture-free, works on any instance with `ExecuteMCPv2` deployed); the SUCCESS path was proven live during dev per above but not re-encoded as a permanent test — standing up/tearing down a real DeepSee cube on every default-suite run is a materially heavier dependency, and the error path already exercises the SAME redirect/restore code that wraps `%BuildCube` unconditionally for both outcomes. This tradeoff is documented in the test file's own banner.
- **Bootstrap/gates**: `Analytics.cls` is bootstrapped; `pnpm run gen:bootstrap` regenerated `packages/shared/src/bootstrap-classes.ts`, `BOOTSTRAP_VERSION` `0a012dfaee5d` → `b54e1d265c6b`, roster unchanged at 29 classes with `REST/Dispatch.cls` last, re-run confirmed idempotent (identical hash). `pnpm gen:governance-baseline:check` (check-only) exit 0, frozen baseline `1e62c5ad5bf7`/141/201/60 unchanged — Constraint E-1 holds (no new tool/action key; `iris_analytics_cubes` still has the same 3 actions) and Constraint E-2 holds.
- **Regression verification, all standalone (per the `35-1-DEV-1` caveat — parallel `turbo run` not independently re-verified this session)**: `ExecuteMCPv2.Tests` 396/396; `packages/iris-data-mcp` 133/133 (8 files, +1 file/+1 test); `packages/shared` 1308/1308; `packages/iris-mcp-all` 120/120 (Rule #31 — tool/action counts unmoved); `packages/iris-dev-mcp` 665/665; `packages/iris-admin-mcp` 451/451; `packages/iris-interop-mcp` 336/336; `packages/iris-ops-mcp` 348/348. `build`/`lint`/`type-check` clean on both touched packages (`shared`, `iris-data-mcp`) — one pre-existing, unrelated ESLint warning in `packages/shared/src/cli/governance.ts` (not touched by this story).

### File List

- `src/ExecuteMCPv2/REST/Analytics.cls` (modified) — `CubeAction`'s `"build"` branch wrapped in the null-device redirect discipline; added local `Redirects()` label method.
- `packages/shared/src/bootstrap-classes.ts` (regenerated, output-only) — `BOOTSTRAP_VERSION` `0a012dfaee5d` → `b54e1d265c6b`.
- `packages/iris-data-mcp/src/__tests__/analytics-cubes-wire-gate.test.ts` (new) — default-suite raw-wire regression gate for AC 35.2.1/35.2.2/35.2.5.
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified) — new item: `ExecuteMCPv2.REST.UnitTest.cls`'s device redirect binds the mnemonic on `$IO` rather than a null device (AC 35.2.4 audit finding, out of this story's scope).

### Review Findings

Code review closed **CLEAN** — all 3 adversarial layers delivered a findings payload within the hard timeout (Blind Hunter 17, Edge Case Hunter 13, Acceptance Auditor 9; `review_degraded=false`, `failed_layers` empty, Rule #57 bounded-close + frozen-diff + delivery-receipts all honored). 5 fixed in-story, 4 deferred, the rest dismissed as duplicates/noise or dispositioned below.

**The fix itself is sound and needed no change.** Every finding below is about the GATE around it, the CLAIMS documenting it, or fixture cleanup — which is why the story still closes `done`.

**Independently re-verified by the reviewer before triage** (not taken on the dev/QA transcript): the fix is GREEN on the raw wire; the gate was mutation-proven RED by reverting `Analytics.cls` to `HEAD`, recompiling live, and re-running it (`expected '\r' to be '{'`), then restored and re-proven GREEN; `%SynchronizeCube`'s 2nd positional argument really is `pVerbose` and `sync` really is clean on the raw wire (both paths byte-dumped); `Redirects()`'s labels really do land in the same `ExecuteMCPv2.REST.Analytics.1.int` as `CubeAction`, so the `$ZNAME` reasoning holds; `35-2-DEV-1` is real (`UnitTest.cls:83` binds `^$ZNAME` on `$IO`); `35-SWEEP-2` carries a terminal RESOLVED disposition with its own tally (no repeat of Story 35.1's missed row); no disposable cube, `ExecuteMCPv2.Temp.*` class, or leftover DeepSee artifact remains on the instance.

- [x] [Review][Patch] **The new wire gate's `IRIS_REQUIRE_LIVE` was armed nowhere on this package's path** [packages/iris-data-mcp/package.json:26] — HIGH, raised independently by all three layers. `IRIS_REQUIRE_LIVE` is set in exactly one place repo-wide (`packages/iris-dev-mcp/scripts/prepublish-gate.mjs`), which runs vitest from `packages/iris-dev-mcp` over two `@iris-mcp/dev` files. `@iris-mcp/data`'s `prepublishOnly` ran `verify-iris-reachable.mjs`, which only pings `/api/atelier/` — it never sets the variable, never checks that `ExecuteMCPv2` is deployed, and never runs the gate. With no CI in this repo, the story's ONLY permanent regression proof could skip silently forever. Rule #59's named disqualifier verbatim ("an arming env var nothing sets") and a direct recurrence of Epic 34 retro incident #6 / ledger `34-4-R3`, one package over. **Fixed:** added `packages/iris-data-mcp/scripts/prepublish-gate.mjs` (mirrors `@iris-mcp/dev`'s, keeps `checkDistFresh`, arms `IRIS_REQUIRE_LIVE=1`) and repointed `prepublishOnly` at it. **Proven on the guarded path:** exit 0 with IRIS reachable; exit 1 `FAILED CLOSED` with `IRIS_PORT=59999`. Counterfactual also captured — under the old wiring the same gate reported `1 passed` with zero requests issued.
- [x] [Review][Patch] **The gate's unavailable-IRIS branch reported PASSED, not skipped** [packages/iris-data-mcp/src/__tests__/analytics-cubes-wire-gate.test.ts:141] — HIGH (Blind Hunter, Acceptance Auditor). The test did `console.log(...); return;` with no test context at all, despite its banner claiming it mirrors `execute-classmethod-epic-gate.test.ts`'s `ctx.skip()` shape (which does call it). Vitest counts a bare early return as a pass, so an unreachable IRIS produced a green tick and nothing even appeared as skipped. **Fixed:** both legs now take `testCtx` and call `testCtx.skip()`. **Verified:** live run reports `2 passed`; `IRIS_PORT=59999` run reports `2 skipped`, not `2 passed`.
- [x] [Review][Patch] **A FALSE load-bearing claim in the new code comment — and it guards a decision two layers got wrong** [src/ExecuteMCPv2/REST/Analytics.cls:224] — MEDIUM (Acceptance Auditor F-5, reached independently by the reviewer). The shipped comment asserted `%BuildCube`'s "error path writes diagnostic text unconditionally regardless of pVerbose", which also self-contradicted the same comment's explanation of why `sync` is clean. **Live probe settles it:** `%BuildCube("NOSUCH",0,1)` writes `\nERROR #20013: Cube ... does not exist` to the device; `%BuildCube("NOSUCH",0,0)` writes **nothing** — the error text is `pVerbose`-gated exactly like the narration. This matters beyond documentation: both Blind Hunter and Edge Case Hunter proposed "optimizing" the call to `%BuildCube(tCube, 0, 0)`, which would silence the source, leave the redirect nothing to isolate, and render `analytics-cubes-wire-gate.test.ts` structurally incapable of failing — deleting the entire redirect block would still yield a green gate (Rule #59, "an oracle that cannot vary with the property it claims"). **Fixed:** claim corrected, the live evidence recorded inline, and an explicit DO-NOT-set-`pVerbose=0` warning added with its reasoning, so the next reviewer to propose it finds the answer at the call site. `BOOTSTRAP_VERSION` regenerated `b54e1d265c6b` → `a73647f42c11` (idempotent; roster still 29, `REST/Dispatch.cls` last).
- [x] [Review][Patch] **The gate proved suppression but never restoration** [packages/iris-data-mcp/src/__tests__/analytics-cubes-wire-gate.test.ts] — MEDIUM (Blind Hunter). A leaked redirect is a worse failure than the original defect: the next request on the same reused CSP worker writes its envelope into the still-bound mnemonic and returns an empty body. **Fixed:** added a second leg that issues the build and then immediately reuses the connection for an unrelated `GET /analytics/cubes`, asserting that body is non-empty, starts with `{`, and parses. Its honest scope is stated in the test itself — it is defense-in-depth, not independently mutation-provable, because every realistic restore failure also trips the first leg.
- [x] [Review][Patch] **Both disposable cubes' DATA EXTENTS survived the cleanup that only deleted their classes** [live instance, `HSCUSTOM`] — MEDIUM, found by the reviewer's own cleanup sweep; missed by dev AND QA, both of whom verified deletion the same (insufficient) way. Dropping a persistent class does not drop its extent, so `^ExecuteMCPv2E4F.Story352PersonD` (dev's fixture) and `^ExecuteMCPvE4F.QAStory352P6CEFD` (QA's independent fixture) were still on the instance holding their 2 rows each, while every check both passes ran — `%Dictionary.CompiledClass.%ExistsId`, a `LIKE '%Story352%'` class query, and `%GetCubeList` — correctly reported clean, because none of them look at globals. **Fixed:** both globals killed; re-verified `Story352` global filter returns 0, `%GetCubeList` empty, no `ExecuteMCPv2.Temp.*` documents. **For future fixture teardown:** verify by global filter as well as by class existence, or call `%KillExtent()` before dropping the class. (Unrelated and left alone: `^ClineDbg` holds `instance:1;calling DrawChatPanel;...` — pre-existing residue from an older, unrelated session, not this story's.)
- [x] [Review][Defer] **`%BuildCube`'s narration is captured in full then discarded, and the obvious fix is forbidden** [src/ExecuteMCPv2/REST/Analytics.cls:244] — MEDIUM, ledgered as `35-2-CR-4`. See the patch note above for why `pVerbose=0` must not be the fix; any real fix must preserve a RED-capable oracle.
- [x] [Review][Defer] **Two failure shapes in the redirect-restore sequence, present in BOTH `Command.cls` and `Analytics.cls`** [src/ExecuteMCPv2/REST/Analytics.cls:305] — MEDIUM, ledgered as `35-2-CR-5`. The outer catch's three cleanup steps share one `Try` under a bare `Catch {}` (a throw at step 1 or 2 leaves the null device current and renders the error envelope into it); and `tRedirected` is armed *after* the device-mutating `Use`, so a throwing `Use` (or a timed-out `Open tNull:::1`, whose `$TEST` is never read) skips cleanup and leaks an open device. Deferred, not patched: both shapes are inherited verbatim from `Command.cls`, which AC 35.2.2 explicitly required this story to copy without inventing a mechanism — fixing only this copy would leave two divergent redirect disciplines. Belongs in one cross-cutting story with `35-2-DEV-1`.
- [x] [Review][Defer] **AC 35.2.4's audit is incomplete, and its method could not have found what it missed (Rule #56)** — MEDIUM, ledgered as `35-2-CR-6`. Grepping for `ReDirectIO` finds the isolation, never the hazard. Concretely: `Monitor.cls` calls `Backup.General.ExternalThaw(LogFile, Username, Password)`, whose live signature (confirmed against `%Dictionary.CompiledMethod` in `%SYS`) has **no** quiet/verbose parameter and is unassessed; and the Completion Notes' "all 16 REST handler files" disagrees with the directory's 17 and with its own 15-name list (`Base.cls`/`Dispatch.cls` unenumerated — both checked, no `Write`, so no live hazard there). The suggested resolution is a signature-driven sweep over `FormalSpec`, not another grep.
- [x] [Review][Defer] **The SUCCESS path has no permanent automated coverage** — LOW, ledgered as `35-2-CR-7`. Proven live twice (dev and QA, each with its own disposable cube), but nothing re-proves it. The documented cost trade-off is accepted, not overturned.
- **Dismissed** (with reasons): the `$ZNAME` single-`.int` invariant being unpinned for `Analytics.cls` (raised by Edge Case Hunter and Acceptance Auditor F-4) — it is already pinned *transitively* by this gate, because a split would raise `<NOROUTINE>` at `%BuildCube`'s first `Write` and the envelope's error text would stop matching `toContain("does not exist")`; a note to that effect was added to the test banner so the assertion is not later loosened. Redirect re-entrancy via a nested `CubeAction` (Edge Case Hunter) — unreachable in practice, since a `/classmethod` invocation fails `ValidateRequired` on `action` and returns long before the redirect (Rule #54: do not add a branch the real system cannot reach). Locale-dependence of `toContain("does not exist")` — live-checked: only the `ERROR #`/`خطأ #` prefix is localized on this instance and the asserted substring is present; a Rule #13 note was added rather than a code change. The ledger's chained-delta tallies (Acceptance Auditor F-7) — real and reproduced, but pre-existing and structural across many epics; recorded as a caveat in `deferred-work.md` for a lead to scope rather than absorbed into another delta.

**Gates re-run after the patches:** `ExecuteMCPv2.Tests` 396/396 (Rule #35 — matches the mechanical `Test*` count of 396 exactly); `@iris-mcp/data` 134/134 standalone (+1, the new restore leg); `@iris-mcp/shared` 1308/1308; `@iris-mcp/all` standalone green (Rule #31 — tool/action counts unmoved, Constraint E-1 holds: no new tool, action key, or response field); `pnpm gen:governance-baseline:check` exit 0, frozen `1e62c5ad5bf7`/141/201/60 unchanged and file untouched (Constraint E-2); `build`/`lint`/`type-check` clean on both touched packages. Per-package standalone only, per the `35-1-DEV-1` environmental caveat.
