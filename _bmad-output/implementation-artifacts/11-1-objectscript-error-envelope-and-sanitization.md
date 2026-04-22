# Story 11.1: ObjectScript error envelope & sanitization

Status: done

## Story

**As an** AI client or developer calling `iris_execute_command` or any handler that may propagate an error,
**I want** error responses to be structured JSON with a clear single-wrapped status message,
**so that** I can read the actual error text and react to it instead of hitting an opaque "non-JSON response" crash or a doubly-wrapped `خطأ #5001: خطأ #5001:` chain.

## Trigger

Epic 11 Bug Batch — 3 bugs from the 2026-04-21 comprehensive MCP test pass. See [sprint-change-proposal-2026-04-21.md](../planning-artifacts/sprint-change-proposal-2026-04-21.md):

- **Bug #1** — `iris_execute_command` crashes with `"IRIS returned a non-JSON response for POST /api/executemcp/v2/command. Expected an Atelier envelope but could not parse the body."` on any runtime ObjectScript error (malformed command, `<DIVIDE>`, `<CLASS DOES NOT EXIST>`, etc.). Despite the existing `Try/Catch` envelope in [Command:Execute()](../../src/ExecuteMCPv2/REST/Command.cls#L18), the error path does not produce a valid JSON response.
- **Bug #11** — `Utils.SanitizeError` produces doubly-wrapped error codes: `خطأ #5001: خطأ #5001: Failed to change password for user 'X'`. The `$$$ERROR($$$GeneralError, …)` wrapper is applied to text that already contains a `ERROR #N:` prefix, so `GetErrorText` prepends another one when the outer caller renders the status.
- **Bug #8** — `iris_user_password action:"validate"` with a short candidate password (e.g., `"a"`) over-redacts the IRIS-returned error message. Candidate `"a"` produces `"P***ssword does not m***tch length or p***ttern requirements"` — every `a` in the IRIS error text is replaced by `***` because the redaction on [Security:UserPassword()](../../src/ExecuteMCPv2/REST/Security.cls#L433) does an unconditional `$Replace(tMsg, tPassword, "***")` without length guarding.

## Acceptance Criteria

1. **AC 11.1.1** — `iris_execute_command` with any runtime error returns a structured JSON error response with `isError: true` and a readable error text. Tested reproductions (all must return valid JSON, not "non-JSON response"):
   - `iris_execute_command({command: "Write \"unterminated"})` — returns a JSON error mentioning the parse/syntax failure.
   - `iris_execute_command({command: "Set x = 1/0"})` — returns a JSON error mentioning `<DIVIDE>` (or the sanitized equivalent).
   - `iris_execute_command({command: "Do ##class(Bad.NonExistent).Method()"})` — returns a JSON error mentioning `<CLASS DOES NOT EXIST>` or similar.

   Root-cause investigation is required because [Command:Execute()](../../src/ExecuteMCPv2/REST/Command.cls#L18) already has a `Try/Catch` around `XECUTE tCommand` (lines 59–72) plus an outer catch (lines 87–100). Both call `SanitizeError` + `RenderResponseBody`. Yet the client receives non-JSON. Hypothesis: the I/O redirect state (`%Library.Device.ReDirectIO(1)` enabled at line 56, redirect mnemonic set via `Use tInitIO::("^"_$ZNAME)` at line 54) is not fully restored before the catch's `RenderResponseBody` call, so the JSON response is written to `%ExecuteMCPOutput` instead of the HTTP response stream. Specifically, `Use tInitIO::("")` (passed when `tOldMnemonic = ""`) is a no-op that does NOT reset the mnemonic routine — it only changes the mnemonic when given a non-empty value.

2. **AC 11.1.2** — `Utils.SanitizeError` no longer double-wraps error codes. When `pStatus` already contains an `ERROR #N: ` or `خطأ #N: ` prefix (e.g., `GetErrorText` returns `"ERROR #5001: Failed to change password for user 'X'"`), the sanitizer does NOT produce `ERROR #5001: ERROR #5001: Failed to change password for user 'X'` after the `$$$ERROR($$$GeneralError, tSafe)` re-wrap. Fix: strip a leading `^(ERROR|خطأ)\s+#\d+:\s*` (one occurrence) from `tSafe` *before* the final `$$$ERROR($$$GeneralError, tSafe)` wrap. Use ObjectScript-idiomatic `$Find`/`$Extract` — don't pull in a regex library.

3. **AC 11.1.3** — `iris_user_password action:"validate"` with any short candidate password no longer corrupts the IRIS-returned error message. Before: candidate `"a"` → `"P***ssword does not m***tch length or p***ttern requirements"`. After: candidate `"a"` → `"Password does not match length or pattern requirements"` (original message intact). Fix in [Security:UserPassword()](../../src/ExecuteMCPv2/REST/Security.cls#L417) validate branch (lines 417–445): gate the `$Replace(tMsg, tPassword, "***")` call on line 433 with `If $Length(tPassword) >= 8`. Rationale: the IRIS validation message *never* embeds the candidate password (it returns a generic "does not match length or pattern" string), so redacting short-letter candidates from it serves no security purpose and corrupts the message. For candidates ≥ 8 characters, keep the existing guard (the loop on lines 437–440 already had this threshold; the unconditional `$Replace` on line 433 was the oversight).

4. **AC 11.1.4** — `iris_execute_command` error envelope fix investigation and resolution:
   - Reproduce Bug #1 on the running IRIS instance (connect via `mcp__iris-dev-mcp__iris_execute_command` and run the three reproductions from AC 11.1.1).
   - Capture the actual failure mode using the debug-global pattern (`^ClineDebug`) — trace whether the catch is reached, whether `RenderResponseBody` is called, and what the HTTP response body actually contains.
   - Apply the fix. Most likely remedy: before both the inner catch's `RenderResponseBody` call (line 69) and the outer catch's `RenderResponseBody` call (line 98), call `Do ##class(%Library.Device).ReDirectIO(0)` unconditionally (to disable redirect regardless of `tWasRedirected` state) and issue `Use tInitIO` (device-only, no mnemonic argument) to restore the device to the original I/O with its original mnemonic. If that doesn't resolve it, the alternative is to move `RenderResponseBody` OUT of the catch and into a post-catch block that runs after all I/O cleanup.
   - Remove the `^ClineDebug` traces before marking the story complete (leave no debug globals in committed code).

5. **AC 11.1.5** — Unit tests added:
   - [packages/iris-dev-mcp/src/__tests__/execute.test.ts](../../packages/iris-dev-mcp/src/__tests__/execute.test.ts) — `it("returns structured error envelope when server returns JSON error")`. Mock the HTTP layer to return a 500 with a JSON body (same shape as a post-fix real response); assert the tool returns an `isError: true` result with the error text in a `content[0].text` block. This test validates the *tool-side* shape; the *server-side* fix is validated via AC 11.1.4 live verification.
   - [packages/iris-admin-mcp/src/__tests__/user.test.ts](../../packages/iris-admin-mcp/src/__tests__/user.test.ts) — `it("does not redact short candidate password in validate error text")`. Mock the validate response to return `{action: "validate", valid: false, message: "Password does not match length or pattern requirements"}`; assert the tool output's `message` field does NOT contain `***`.

6. **AC 11.1.6** — **Live verification deferred to Story 11.3.** All three ObjectScript fixes in this story become live on the IRIS instance only after Story 11.3's `BOOTSTRAP_VERSION` bump + redeploy. Story 11.1's unit tests pass on merge; the full end-to-end "reproduction returns JSON" check runs as part of Story 11.3 AC 11.3.5. Document the pending verification in the story's Completion Notes.

7. **AC 11.1.7** — CHANGELOG.md gets three new bullets appended to a new `## [Pre-release — 2026-04-21]` block (created in this story — it's the first Epic 11 story, so the block doesn't exist yet), under `### Fixed`:
   - `**iris_execute_command no longer crashes with "non-JSON response" on runtime errors** ([src/ExecuteMCPv2/REST/Command.cls](src/ExecuteMCPv2/REST/Command.cls)) — the Execute handler's catch blocks now fully restore I/O redirect state before calling RenderResponseBody, so the JSON error envelope reaches the HTTP response instead of the captured-output buffer. Bug #1.`
   - `**Utils.SanitizeError no longer double-wraps error codes** ([src/ExecuteMCPv2/Utils.cls](src/ExecuteMCPv2/Utils.cls)) — a leading "ERROR #N: " or "خطأ #N: " prefix is stripped before the final $$$ERROR wrap, so chains collapse to a single prefix. Bug #11.`
   - `**iris_user_password validate error message no longer over-redacts short candidates** ([src/ExecuteMCPv2/REST/Security.cls](src/ExecuteMCPv2/REST/Security.cls)) — the unconditional $Replace of the candidate password in the IRIS validation text is now gated on $Length(tPassword) >= 8, matching the existing partial-match loop threshold. Bug #8.`

8. **AC 11.1.8** — Build + tests + lint green:
   - `pnpm turbo run build` — clean across all packages.
   - `pnpm turbo run test` — target **+2 new tests** (1 in `execute.test.ts`, 1 in `user.test.ts`).
   - `pnpm turbo run lint` — no new warnings on touched files.

9. **AC 11.1.9** — **No `BOOTSTRAP_VERSION` bump in this story.** Stories 11.1 / 11.2 / 11.3 all touch ObjectScript, but the bump lands once at the end of Story 11.3 to cover all three in a single auto-upgrade. Story 11.1 leaves `bootstrap-classes.ts` untouched.

## Tasks / Subtasks

- [x] **Task 1**: Fix `Utils.SanitizeError` double-wrapping (AC 11.1.2)
  - [x] Read [src/ExecuteMCPv2/Utils.cls](../../src/ExecuteMCPv2/Utils.cls) `SanitizeError` method.
  - [x] Added prefix-strip step before the final `$$$ERROR($$$GeneralError, tSafe)` that scans for `"ERROR #"` and `"خطأ #"` (Arabic variant on the `araw`-locale IRIS), slices past `"#N: "` when the code chunk is all digits, and quits after a single strip so angle-bracketed system errors like `<UNDEFINED>` remain untouched.

- [x] **Task 2**: Fix `UserPassword` validate redaction (AC 11.1.3)
  - [x] Read [src/ExecuteMCPv2/REST/Security.cls](../../src/ExecuteMCPv2/REST/Security.cls) validate branch.
  - [x] Gated the unconditional `$Replace(tMsg, tPassword, "***")` with `If $Length(tPassword) >= 8`.
  - [x] Left the existing partial-match loop (already `>= 3`-guarded) unchanged.
  - [x] Live-verified: `iris_user_password action:"validate" password:"a"` now returns `"Password does not match length or pattern requirements"` with every `a` intact (previously: `"P***ssword does not m***tch length or p***ttern requirements"`).

- [x] **Task 3**: Investigate and fix `iris_execute_command` error envelope (AC 11.1.1, 11.1.4)
  - [x] Confirmed Bug #1 reproduces with `Set x = 1/0`, `Write "unterminated`, and `Do ##class(Bad.NonExistent).Method()` — all three produced `"IRIS returned a non-JSON response ..."` before the fix.
  - [x] Traced the inner catch with `^ClineDebug` to capture `tWasRedirected=1`, `tRedirected=1`, `tOldMnemonic="%SYS.cspServer2"`. Root cause: two independent defects in the original catch body: (a) `If tWasRedirected '= tRedirected Do ReDirectIO(tWasRedirected)` is a **no-op** in the real Atelier context because the dispatcher already had redirect enabled (`tWasRedirected=1`, `tRedirected=1`), so the inner catch's own `ReDirectIO(0)` never fired — `RenderResponseBody`'s writes went to the `%ExecuteMCPOutput` buffer instead of the HTTP stream; (b) the argumentless `Quit` inside the `Catch exCmd { ... Quit }` exits only the catch block, NOT the outer Try — control falls through to the success-path `RenderResponseBody($$$OK, , tResult)` which emits a second (success) envelope that clobbers the error one. Fix: hoisted the I/O restore + render OUT of the catches; the catch now only sets a `tCmdErrored` flag and captures `tCmdStatus`. After the inner Try/Catch, the method unconditionally calls `ReDirectIO(0)` and `Use tInitIO` (device-only, no mnemonic), then branches to either the error render or the success render — exactly one `RenderResponseBody` fires per request. Also simplified the outer catch to the same pattern.
  - [x] Live-verified all three AC 11.1.1 reproductions now return structured JSON error envelopes (e.g. `Details: ??? #5001: ObjectScript error: <DIVIDE>Execute`, `<SYNTAX>Execute`, `<CLASS DOES NOT EXIST>Execute *Bad.NonExistent`). Also verified the success path (`Write "Hello World"`) still returns `{"output":"Hello World"}`.
  - [x] Removed all `^ClineDebug` writes from Command.cls; `grep ClineDebug src/` returns no matches. `^ClineDebug` killed on the IRIS instance.

- [x] **Task 4**: Unit tests (AC 11.1.5)
  - [x] Added `it("returns structured error envelope when server returns JSON error")` to [packages/iris-dev-mcp/src/__tests__/execute.test.ts](../../packages/iris-dev-mcp/src/__tests__/execute.test.ts) — mocks an `IrisApiError` with `code:5001` and `<DIVIDE>` error text, asserts `isError:true` and the error text appears in `content[0].text`.
  - [x] Added `it("does not redact short candidate password in validate error text")` to [packages/iris-admin-mcp/src/__tests__/user.test.ts](../../packages/iris-admin-mcp/src/__tests__/user.test.ts) `iris_user_password` describe block — mocks the validate response and asserts `message === "Password does not match length or pattern requirements"` exactly (no `***`).

- [x] **Task 5**: CHANGELOG entry (AC 11.1.7)
  - [x] Added `## [Pre-release — 2026-04-21]` block at the top of [CHANGELOG.md](../../CHANGELOG.md) with a `### Fixed` subheading and the three AC 11.1.7 bullets.

- [x] **Task 6**: Build + validate (AC 11.1.8)
  - [x] `pnpm turbo run build` — 6/6 tasks successful (4 cached).
  - [x] `pnpm turbo run test` — all 12/12 task runs successful; `iris-dev-mcp` 274 tests, `iris-admin-mcp` 204 tests (+2 vs baseline: 1 in `execute.test.ts`, 1 in `user.test.ts`).
  - [x] `pnpm turbo run lint` — the two touched test files (`execute.test.ts`, `user.test.ts`) lint cleanly when checked individually. Pre-existing lint errors on other, untouched files (unused `vi` imports in `compile.test.ts`, `doc.test.ts`, `format.test.ts`, `intelligence.test.ts`, `server.test.ts`, `sql.test.ts`, etc.; unused `originalAutoStart` in `interop.integration.test.ts`; unused `name` in `shared/bootstrap.test.ts`) are out of scope per AC 11.1.8 "no new warnings on touched files".
  - [x] Verified no `^ClineDebug` references remain in any committed `.cls` file.

- [x] **Task 7**: Status updates (AC 11.1.9)
  - [x] Story file `Status: review`.
  - [x] [sprint-status.yaml](../../_bmad-output/implementation-artifacts/sprint-status.yaml) updated: `11-1-objectscript-error-envelope-and-sanitization: ready-for-dev → in-progress → review`.
  - [x] **`BOOTSTRAP_VERSION` NOT bumped** — deferred to Story 11.3 per AC 11.1.9.

### Review Findings

Code review completed 2026-04-21 via `/bmad-code-review`. Three-layer adversarial review (Blind Hunter, Edge Case Hunter, Acceptance Auditor) executed against the committed diff plus project context. All nine acceptance criteria verified satisfied. No HIGH severity issues. No MEDIUM severity issues required in-scope patches.

- [x] [Review][Defer] Missing ObjectScript unit test for `SanitizeError` prefix-strip [src/ExecuteMCPv2/Tests/UtilsTest.cls] — deferred, out of AC 11.1.5 scope (+2 TS tests only). Fast regression guardrail for Bug #11 would require a new `TestSanitizeErrorStripsLeadingErrorPrefix` method; recommended for Story 11.3 or follow-up test-hardening work. See deferred-work.md.
- [x] [Review][Defer] Prefix-strip covers only `ERROR` and `خطأ`; other IRIS locales (`ERREUR`, `FEHLER`, etc.) will still double-wrap [src/ExecuteMCPv2/Utils.cls:141] — deferred, AC 11.1.2 explicitly scoped the fix to these two prefixes per sprint-change-proposal. Multi-locale robustness would require either a configured prefix list or switching to `$System.Status.DecomposeStatus`. See deferred-work.md.
- [x] [Review][Defer] `Use tInitIO` (no mnemonic clause) leaves mnemonic routine bound on device after redirect restore [src/ExecuteMCPv2/REST/Command.cls:75,96] — deferred, latent concern only. `ReDirectIO(0)` disables the redirect flag so writes go to default output; stale mnemonic binding has no observable effect in the Atelier request lifecycle. Live verification in AC 11.1.4 confirms current restore is sufficient. See deferred-work.md.

Dismissed during triage (not recorded as deferred):
- Non-numeric code after `#` (e.g., `"ERROR #abc: ..."`) skips strip — theoretical only; IRIS always uses numeric codes.
- No ObjectScript unit test for `Execute` error envelope — server-side live verification already performed in AC 11.1.4 and will be re-run in Story 11.3 AC 11.3.5.

## Dev Notes

### Architecture constraints

- **ObjectScript changes only in this story.** TypeScript unit tests mock the HTTP boundary, so the tests are independent of the server-side fixes until live verification in Story 11.3.
- **No `BOOTSTRAP_VERSION` bump.** Epic 11 bundles all three ObjectScript stories' changes into one bump at Story 11.3. See the sprint change proposal Section 3 rationale.
- **Namespace discipline** — follow the "Namespace Switching in REST Handlers" rule in [.claude/rules/iris-objectscript-basics.md](../../.claude/rules/iris-objectscript-basics.md). The `UserPassword` method already uses `Set $NAMESPACE = "%SYS"` + `Set $NAMESPACE = tOrigNS`; preserve that pattern.
- **Debug-global hygiene** — `^ClineDebug` is acceptable during investigation (Task 3) but MUST be removed from both the .cls source AND the IRIS instance before merging. The project rule is explicit: "clean up any temporary classes after you are finished with them" — same applies to debug globals.

### Why Bug #1 exists (hypothesis — to be confirmed in Task 3)

`Command:Execute()` turns on I/O redirect at line 56 (`ReDirectIO(1)`) and sets the mnemonic routine at line 54 (`Use tInitIO::("^"_$ZNAME)`). When the inner catch fires at line 61:

- Line 63 attempts to restore the mnemonic: `Use tInitIO::($Select(tOldMnemonic=""||(tOldMnemonic="%X364"):"", 1:"^"_tOldMnemonic))`. When the initial mnemonic was empty (common case), this passes `""` to `Use`, which in IRIS is a no-op — the mnemonic `^ExecuteMCPv2.REST.Command.1` remains set.
- Line 64 calls `ReDirectIO(tWasRedirected)` which, if `tWasRedirected = 0`, disables the redirect FLAG but the mnemonic routine is still bound to the device.
- When `RenderResponseBody` writes the JSON response via internal `Write` calls, the mnemonic `^ExecuteMCPv2.REST.Command.1` would normally be used — but with `ReDirectIO(0)` disabled, writes should go to the default output. This is the part that isn't working and needs trace evidence.

The fix (once root cause is confirmed) likely involves either:
- `Use tInitIO` (device-only, no `:::(mnemonic)` part) to fully reset the device state, OR
- Moving `RenderResponseBody` out of the catch to a post-catch cleanup block.

### Why Bug #11 exists

`SanitizeError` builds `tSafe` from `GetErrorText(pStatus)` which returns the text *including* the `ERROR #N: ` or `خطأ #N: ` prefix. Then `$$$ERROR($$$GeneralError, tSafe)` wraps the text in a new status with its OWN `#5001` prefix. When the outer caller calls `GetErrorText(wrapped)`, IRIS prepends the outer prefix, giving you two.

Fix is to strip one prefix before the final wrap.

### Why Bug #8 exists

[Security:UserPassword](../../src/ExecuteMCPv2/REST/Security.cls#L417) validate branch tries to be belt-and-braces-secure by redacting the candidate password from the IRIS error message. The loop on lines 437–440 has a sensible `>= 3` character threshold and only runs for passwords `>= 3` chars. But line 433's unconditional `$Replace(tMsg, tPassword, "***")` has no threshold — so `"a"` gets replaced *every* occurrence in `tMsg`.

The IRIS validation message never actually embeds the candidate password (it returns a generic "Password does not match length or pattern requirements"). So the redaction is defense-in-depth for a hypothetical future IRIS change, not a real leak prevention today. Gating it at `>= 8` (standard minimum password length) eliminates the corruption for short candidates without losing the defense for real passwords.

### Files to touch — exact lines

- [src/ExecuteMCPv2/Utils.cls](../../src/ExecuteMCPv2/Utils.cls) `SanitizeError` — add prefix-strip block between the empty-safe check (line 136–138) and the final wrap (line 139).
- [src/ExecuteMCPv2/REST/Security.cls](../../src/ExecuteMCPv2/REST/Security.cls) `UserPassword` — line 433, gate `$Replace` with `$Length >= 8`.
- [src/ExecuteMCPv2/REST/Command.cls](../../src/ExecuteMCPv2/REST/Command.cls) `Execute` — inner catch at lines 61–72 and outer catch at lines 87–100 need the I/O restore fix. Exact shape depends on Task 3 investigation.
- [packages/iris-dev-mcp/src/__tests__/execute.test.ts](../../packages/iris-dev-mcp/src/__tests__/execute.test.ts) — +1 test.
- [packages/iris-admin-mcp/src/__tests__/user.test.ts](../../packages/iris-admin-mcp/src/__tests__/user.test.ts) — +1 test.
- [CHANGELOG.md](../../CHANGELOG.md) — new `## [Pre-release — 2026-04-21]` block at the top with `### Fixed` subheading and three bullets.

### Project conventions (must follow)

- ObjectScript macros use `$$$` (triple), never `$$` (double). See [.claude/rules/iris-objectscript-basics.md](../../.claude/rules/iris-objectscript-basics.md).
- Prefer `$$$OK` / `$$$ISERR(sc)` / `$$$ERROR($$$GeneralError, ...)` patterns already in use across the REST handlers.
- First line of every ObjectScript method that returns `%Status`: `Set tSC = $$$OK`. Last line: `Quit tSC`.
- Namespace restore on EVERY exit path (success and catch).
- No debug globals in committed code.
- No comments added unless they describe WHY (not WHAT); code is already in a well-commented pattern.

### Anti-patterns to avoid

- ❌ Do NOT bump `BOOTSTRAP_VERSION` in this story. Story 11.3 owns that.
- ❌ Do NOT change the `iris_user_password action:"change"` error message — that's Bug #12, owned by Story 11.2.
- ❌ Do NOT attempt to force English error messages (the `خطأ` text comes from the IRIS `araw` locale; normalizing to English is a separate, cosmetic change explicitly deferred per the sprint change proposal).
- ❌ Do NOT refactor `SanitizeError` into smaller helper methods. The prefix-strip is a surgical addition, not a refactor opportunity.
- ❌ Do NOT commit `^ClineDebug` writes. Task 3 adds them during investigation; Task 6 verifies they're gone.
- ❌ Do NOT modify any other `.cls` file in `src/ExecuteMCPv2/` beyond the three named in Files to Touch — Stories 11.2 and 11.3 own the rest.

## Previous Story Intelligence

**Story 10.5** (commit `8295e58`) — fixed three other ObjectScript handler bugs (`iris_task_history` taskId filter, `Security.Resources.Create` / `Security.Roles.Create` description-arg crash). That story's pattern is the reference: minimal surgical fixes, inline CHANGELOG, `BOOTSTRAP_VERSION` bump with `npm run gen:bootstrap`. The only structural difference for Story 11.1 is that the bootstrap bump is deferred to Story 11.3 because Epic 11 has a multi-story ObjectScript bundle.

**Story 10.6** (commit `1b7b874`) — TypeScript-only fix, immediately post-Story-10.5. Demonstrates the inline-CHANGELOG + README-update pattern for small stories.

**Epic 10 retro** ([epic-10-retro-2026-04-20.md](../../_bmad-output/implementation-artifacts/epic-10-retro-2026-04-20.md)) — not directly relevant to Story 11.1's bugs (those retro action items were addressed in Stories 10.5 and 10.6). However, the retro's "Action Item #1 shape" (post-retro bug fixes with inline CHANGELOG + BOOTSTRAP_VERSION bump) is exactly what Epic 11 replicates.

Commits to inspect if helpful:
- `8295e58` — Story 10.5 ObjectScript handler bug fixes (shape reference for this story).
- `2c6cd94` — Epic 10 final wrap (demonstrates sprint-status + epic-cycle-log format).

## Project Structure Notes

- All three files (`Command.cls`, `Utils.cls`, `Security.cls`) are in the existing `src/ExecuteMCPv2/REST/` and `src/ExecuteMCPv2/` namespaces. No new files, no new subdirectories.
- `CHANGELOG.md` lives at the top level.
- Unit tests live under each package's `src/__tests__/` directory.

## Testing Standards

- **ObjectScript tests**: not added in this story. Server-side behavior is validated via Task 3's live investigation + Story 11.3's live verification gate.
- **TypeScript tests** (Vitest): add +2 tests following the Vitest + `createMockHttp` / `createMockCtx` pattern used across the suite. See any existing test in `packages/iris-admin-mcp/src/__tests__/` or `packages/iris-dev-mcp/src/__tests__/` for the pattern.

## References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-11-Story-11.1]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-04-21.md]
- [Source: src/ExecuteMCPv2/REST/Command.cls] — Execute method (bug #1), ClassMethod method (reference pattern)
- [Source: src/ExecuteMCPv2/Utils.cls] — SanitizeError method (bug #11)
- [Source: src/ExecuteMCPv2/REST/Security.cls] — UserPassword validate branch (bug #8)
- [Source: .claude/rules/iris-objectscript-basics.md] — project ObjectScript conventions
- [Source: .claude/rules/object-script-testing.md] — ObjectScript testing conventions (mostly for Task 3 debug-global usage)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context) — `claude-opus-4-7[1m]`

### Debug Log References

Task 3 investigation captured the following `^ClineDebug` trace (run against a deployed `Command.cls` with the original buggy catch structure, then again with the interim "unconditionally restore inside the catch" fix):

- **First trace** (original code): `Execute-entry; inner-catch entered; tWasRedirected=1 tRedirected=1 tOldMnemonic="%SYS.cspServer2"; after-use; after-redirectIO-reset; before-render; errtext=خطأ #5002: ObjectScript error: <DIVIDE>Execute+38^ExecuteMCPv2.REST.Command.1; after-render;`
  - Key finding: `tWasRedirected=1` (Atelier dispatcher has redirect enabled when `Execute` is entered), so the `If tWasRedirected '= tRedirected Do ReDirectIO(tWasRedirected)` check on the original line 64 was a no-op — `RenderResponseBody` was still running with redirect enabled and its writes were captured into `%ExecuteMCPOutput` rather than emitted to the HTTP stream.
- **Second trace** (interim fix — added `Do ReDirectIO(0)` + `Use tInitIO` before render, kept `Quit` in catch): `Execute-entry; inner-catch entered; ...; after-restore; before-render; errtext=...; after-render;` — but the tool response was `{"output":""}` (the SUCCESS envelope), indicating a second defect: the argumentless `Quit` inside `Catch exCmd` only exits the catch body, NOT the outer Try, so control fell through to the success render which wrote a second envelope that overwrote the error one.

Final fix restructures the inner Try/Catch into a flag (`tCmdErrored`) + post-catch dispatch pattern so exactly one `RenderResponseBody` fires per request, and the I/O restore happens unconditionally after the catch (regardless of `tWasRedirected` state). All `^ClineDebug` traces removed before commit; `^ClineDebug` killed on the IRIS instance post-investigation.

### Completion Notes List

- **All 9 acceptance criteria satisfied.** Live-verified AC 11.1.1 (all three reproductions return JSON error envelopes), AC 11.1.3 (short-password validate message preserved), and AC 11.1.2 (single `#5001` prefix in the live response, no doubly-wrapped chain). AC 11.1.4 investigation + fix documented in Debug Log References above. AC 11.1.5 unit tests added and passing. AC 11.1.7 CHANGELOG bullets added. AC 11.1.8 build + tests green (+2 tests). AC 11.1.9 BOOTSTRAP_VERSION untouched — deferred to Story 11.3.
- **Live verification deferred (AC 11.1.6).** The three ObjectScript fixes will ship to existing installs via Story 11.3's `BOOTSTRAP_VERSION` bump. The fixes are already deployed and confirmed working on the local HSCUSTOM namespace (via `iris_doc_load` + `iris_doc_compile`) and were live-tested against the three Bug #1 reproductions. Story 11.3 AC 11.3.5 will rerun these reproductions as part of its end-to-end bump verification.
- **Root cause summary for Bug #1 (two defects, both addressed):**
  1. I/O redirect state was not fully restored before `RenderResponseBody`. The original `If tWasRedirected '= tRedirected Do ReDirectIO(tWasRedirected)` is a no-op when both are 1 (the Atelier dispatcher's default state), so the error response was written to the `%ExecuteMCPOutput` capture buffer instead of the HTTP stream.
  2. The argumentless `Quit` inside `Catch exCmd { ... Quit }` exits only the catch block, not the outer Try — so even after the first defect was patched, control fell through to the success-path `RenderResponseBody($$$OK, , tResult)` and wrote a second envelope that clobbered the error one.
- **Fix approach:** Hoisted the I/O restore and render dispatch out of the catch. The catch now only sets `tCmdErrored = 1` and captures `tCmdStatus`; the post-catch block unconditionally calls `ReDirectIO(0)` + `Use tInitIO`, then branches to either `RenderResponseBody(SanitizeError(tCmdStatus))` or the success render — exactly one response per request. Outer catch also simplified to the same `ReDirectIO(0)` + `Use tInitIO` pattern for symmetry.
- **No `^ClineDebug` references remain in `src/`** (verified via `grep -r ClineDebug src/`).
- **Compiled cleanly** — `ExecuteMCPv2.Utils`, `ExecuteMCPv2.REST.Security`, `ExecuteMCPv2.REST.Command` all compile with flags `ck` on HSCUSTOM.

### File List

**Modified:**
- `src/ExecuteMCPv2/Utils.cls` — `SanitizeError` now strips a single leading `ERROR #N: ` / `خطأ #N: ` prefix before the final `$$$ERROR` wrap (Bug #11).
- `src/ExecuteMCPv2/REST/Security.cls` — `UserPassword` validate branch gates the unconditional `$Replace(tMsg, tPassword, "***")` on `$Length(tPassword) >= 8` (Bug #8).
- `src/ExecuteMCPv2/REST/Command.cls` — `Execute` method restructured so I/O restore + `RenderResponseBody` run AFTER the inner Try/Catch; exactly one response per request; outer catch simplified to the same unconditional `ReDirectIO(0)` + `Use tInitIO` restore pattern (Bug #1).
- `packages/iris-dev-mcp/src/__tests__/execute.test.ts` — added `it("returns structured error envelope when server returns JSON error")` in the `iris_execute_command` describe block.
- `packages/iris-admin-mcp/src/__tests__/user.test.ts` — added `it("does not redact short candidate password in validate error text")` in the `iris_user_password` describe block.
- `CHANGELOG.md` — new `## [Pre-release — 2026-04-21]` block with `### Fixed` subheading and three bullets (Bugs #1, #11, #8).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `11-1-objectscript-error-envelope-and-sanitization: ready-for-dev → review`.
- `_bmad-output/implementation-artifacts/11-1-objectscript-error-envelope-and-sanitization.md` — this file (status, tasks, Dev Agent Record updated).

**Not modified (per AC 11.1.9):**
- `packages/shared/src/bootstrap-classes.ts` — Story 11.3 owns the single `BOOTSTRAP_VERSION` bump covering all Epic 11 ObjectScript changes.

### Change Log

| Date | Change |
|------|--------|
| 2026-04-21 | Story created by bmad-create-story. |
| 2026-04-21 | Story implemented. Three ObjectScript bug fixes (Bugs #1, #11, #8) + 2 TS unit tests + CHANGELOG entry. Live-verified on HSCUSTOM; no `BOOTSTRAP_VERSION` bump (deferred to Story 11.3). Status: ready-for-dev → review. |
