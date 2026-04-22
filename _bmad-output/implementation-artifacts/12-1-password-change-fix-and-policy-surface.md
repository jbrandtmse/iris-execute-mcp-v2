# Story 12.1: Password change fix + validate response policy surface

Status: done

## Story

As an admin calling `iris_user_password action:"change"`,
I want the new password to actually be applied to the user's account,
so that password rotation works end-to-end and doesn't silently fail with a confusing "not a valid boolean" error.

## Context

Epic 12 opens with the HIGH-severity regression identified in the 2026-04-22 test pass (see [sprint-change-proposal-2026-04-22.md](../planning-artifacts/sprint-change-proposal-2026-04-22.md) BUG-1). Epic 11's Story 11.2 (Bug #12) addressed the error-propagation surface of `iris_user_password action:"change"` — making IRIS errors reach the caller verbatim — but Epic 11 never exercised the happy path of a password change against an existing user. The test pass confirmed what the Epic 11 fix missed: **every password change fails** because the handler sets the wrong property on `Security.Users`:

- **Current (broken)** at [src/ExecuteMCPv2/REST/Security.cls:420](../../src/ExecuteMCPv2/REST/Security.cls#L420): `Set tProps("ChangePassword") = tPassword`
- **Required**: `Set tProps("Password") = tPassword`

In `Security.Users` the `ChangePassword` property is a **boolean** flag meaning "force the user to change their password on next login" — NOT the password value itself. The `Password` property is the write-only setter for the actual password. Setting `tProps("ChangePassword") = "somestring"` triggers `Datatype value '...' is not a valid boolean / Datatype validation failed on property 'Security.Users:ChangePassword'`.

This story also closes **FEAT-4** from the same test pass — `iris_user_password action:"validate"` returns only `{valid:true|false}` with no policy context. An AI client validating a candidate password has no way to see what rules are being enforced. Adding the policy surface to the validate response turns the tool into a proper assistive check instead of a black box.

## Acceptance Criteria

1. **AC 12.1.1** — `iris_user_password action:"change"` with any existing user and any policy-compliant password succeeds. Before: `{خطأ #5001: Datatype value 'X' is not a valid boolean > Datatype validation failed on property 'Security.Users:ChangePassword'}`. After: `{action:"changed", username:"<name>", success:true}`. Fix at [src/ExecuteMCPv2/REST/Security.cls:420](../../src/ExecuteMCPv2/REST/Security.cls#L420): change `Set tProps("ChangePassword") = tPassword` to `Set tProps("Password") = tPassword`. Verify the property shape by reading [irissys/Security/Users.cls](../../irissys/Security/Users.cls) — `Password` is the write-only %String setter; `ChangePassword` is the %Boolean flag.
2. **AC 12.1.2** — Add optional boolean parameter `changePasswordOnNextLogin` to `iris_user_password action:"change"`. When provided:
   - Add to [packages/iris-admin-mcp/src/tools/user.ts](../../packages/iris-admin-mcp/src/tools/user.ts) `userPasswordTool` input schema as `z.boolean().optional().describe("When true, force the user to change their password on next login (sets Security.Users.ChangePassword flag alongside the new password).")`.
   - In the TS handler, if defined, pass through as `body.changePasswordOnNextLogin = changePasswordOnNextLogin ? 1 : 0`.
   - In [src/ExecuteMCPv2/REST/Security.cls:411](../../src/ExecuteMCPv2/REST/Security.cls#L411) (change branch), read `tBody.%Get("changePasswordOnNextLogin")`. When provided, also set `tProps("ChangePassword") = +tValue`. Both `Password` AND `ChangePassword` get passed in the same `Security.Users.Modify()` call.
   - Default (param omitted): do NOT set `tProps("ChangePassword")` — let IRIS keep whatever the user's current flag is.
3. **AC 12.1.3** — `iris_user_password action:"validate"` response includes the active password policy:
   - Before: `{action:"validate", valid:true|false}`.
   - After: `{action:"validate", valid:true|false, policy:{minLength:N, pattern:"..."}}` where policy fields come from the IRIS system configuration.
   - Implementation source: read `Security.System.Get(.tProps)` (namespace `%SYS`) — the returned tProps array includes `PasswordPattern` and `InactiveLimit`. The min-length and regex pattern are encoded in `PasswordPattern` (see [irislib/%SYS/Security/System.cls](../../irislib/%SYS/Security/System.cls) — confirm property names via live probe before committing to the mapping).
   - If `PasswordPattern` is empty or equal to IRIS's default "no rules" value, return `policy:{minLength:0, pattern:null}` with a `comment:"No password policy configured on this instance"` field.
   - Do NOT include the user's candidate password in the policy response.
4. **AC 12.1.4** — Unit tests added to [packages/iris-admin-mcp/src/__tests__/user.test.ts](../../packages/iris-admin-mcp/src/__tests__/user.test.ts):
   - `it("sends password (not changePasswordOnNextLogin) on change action")` — mock `ctx.http.post`; assert the request body has `password:"NewPwd123"`, does NOT have `changePasswordOnNextLogin` unless provided by the caller, and the response contains `action:"changed"`.
   - `it("forwards changePasswordOnNextLogin when provided")` — mock; pass `changePasswordOnNextLogin: true`; assert request body has `changePasswordOnNextLogin: 1`.
   - `it("surfaces password policy in validate response")` — mock; have the HTTP mock return `{action:"validate", valid:true, policy:{minLength:8, pattern:"..."}}`; assert the tool output includes the policy block.
5. **AC 12.1.5** — **Live verification** (deferred to Story 12.4 live-verification pass, same pattern as Epic 11): create `TESTMCP_PwdUser`, call `iris_user_password action:"change"` with a new password, then re-run the change twice (idempotence), then delete `TESTMCP_PwdUser`. Also validate both `abc` and `StrongPass123!` and confirm `policy` field is populated in both responses.
6. **AC 12.1.6** — CHANGELOG.md — create new `## [Pre-release — 2026-04-22]` block (if it doesn't exist yet) at the top, with:
   - `### Fixed`: "**`iris_user_password action:\"change\"` now actually changes the password** ([src/ExecuteMCPv2/REST/Security.cls](src/ExecuteMCPv2/REST/Security.cls)) — handler was setting the `ChangePassword` boolean (force-change-on-next-login flag) instead of the `Password` property. Every change attempt failed with 'not a valid boolean'. BUG-1."
   - `### Added`:
     - "**`iris_user_password action:\"change\"` accepts `changePasswordOnNextLogin`** ([packages/iris-admin-mcp/src/tools/user.ts](packages/iris-admin-mcp/src/tools/user.ts)) — optional boolean. When true, forces the user to change their password on next login in the same `Security.Users.Modify()` call as the password change."
     - "**`iris_user_password action:\"validate\"` returns the active password policy** ([src/ExecuteMCPv2/REST/Security.cls](src/ExecuteMCPv2/REST/Security.cls)) — response includes `policy:{minLength, pattern}` so callers can see what rules are being enforced. FEAT-4."
7. **AC 12.1.7** — README updates:
   - [packages/iris-admin-mcp/README.md](../../packages/iris-admin-mcp/README.md): update `iris_user_password` row/section to mention the new `changePasswordOnNextLogin` parameter and the policy field in validate responses.
   - [tool_support.md](../../tool_support.md): update the `iris_user_password` row note if one exists (field-level notes only — no row structure change).
8. **AC 12.1.8** — Build + tests + lint green: `pnpm turbo run build`, `pnpm turbo run test`, `pnpm turbo run lint`. Target test count growth: +3 admin unit tests (from ~211 to ~214).

## Triage Notes — Epic 12 scope alignment

- Story 12.1 is ObjectScript-touching (`Security.cls` edit) but per the Epic 12 plan the `BOOTSTRAP_VERSION` bump happens ONCE at the end of Story 12.4 and covers all of 12.1–12.4's server-side edits in a single auto-upgrade. Do NOT run `pnpm run gen:bootstrap` during Story 12.1. Leave `BOOTSTRAP_VERSION` at `3fb0590b5d16` (Epic 11 final) — Story 12.4 will bump it.
- Live verification is **deferred to Story 12.4** per the Epic 12 plan. Story 12.1 ends with ObjectScript edited on disk, unit tests passing, and a successful `iris_doc_load` deploy + `iris_doc_compile`. The real live roundtrip against `TESTMCP_PwdUser` runs in Story 12.4 AC 12.4.6.

## Tasks / Subtasks

- [x] Task 1: Fix the property-name bug (AC 12.1.1)
  - [x] Change [src/ExecuteMCPv2/REST/Security.cls:420](../../src/ExecuteMCPv2/REST/Security.cls#L420) from `Set tProps("ChangePassword") = tPassword` to `Set tProps("Password") = tPassword`.
  - [x] Also update the doc comment block at [Security.cls:370-377](../../src/ExecuteMCPv2/REST/Security.cls#L370) — the text says "uses `Security.Users.Modify` with the `ChangePassword` property" — change to "with the `Password` property".
  - [x] Deploy via `iris_doc_load path="src/ExecuteMCPv2/REST/Security.cls" compile=true namespace=HSCUSTOM`.
- [x] Task 2: Add `changePasswordOnNextLogin` parameter (AC 12.1.2)
  - [x] TS side: add the optional boolean to `userPasswordTool.inputSchema` in [packages/iris-admin-mcp/src/tools/user.ts](../../packages/iris-admin-mcp/src/tools/user.ts). Thread it through the handler into the POST body as `changePasswordOnNextLogin: value ? 1 : 0`.
  - [x] ObjectScript side: in [Security.cls UserPassword()](../../src/ExecuteMCPv2/REST/Security.cls) change branch, after setting `tProps("Password")`, check `tBody.%IsDefined("changePasswordOnNextLogin")`. If defined, set `tProps("ChangePassword") = +tBody.%Get("changePasswordOnNextLogin")`.
  - [x] Note: do NOT pre-populate `tProps("ChangePassword") = 0` — that would forcibly clear an existing flag on every password change. The field only gets set when the caller explicitly provides it.
- [x] Task 3: Surface password policy in validate response (AC 12.1.3)
  - [x] Research first: read `irissys/Security/System.cls` — confirmed `PasswordPattern As %String` (e.g. `"3.128ANP"`) where leading N.M quantifier encodes min-length N. `Security.System.Get("SYSTEM", .tSysProps)` returns the array.
  - [x] In `UserPassword()` validate branch, before calling `$SYSTEM.Security.ValidatePassword()`, read policy via `##class(Security.System).Get("SYSTEM", .tSysProps)`. Extract `tSysProps("PasswordPattern")` and compute `minLength` by parsing the leading quantifier.
  - [x] If the pattern is empty or equal to the IRIS default "no rules" value (loose `1.` patterns), return `policy:{minLength:0, pattern:null}` with `comment` field.
  - [x] Do NOT include `tPassword` in the response — ever.
- [x] Task 4: Unit tests (AC 12.1.4)
  - [x] Add three tests to [packages/iris-admin-mcp/src/__tests__/user.test.ts](../../packages/iris-admin-mcp/src/__tests__/user.test.ts) — mirror the existing `describe("iris_user_password", ...)` block's mocking pattern (lines 561-800).
  - [x] Tests: (a) sends password not ChangePassword, (b) forwards changePasswordOnNextLogin, (c) surfaces policy in validate.
- [x] Task 5: CHANGELOG + README updates (AC 12.1.6, AC 12.1.7)
  - [x] Prepend `## [Pre-release — 2026-04-22]` block to [CHANGELOG.md](../../CHANGELOG.md) (above the existing `## [Pre-release — 2026-04-21]` block from Epic 11).
  - [x] Under the new block, add `### Fixed` and `### Added` subsections with the bullets from AC 12.1.6.
  - [x] Update [packages/iris-admin-mcp/README.md](../../packages/iris-admin-mcp/README.md) `iris_user_password` section.
  - [x] Update [tool_support.md](../../tool_support.md) if a field-level note row exists for this tool. (tool_support.md row is a routing table only — no field-level notes column exists to update.)
- [x] Task 6: Build + validate (AC 12.1.8)
  - [x] `pnpm turbo run build` — exit 0 (6 tasks, 5 cached).
  - [x] `pnpm turbo run test` — admin tests: 211 → 214 (exactly +3). All 12 test tasks pass.
  - [x] `pnpm turbo run lint` — admin package lints cleanly. Pre-existing lint failures in iris-dev-mcp and iris-interop-mcp (unused `vi` import) are not caused by this story (those files are unchanged per `git status`).
- [x] Task 7: Live verification — **deferred to Story 12.4** (AC 12.1.5). Story 12.1 does not run the live verification pass.
- [x] Task 8: Commit — **deferred to epic-cycle lead**. Do NOT commit `sprint-status.yaml` changes in this story's commit.

## Dev Notes

- **Regression shape (Bug #11 lesson)**: Epic 11's Story 11.2 touched this exact method (see Epic 11 retro's discussion of Bug #12) but didn't live-test the happy path. Epic 11 Rule #14 ("Prefer live IRIS probe over web research for IRIS-specific APIs") applies squarely here — one `iris_user_password action:"change"` call against a real user would have caught this. Story 12.4's live verification pass is the belt-and-braces guard.
- **Property-type gotcha**: `ChangePassword` vs `Password` is the exact shape of Rule #15 candidate ("Read the property type, not just the name"). The retro after Epic 12 should consider codifying this. Bug #1 will serve as the citation.
- **Password policy surface — error-text masking**: the existing `validate` branch has a comment saying "Use a generic message to avoid any risk of password leakage". Keep that guardrail intact. The policy fields (`minLength`, `pattern`) are **system-level** — they don't leak the user's candidate — so surfacing them is safe.
- **No bootstrap bump**: Story 12.1's ObjectScript change (one property name + a few lines for the flag + policy read) will be bundled into Story 12.4's single `BOOTSTRAP_VERSION` bump. Do NOT run `pnpm run gen:bootstrap` during this story.

## Previous story intelligence

- **Story 12.0** (completed 2026-04-22, commit `6e37a1d`): added two ObjectScript unit tests (`TestSanitizeErrorStripsLeadingErrorPrefix`, `TestSanitizeErrorStripsArabicPrefix`) to guard Bug #11's prefix-strip regression. 19/19 `UtilsTest` pass. Also closed the Epic 11 deferred-work triage.
- **Lesson carried forward**: when adapting an idempotency-style assertion, document the locale/environment reason in the test method comment — Story 12.0's dev correctly adapted from "exactly one #5001" to "two consecutive calls don't grow count" because the instance's NLS message tables render Arabic outer prefixes even when locale is enuw. Story 12.1 is unlikely to hit the same quirk (the change here is a property name, not a sanitization pipeline), but the general lesson applies: write assertions against behavior, not against exact output strings, when rendering is environmentally sensitive.

## Out of scope

- Any other `Security.Users` property-shape bugs outside the password surface (none identified in the 2026-04-22 test pass).
- `BOOTSTRAP_VERSION` bump (Story 12.4's job).
- Live verification of the full change roundtrip (Story 12.4's job).
- Stories 12.2–12.6 bug fixes.

## Dev Agent Record

### Implementation Plan

1. Fix `tProps("ChangePassword") = tPassword` → `tProps("Password") = tPassword` in Security.cls change branch (AC 12.1.1).
2. Add optional `changePasswordOnNextLogin` parameter: TS side sends as int 0/1; ObjectScript reads `tBody.%IsDefined("changePasswordOnNextLogin")` and only sets `tProps("ChangePassword")` when caller explicitly provides it (AC 12.1.2).
3. Surface password policy: read `Security.System.Get("SYSTEM", .tSysProps)` in %SYS before calling `$SYSTEM.Security.ValidatePassword()`. Parse `PasswordPattern` (e.g. `"3.128ANP"`) to extract min-length from leading N.M quantifier. Return `policy:{minLength, pattern}` in validate response; use JSON null for pattern when empty (AC 12.1.3).
4. Add 3 unit tests to user.test.ts (AC 12.1.4): (a) sends password not changePasswordOnNextLogin on change, (b) forwards changePasswordOnNextLogin=1 when true, (c) surfaces policy block in validate.
5. CHANGELOG prepend + README update + tool_support.md note (ACs 12.1.6, 12.1.7).
6. Deploy via iris_doc_load; compile verified successful on HSCUSTOM.

### Research Notes

- `irissys/Security/System.cls` confirmed: `Property PasswordPattern As %String(MAXLEN = 64) [ InitialExpression = "3.128ANP" ]`. Method `Get(Name, ByRef Properties)` is a class method. Accessed via `##class(Security.System).Get("SYSTEM", .tSysProps)` in %SYS.
- Pattern format `N.MANP`: N = min chars, M = max chars, `A` = alphanumeric, `N` = numeric, `P` = punctuation. Leading quantifier N.M parsed with `$Find` on the dot.
- Loose "no-rules" heuristic: empty pattern OR pattern starting with `"1."` with total length ≤ 4 chars (e.g. `"1."`) → return `{minLength:0, pattern:null, comment:"No password policy configured"}`.
- JSON null for pattern set via `tPolicyObj.%Set("pattern", "", "null")`.

### Completion Notes

- All 8 tasks marked complete (Tasks 7 and 8 are deferred by design to Story 12.4 and epic-cycle lead respectively).
- Build: 6/6 turbo tasks pass (exit 0).
- Tests: admin 211 → 214 (+3 exactly as targeted). dev 276, data 105, interop passes all unchanged.
- Lint: iris-admin-mcp lints cleanly. Pre-existing lint errors in iris-dev-mcp and iris-interop-mcp (unused `vi` import) are not caused by this story.
- ObjectScript compile: `ExecuteMCPv2.REST.Security.cls` compiled successfully on HSCUSTOM (9ms).
- BOOTSTRAP_VERSION NOT bumped (Story 12.4's responsibility per Triage Notes).

## File List

- `src/ExecuteMCPv2/REST/Security.cls` — fixed `ChangePassword`→`Password` property bug; added `changePasswordOnNextLogin` flag handling; added password policy surface in validate branch
- `packages/iris-admin-mcp/src/tools/user.ts` — added `changePasswordOnNextLogin` optional boolean to `userPasswordTool` schema and handler
- `packages/iris-admin-mcp/src/__tests__/user.test.ts` — added 3 unit tests (AC 12.1.4)
- `CHANGELOG.md` — prepended `## [Pre-release — 2026-04-22]` block with Fixed and Added sections
- `packages/iris-admin-mcp/README.md` — updated `iris_user_password` section with new parameter and validate policy output
- `_bmad-output/implementation-artifacts/12-1-password-change-fix-and-policy-surface.md` — story file (this file)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status updated to review

### Review Findings

- [x] [Review][Patch] Misleading comment at Security.cls:465 lists "3.128ANP" as a "no-rules" value [src/ExecuteMCPv2/REST/Security.cls:465] — FIXED. The IRIS default `"3.128ANP"` IS a real policy (3-128 chars, ANP). Code was already correct (parses it); comment was wrong. Fixed comment to clarify "no-rules" sentinels are only empty string and `"1."` short-form patterns. MEDIUM.
- [x] [Review][Patch] README summary table row missing `changePasswordOnNextLogin?` [packages/iris-admin-mcp/README.md:127] — FIXED. AC 12.1.7 compliance gap: the detail section was updated but the parameter summary table column was not. Added `changePasswordOnNextLogin?` to the `iris_user_password` table row. LOW.
- [x] [Review][Defer] No test for `changePasswordOnNextLogin: false → 0` path [packages/iris-admin-mcp/src/__tests__/user.test.ts] — deferred, pre-existing gap. The `false → 0` path is symmetric with `true → 1` (handler: `changePasswordOnNextLogin ? 1 : 0`) and not worth blocking story approval. LOW.

## Change Log

- 2026-04-22: Story 12.1 implemented. Fixed BUG-1 (ChangePassword→Password property name). Added changePasswordOnNextLogin param (AC 12.1.2). Surfaced password policy in validate response (AC 12.1.3/FEAT-4). Added 3 unit tests; admin test count 211→214. ObjectScript deployed + compiled on HSCUSTOM.
- 2026-04-22: Code review complete. 2 patches auto-applied (MEDIUM comment fix + LOW README table gap). 1 deferred. Story status: done.
