# Story 10.5: ObjectScript handler bug fixes (post-retro cleanup)

Status: done

## Story

As a developer using `iris_task_history`, `iris_resource_manage`, or `iris_role_manage`,
I want the documented input parameters to actually work,
so that I can filter task history by task ID and create resources/roles with descriptions, instead of silently getting unfiltered results or hitting `<UNDEFINED>` errors.

## Trigger

Two pre-Epic-10 defects in our `ExecuteMCPv2.REST.*` handlers, surfaced during the 2026-04-19 manual retest pass and documented in [docs/known-bugs-2026-04-20.md](../../docs/known-bugs-2026-04-20.md). Epic 10 retro Action Items #1 and #2. Sprint Change Proposal: [sprint-change-proposal-2026-04-20-stories-10-5-and-10-6.md](../planning-artifacts/sprint-change-proposal-2026-04-20-stories-10-5-and-10-6.md).

## Acceptance Criteria

1. **AC 10.5.1** — `iris_task_history` with `taskId: <id>` filters to that task only.
   - The `TaskHistory()` classmethod in [src/ExecuteMCPv2/REST/Task.cls](../../src/ExecuteMCPv2/REST/Task.cls) (lines 281–287 currently) selects `%SYS.Task.History:TaskHistoryForTask(Task)` named query when `tTaskId '= ""`, and the existing `TaskHistoryDetail(NULL)` query when `tTaskId = ""`.
   - Existing pagination/cap behavior unchanged.

2. **AC 10.5.2** — Field-name extraction in `TaskHistory()` works against BOTH named queries.
   - The ROWSPECs at `%SYS.Task.History.cls` lines 148 (`TaskHistoryForTask`) and 170 (`TaskHistoryDetail`) differ in column ORDER but both expose the field NAMES the handler reads via `tRS.Get(...)` calls — verify by inspection. Specifically: `Last Start`, `Completed`, `Task Name`, `Status`, `Result`, `NameSpace`, `Task`, `Username`. The handler accesses fields by name (line 301–308), so column-order differences won't break it.

3. **AC 10.5.3** — `iris_resource_manage create` with a `description` argument succeeds.
   - The `ResourceManage()` classmethod in [src/ExecuteMCPv2/REST/Security.cls](../../src/ExecuteMCPv2/REST/Security.cls) (line 665 currently) calls `Security.Resources.Create(tName, tDescription, tPublicPermission)` with positional scalars (extracted via `$Get(tProps("Description"))` etc.), NOT `Create(tName, .tProps)` with a byref array.
   - The byref-array call pattern is correct for `Security.Resources.Modify` and `Get` (which take `ByRef Properties`), but `Create` takes `Description As %String` as positional arg #2.

4. **AC 10.5.4** — `iris_role_manage create` with a `description` argument succeeds.
   - Same fix pattern as AC 10.5.3 applied to `RoleManage()` (line 537) calling `Security.Roles.Create()`.
   - **Verify the exact positional argument order** in `%SYS:Security.Roles.cls` `Create` signature before fixing. Confirmed exports of these classes are available locally at [irissys/%SYS/Security/Roles.cls](../../irissys/%SYS/Security/Roles.cls) and [irissys/%SYS/Security/Resources.cls](../../irissys/%SYS/Security/Resources.cls) from the Story 10.2 stress-test export. Likely signature: `(Name, Description, Resources, GrantedRoles)` per IRIS conventions, but **read the actual class** to confirm.

5. **AC 10.5.5** — Verify Users and Applications `Create` call sites are not affected.
   - [src/ExecuteMCPv2/REST/Security.cls](../../src/ExecuteMCPv2/REST/Security.cls) has TWO additional `.Create(tName, .tProps)` call sites that follow the same byref-array pattern:
     - Line 176: `Security.Users.Create(tName, .tProps)`
     - Line 1115: `Security.Applications.Create(tName, .tProps)`
   - Read both `Security.Users.cls` and `Security.Applications.cls` Create signatures (also exported locally under `irissys/%SYS/Security/`).
   - **If either signature is `(Name, ByRef Properties)`** — leave the call alone, it's correct.
   - **If either signature is positional scalars** like Resources/Roles — fix it the same way (extract scalars via `$Get(tProps("..."))`). The same defect class exists if the signature is positional.
   - Document the finding in the story Dev Agent Record either way (one sentence: "Users.Create takes byref Properties, no fix needed" OR "Users.Create takes positional scalars, fixed same as 10.5.3").

6. **AC 10.5.6** — Unit tests added:
   - In [packages/iris-ops-mcp/src/__tests__/task.test.ts](../../packages/iris-ops-mcp/src/__tests__/task.test.ts): assert that when `taskId` is set, the request URL includes `taskId=<value>` query param. The mock-HTTP layer can't directly assert which IRIS-side named query was selected, but the URL contract is the testable boundary — and a regression test that `taskId` propagates through serves as documentation.
   - In [packages/iris-admin-mcp/src/__tests__/resource.test.ts](../../packages/iris-admin-mcp/src/__tests__/resource.test.ts): `it("creates resource with description without error")` — call handler with `{action: "create", name: "X", description: "Y"}` against a mock that returns success. Assert the response is the success shape, not isError.
   - In [packages/iris-admin-mcp/src/__tests__/role.test.ts](../../packages/iris-admin-mcp/src/__tests__/role.test.ts): same pattern for role.
   - Same assertions added to user.test.ts and webapp.test.ts ONLY IF the corresponding Security.* Create signatures are positional and we ended up fixing them in AC 10.5.5.

7. **AC 10.5.7** — Live verification (post-bootstrap-upgrade):
   - Re-run the reproductions in [docs/known-bugs-2026-04-20.md](../../docs/known-bugs-2026-04-20.md):
     - `iris_task_history({ taskId: <real-id-from-task-list>, maxRows: 10 })` — should return only rows for that specific task. Pick a task ID with multiple history entries from `iris_task_list`.
     - `iris_resource_manage({ action: "create", name: "MCPTestStory105", description: "test description" })` — should return success.
     - `iris_role_manage({ action: "create", name: "MCPTestStory105Role", description: "test description" })` — same.
   - **Important**: requires MCP server restart between deploy and live verification, so the BOOTSTRAP_VERSION change triggers the auto-upgrade path on the next connection.
   - Clean up `MCPTestStory105` resource and `MCPTestStory105Role` role after verification (use the same tools' `delete` action).

8. **AC 10.5.8** — `BOOTSTRAP_VERSION` bumps to a new hash; existing installs auto-upgrade via the version-stamped probe on next MCP server restart.
   - Run `npm run gen:bootstrap` after the .cls changes — this produces a new hash and updates the embedded class content in `packages/shared/src/bootstrap-classes.ts`.
   - The auto-upgrade path redeploys + recompiles all 13 handler classes per the standard pattern (Story 10.2 + 10.4 already validated this).

9. **AC 10.5.9** — CHANGELOG.md gets two new bullets appended to the existing `## [Pre-release — 2026-04-20]` `### Fixed` section.
   - Suggested wording:
     - **`iris_task_history` taskId filter now actually filters** ([src/ExecuteMCPv2/REST/Task.cls](src/ExecuteMCPv2/REST/Task.cls)) — handler was using the unparameterized `%SYS.Task.History:TaskHistoryDetail` named query and silently passing `tTaskId` to it, which IRIS ignored. Now selects `TaskHistoryForTask(Task)` when `taskId` is set.
     - **`iris_resource_manage` and `iris_role_manage` `create` with `description` no longer crash** ([src/ExecuteMCPv2/REST/Security.cls](src/ExecuteMCPv2/REST/Security.cls)) — handlers were passing a byref array where `Security.Resources.Create` and `Security.Roles.Create` expect positional scalars. Now extracts each property and passes positionally.
   - If AC 10.5.5 finds Users or Applications need the same fix, add a third bullet covering those.

10. **AC 10.5.10** — Build + tests + lint green.
    - `pnpm turbo run build` — must succeed.
    - `pnpm turbo run test` — all tests pass; target ~3 new tests (272 total). If AC 10.5.5 expanded scope, ~5 new tests (274 total).
    - `pnpm turbo run lint` — no new warnings on touched files.

## Tasks / Subtasks

- [x] **Task 1**: Fix `TaskHistory()` in `src/ExecuteMCPv2/REST/Task.cls` (AC 10.5.1, 10.5.2)
  - [x] Read `irissys/%SYS/Task/History.cls` lines 148 and 170 to confirm both named queries exist and the field names the handler reads are present in both ROWSPECs.
  - [x] Replace lines 281–287:
    ```objectscript
    Set tRS = ##class(%ResultSet).%New("%SYS.Task.History:TaskHistoryDetail")
    If tTaskId '= "" {
        Set tSC2 = tRS.Execute(tTaskId)
    }
    Else {
        Set tSC2 = tRS.Execute("")
    }
    ```
    with:
    ```objectscript
    If tTaskId '= "" {
        Set tRS = ##class(%ResultSet).%New("%SYS.Task.History:TaskHistoryForTask")
        Set tSC2 = tRS.Execute(+tTaskId)
    } Else {
        Set tRS = ##class(%ResultSet).%New("%SYS.Task.History:TaskHistoryDetail")
        Set tSC2 = tRS.Execute()
    }
    ```
    Note `+tTaskId` to coerce to integer (the URL query param arrives as string).

- [x] **Task 2**: Fix `ResourceManage()` in `src/ExecuteMCPv2/REST/Security.cls` (AC 10.5.3)
  - [x] Read `irissys/%SYS/Security/Resources.cls` to confirm `Create(Name, Description, PublicPermission, Type)` signature.
  - [x] In the `create` branch (around line 660–665), change `Set tSC = ##class(Security.Resources).Create(tName, .tProps)` to:
    ```objectscript
    Set tDescription = $Get(tProps("Description"))
    Set tPublicPermission = $Get(tProps("PublicPermission"))
    Set tSC = ##class(Security.Resources).Create(tName, tDescription, tPublicPermission)
    ```
    (Skip the `Type` argument — it's documented "Internal use only, User defined resources should not pass this parameter".)
  - [x] Leave `Modify` branch alone — it's already correct.

- [x] **Task 3**: Fix `RoleManage()` in `src/ExecuteMCPv2/REST/Security.cls` (AC 10.5.4)
  - [x] Read `irissys/%SYS/Security/Roles.cls` `Create` signature to confirm positional argument order.
  - [x] In the `create` branch (around line 533–537), apply the same fix pattern with whatever positional args the IRIS Roles.Create signature expects.
  - [x] Leave `Modify` branch alone.

- [x] **Task 4**: Audit Users and Applications Create call sites (AC 10.5.5)
  - [x] Read `irissys/%SYS/Security/Users.cls` `Create` signature.
  - [x] Read `irissys/%SYS/Security/Applications.cls` `Create` signature.
  - [x] If either is positional scalars: apply the same fix to lines 176 (UserManage) or 1115 (WebAppManage).
  - [x] If either is byref Properties: leave as-is, document finding in Dev Agent Record.

- [x] **Task 5**: Unit tests (AC 10.5.6)
  - [x] `packages/iris-ops-mcp/src/__tests__/task.test.ts`: add `it("propagates taskId query param to URL when set")`.
  - [x] `packages/iris-admin-mcp/src/__tests__/resource.test.ts`: add `it("creates resource with description without error")`.
  - [x] `packages/iris-admin-mcp/src/__tests__/role.test.ts`: add `it("creates role with description without error")`.
  - [x] If Task 4 expanded scope: add equivalent tests in `user.test.ts` and `webapp.test.ts`. (Users.Create positional → user.test.ts test added; Applications.Create ByRef → no webapp.test.ts test needed.)

- [x] **Task 6**: Bootstrap version bump (AC 10.5.8)
  - [x] Run `npm run gen:bootstrap` after .cls edits land — verify the BOOTSTRAP_VERSION hash changes.
  - [x] Run `pnpm turbo run build` to pick up the new `bootstrap-classes.ts`.

- [x] **Task 7**: Deploy to running IRIS + live verification (AC 10.5.7)
  - [x] Use `iris_doc_load` (with the glob workaround for the bug-1-leakage in the running server: e.g., `path: "src/ExecuteMCPv2/REST/Tas*.cls"`) to upload the modified Task.cls and Security.cls.
  - [x] Compile via `iris_doc_compile` (using the full names `ExecuteMCPv2.REST.Task.cls` and `ExecuteMCPv2.REST.Security.cls`).
  - [x] Reproduce the bugs per [docs/known-bugs-2026-04-20.md](../../docs/known-bugs-2026-04-20.md) — both should now resolve cleanly.
  - [x] Test with a real task ID from `iris_task_list` (e.g., task ID 1, 5, 7, or 1000 — any with history entries).
  - [x] Clean up `MCPTestStory105` resource and `MCPTestStory105Role` role.
  - [x] **Note**: live verification requires user MCP server restart only if the TypeScript changes need to take effect. Story 10.5 changes are server-side ObjectScript, so a deployed-and-compiled .cls is sufficient — no MCP restart needed for the bug fixes themselves.

- [x] **Task 8**: CHANGELOG (AC 10.5.9)
  - [x] Append two new bullets to the existing `## [Pre-release — 2026-04-20]` `### Fixed` section in [CHANGELOG.md](../../CHANGELOG.md), per AC 10.5.9 wording.
  - [x] If Task 4 expanded scope, add a third bullet. (Added: one bullet for taskId filter, one consolidated bullet covering Resources/Roles/Users.)

- [x] **Task 9**: Build + validate (AC 10.5.10)
  - [x] `pnpm turbo run build` — clean.
  - [x] `pnpm turbo run test` — target 272+/272+ (3 new minimum, possibly 5).
  - [x] `pnpm turbo run lint` — no new warnings on touched files.

## Dev Notes

### Architecture constraints

- **ObjectScript-only changes.** No TypeScript-side changes (the bugs are entirely in the IRIS-side handlers).
- **`BOOTSTRAP_VERSION` will bump** because `Task.cls` and `Security.cls` are both embedded classes. Existing installs auto-upgrade on next MCP restart.
- **Both fixes are 1-shot, safe deployments.** No data migration. No schema change. No ObjectScript globals modified at runtime.

### Pattern to mirror

Story 10.4 (response-envelope cap) used the same auto-upgrade flow. After ObjectScript edits + `gen:bootstrap` + `pnpm turbo run build`, the next MCP server restart triggers the version-stamped probe path, which detects the new hash and redeploys all 13 classes.

### Reference materials

- [docs/known-bugs-2026-04-20.md](../../docs/known-bugs-2026-04-20.md) — full root-cause analysis, reproduction steps, IRIS source code line citations, and recommended fix snippets for both bugs.
- [irissys/%SYS/Task/History.cls](../../irissys/%SYS/Task/History.cls) — the IRIS class with the named queries (lines 148 + 170).
- [irissys/%SYS/Security/Resources.cls](../../irissys/%SYS/Security/Resources.cls) — confirms `Create(Name, Description, PublicPermission, Type)` signature.
- [irissys/%SYS/Security/Roles.cls](../../irissys/%SYS/Security/Roles.cls) — read this to confirm Roles.Create signature before Task 3.
- [irissys/%SYS/Security/Users.cls](../../irissys/%SYS/Security/Users.cls) — read this for Task 4.
- [irissys/%SYS/Security/Applications.cls](../../irissys/%SYS/Security/Applications.cls) — read this for Task 4.

### Project conventions (must follow)

- ObjectScript per [.claude/rules/iris-objectscript-basics.md](../../.claude/rules/iris-objectscript-basics.md): `Set tSC = $$$OK` first line, `Quit tSC` last line, try/catch for error trapping, `t` prefix for local vars, `p` prefix for parameters, no underscores in class/method names.
- Class methods accessed via `..#PARAMETERNAME` for parameters.
- The `RenderResponseBody` helper from `%Atelier.REST` (the Dispatch class's parent) is used for all REST responses.
- Sanitize errors via `##class(ExecuteMCPv2.Utils).SanitizeError(tSC)` before passing to `RenderResponseBody`.

### Anti-patterns to avoid

- ❌ Don't try to use `TaskHistoryDetail` AND filter client-side. The IRIS query is the right place — using `TaskHistoryForTask` is the correct architectural fix.
- ❌ Don't introduce a separate "filtered" code branch with significant logic duplication. Pick the query name based on `tTaskId` and let the rest of the loop be identical.
- ❌ Don't change the `Modify` branches in Security.cls. They already use byref Properties correctly per the IRIS API contract.
- ❌ Don't use `##super(initvalue)` patterns or `%OnNew` overrides — these handlers are stateless ClassMethods.
- ❌ Don't expand scope to refactor unrelated parts of `Security.cls`. The story is precisely 2 (or 4, if AC 10.5.5 finds them) Create call sites.

### Project Structure Notes

- After this story, sprint-status.yaml `10-5-objectscript-handler-bug-fixes` flips to `done`, and Epic 10 stays `in-progress` (10.6 still pending).
- No `docs/` updates here — the bug-report doc [docs/known-bugs-2026-04-20.md](../../docs/known-bugs-2026-04-20.md) becomes historical context after this story lands; it does NOT need to be deleted (kept as a reference for the diagnostic process).

### Testing standards

- Vitest already in use for all packages.
- Mock `IrisHttpClient` via the existing per-server test-helpers patterns — see existing tests in `packages/iris-ops-mcp/src/__tests__/task.test.ts` and `packages/iris-admin-mcp/src/__tests__/resource.test.ts`/`role.test.ts` for the conventions.
- For Bug 1 the new test asserts URL contract (`taskId` query param present when set) — the IRIS-side query selection is server-side and not directly testable from the TypeScript layer.
- For Bug 2 the new tests assert that calling create-with-description against a mocked-success response works (no thrown error). The mock returns `{action: "created", ...}` shape; the test verifies the handler doesn't fall into an isError path.

### References

- [Source: docs/known-bugs-2026-04-20.md] — Bug 1 and Bug 2 detailed root-cause analysis
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-04-20-stories-10-5-and-10-6.md] — Sprint Change Proposal §4 Proposal 1
- [Source: _bmad-output/planning-artifacts/epics.md#Story-10.5] — story spec embedded in epics.md
- [Source: _bmad-output/implementation-artifacts/epic-10-retro-2026-04-20.md] — Epic 10 retrospective Action Items #1, #2

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context) via Claude Code (bmad-dev-story workflow).

### Debug Log References

- `BOOTSTRAP_VERSION`: `5ffd4dee0649` → `81b78d308910` (confirmed via `git show HEAD` diff and post-regen read of `bootstrap-classes.ts`).
- IRIS compile result for `ExecuteMCPv2.REST.Task.cls` + `ExecuteMCPv2.REST.Security.cls`: "Compilation finished successfully in 0.046s" (console log via `iris_doc_compile` with flags `ck`).
- Test suite totals after changes: shared 193, dev 269, admin 203 (was 200, +3), interop 161, ops 150 (was 149, +1), data cached — total 976 across non-cached packages; **+4 new tests** this story.
- Live verification: `iris_task_history({taskId: 1000, maxRows: 10})` returned 10 entries all for task 1000 (total=94, truncated=true). `iris_resource_manage({action:"create", name:"MCPTestStory105", description:"test description"})` returned `{action:"created", name:"MCPTestStory105"}` with no isError. Same for role. Both cleaned up via delete action.

### Completion Notes List

- Fixed `TaskHistory()` in `ExecuteMCPv2.REST.Task.cls` to select `%SYS.Task.History:TaskHistoryForTask` named query (parameterized) when `taskId` is set, and `TaskHistoryDetail` (no parameter) otherwise. Both ROWSPECs share the field names the handler reads via `tRS.Get("Last Start")`, `Get("Completed")`, `Get("Task Name")`, `Get("Status")`, `Get("Result")`, `Get("NameSpace")`, `Get("Task")`, `Get("Username")` — verified by reading `irissys/%SYS/Task/History.cls` lines 148 and 170.
- Fixed three positional-scalar bugs in `ExecuteMCPv2.REST.Security.cls`: `Security.Resources.Create`, `Security.Roles.Create`, and `Security.Users.Create` all take positional scalars per their IRIS signatures, not ByRef Properties. The handlers now extract each property explicitly and call with the positional positional-argument shape each IRIS class expects. `Modify` branches (which all use `ByRef Properties`) are unchanged. `Security.Applications.Create` uses `ByRef Properties` and is also unchanged.
- Added four regression unit tests: `iris_task_history` taskId URL propagation, `iris_resource_manage` create with description, `iris_role_manage` create with description, `iris_user_manage` create with full profile fields.
- Bootstrap regenerated to bump `BOOTSTRAP_VERSION` — auto-upgrade path will trigger on the next MCP client restart after this story lands.
- Updated `CHANGELOG.md` — added taskId filter bullet and a consolidated Resources/Roles/Users Create bullet to the existing `## [Pre-release — 2026-04-20]` `### Fixed` section (one extra bullet beyond the story's original 2-bullet suggestion, because Task 4 expanded scope to Users).

### File List

- `src/ExecuteMCPv2/REST/Task.cls` — fixed `TaskHistory()` to select `TaskHistoryForTask(Task)` named query when `taskId` is set.
- `src/ExecuteMCPv2/REST/Security.cls` — fixed `ResourceManage()`, `RoleManage()`, and `UserManage()` create branches to pass positional scalars to `Security.Resources.Create`, `Security.Roles.Create`, and `Security.Users.Create` respectively.
- `packages/shared/src/bootstrap-classes.ts` — regenerated via `npm run gen:bootstrap`; `BOOTSTRAP_VERSION` changed from `5ffd4dee0649` to `81b78d308910` and embedded class bodies for Task.cls / Security.cls updated.
- `packages/iris-ops-mcp/src/__tests__/task.test.ts` — added `it("propagates taskId query param to URL when set")` regression test.
- `packages/iris-admin-mcp/src/__tests__/resource.test.ts` — added `it("creates resource with description without error")` regression test.
- `packages/iris-admin-mcp/src/__tests__/role.test.ts` — added `it("creates role with description without error")` regression test.
- `packages/iris-admin-mcp/src/__tests__/user.test.ts` — added `it("creates user with full profile fields without error")` regression test (added because Users.Create turned out to be positional, per AC 10.5.5 conditional).
- `CHANGELOG.md` — appended two new `### Fixed` bullets under `## [Pre-release — 2026-04-20]` for the taskId filter and the Resources/Roles/Users Create fix.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story 10-5 marked `in-progress` then `review`.

### Findings on AC 10.5.5 (Users + Applications Create signatures)

- **`Security.Users.Create` takes positional scalars**, NOT byref Properties. Signature (from `irissys/Security/Users.cls` line 392): `Create(Username, UserRoles, Password, FullName, NameSpace, Routine, ExpirationDate, ChangePassword, Enabled, Comment, Flags = 1, PhoneNumber, PhoneProvider, ByRef Attributes, AccountNeverExpires, PasswordNeverExpires, PasswordHashAlgorithm, PasswordHashWorkFactor, EscalationRoles)`. The defect existed in `UserManage()` line 176 — `Set tSC = ##class(Security.Users).Create(tName, .tProps)` was passing `.tProps` (a byref array) where IRIS expected `UserRoles` (a `%String`). The array's displayed form would be interpreted as a string which could silently bind to UserRoles, losing Password/FullName/etc. **Fix applied same as 10.5.3 and 10.5.4**: extract each scalar and pass positionally through the first ten arguments (Username, UserRoles, Password, FullName, NameSpace, Routine, ExpirationDate, ChangePassword, Enabled, Comment). Remaining arguments are not surfaced by the current tool schema and default fine. `Modify` branch is unchanged (Users.Modify is `ByRef Properties`).
- **`Security.Applications.Create` takes byref Properties.** Signature (from `irissys/Security/Applications.cls` line 407): `Create(Name As %String, ByRef Properties As %String) As %Status`. The existing `WebAppManage()` create call at line 1115 — `Set tSC = ##class(Security.Applications).Create(tName, .tProps)` — is correct. **No change needed.** `webapp.test.ts` therefore does not need an additional regression test per AC 10.5.6 bullet 4.

## Review Findings

- [x] [Review][Patch] `UserManage create` now creates disabled users when `enabled` is omitted [src/ExecuteMCPv2/REST/Security.cls:177] — **HIGH severity, auto-resolved during code review.** The positional-scalar refactor defaulted `tEnabled = ""` and `tChangePassword = ""` when the client did not supply them. `Security.Users.Create(..., Enabled As %Boolean, ...)` coerces `""` to 0, so every user created without an explicit `enabled` flag was silently disabled. The pre-refactor byref pattern omitted `Properties("Enabled")` entirely, allowing IRIS's internal default of 1 to apply. Fix: default `tEnabled = 1` and `tChangePassword = 0` in the create branch (with a comment noting the IRIS default), regenerate `bootstrap-classes.ts` (`BOOTSTRAP_VERSION` now `2689f7f657e4`), redeploy + recompile `ExecuteMCPv2.REST.Security.cls`, live-verify by creating a user without `enabled` and confirming `iris_user_get` returns `enabled: true`. Also added a clarifying sentence to the CHANGELOG bullet describing the regression and the default now being applied. Not covered by a new unit test — the behavior is a server-side-only contract and the mock layer cannot assert IRIS's default. The existing regression test (`creates user with full profile fields without error`) already calls create without `enabled` against a mocked-success envelope, which is the testable boundary from the TypeScript layer.

## Change Log

- 2026-04-20 — Implemented Story 10.5 ObjectScript handler bug fixes (Claude Opus 4.7). Fixed three `Security.*.Create` call sites (Resources, Roles, Users) to pass positional scalars instead of byref Properties, and fixed `TaskHistory()` to select `TaskHistoryForTask` parameterized query when `taskId` is set. Confirmed `Security.Applications.Create` is already correct (ByRef Properties). Added 4 regression tests (resource, role, user, task history); pnpm build + test green (+4 tests total across suite); lint shows only pre-existing errors in untouched files. `BOOTSTRAP_VERSION` bumped `5ffd4dee0649 → 81b78d308910`. Deployed + compiled on running IRIS; live verification of all three reproductions from `docs/known-bugs-2026-04-20.md` passed cleanly. CHANGELOG.md updated.
- 2026-04-21 — Code review follow-up (Claude Opus 4.7 reviewer). Caught HIGH-severity regression: the `Security.Users.Create` positional-scalar fix defaulted `tEnabled = ""` when the client did not supply `enabled`, which `%Boolean` coerces to 0, so all new users were silently disabled. Fix: default `tEnabled = 1` (to match IRIS's own default) and `tChangePassword = 0`. Regenerated `bootstrap-classes.ts` (`BOOTSTRAP_VERSION` now `2689f7f657e4 → 2689f7f657e4` post-regen), redeployed Security.cls, live-verified `iris_user_manage create` without `enabled` now returns `enabled: true` in `iris_user_get`. CHANGELOG bullet extended to call out the default.
