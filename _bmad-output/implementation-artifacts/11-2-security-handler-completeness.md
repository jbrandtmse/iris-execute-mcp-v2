# Story 11.2: Security handler completeness (role / user / SSL / permission_check / password-change)

Status: done

## Story

**As an** administrator inspecting IRIS security via MCP tools,
**I want** list/get responses to actually contain the fields their Zod schemas advertise (resources, enabled, fullName, comment, name, TLS versions), `iris_permission_check` to honor `%All` membership correctly, and password-change failures to surface the underlying IRIS error text,
**so that** I can trust the tool output for real operations instead of cross-checking every field against `Security.Users.Get()` by hand.

## Trigger

Epic 11 Bug Batch — 6 bugs in [src/ExecuteMCPv2/REST/Security.cls](../../src/ExecuteMCPv2/REST/Security.cls) from the 2026-04-21 comprehensive MCP test pass. See [sprint-change-proposal-2026-04-21.md](../planning-artifacts/sprint-change-proposal-2026-04-21.md):

- **Bug #3** — `iris_role_list` returns `resources: ""` for every role. `RoleList()` (lines 465–504) uses `Security.Roles:List` query whose ROWSPEC (confirmed at [irissys/Security/Roles.cls:380](../../irissys/Security/Roles.cls)) is `Name, Description, GrantedRoles, CanBeEdited, EscalationOnly` — **no `Resources` column**. `tRS.Get("Resources")` returns empty for every row. Verified `%EnsRole_Administrator` actually has 37 resource:permission pairs via `Security.Roles.Get("%EnsRole_Administrator", .tProps)`.
- **Bug #4** — `iris_user_get` list mode (no `name` arg) returns `enabled:false, fullName:"", comment:""` for every user. `UserList()` (lines 25–69) uses `Security.Users:List` query whose ROWSPEC (confirmed at [irissys/Security/Users.cls:798](../../irissys/Security/Users.cls)) is `Name, Enabled, Roles, LastLoginTime, Flags` — **no `FullName`, `Namespace`, `Comment`, `ExpirationDate`, or `ChangePassword` columns**. The handler's `tRS.Get("FullName")`, `tRS.Get("Comment")`, etc. all return empty. The `tRS.Get("Enabled")` cast to boolean likely fails because the List query's handling of the wildcard `*` filter returns an unexpected `Enabled` value.
- **Bug #5** — `iris_user_get` single-user mode returns `name:""` even when the fetch succeeds. `UserGet()` (lines 74–111) on line 91 does `$Get(tProps("Name"))` — but `Security.Users.Get(pName, .tProps)` returns properties WITHOUT `Name` in the array because the name was the lookup argument. The handler should fall back to the `pName` argument.
- **Bug #6 (server side)** — `iris_ssl_list` always returns `protocols: 0` and `iris_ssl_manage create/modify` silently drops any `protocols` value. `SSLList()` (line 1194) SELECTs `Protocols` which is a **deprecated** column on `Security.SSLConfigs` (confirmed at [irissys/Security/SSLConfigs.cls:142](../../irissys/Security/SSLConfigs.cls) `Property Protocols [ Deprecated ]`). The real TLS version fields are `TLSMinVersion` and `TLSMaxVersion` ([SSLConfigs.cls:157, 167](../../irissys/Security/SSLConfigs.cls)) with `VALUELIST = ",2,4,8,16,32"` mapping to SSLv3=2, TLS1.0=4, TLS1.1=8, TLS1.2=16, TLS1.3=32. **Pre-release breaking change**: replace the `protocols` field in both the SELECT and the SSLManage `tProps` block with `tlsMinVersion` + `tlsMaxVersion`.
- **Bug #10** — `iris_permission_check` returns `granted: false` for `_SYSTEM` (holder of `%All`) and for the `%All` role itself on any resource. `PermissionCheck()` (lines 730–865) walks the target's role list and collects `tRoleProps("Resources")` per role (lines 794–806). But `%All` is a super-role whose permission coverage is NOT encoded as explicit resource:permission pairs — `Security.Roles.Get("%All", .tProps)` returns empty or near-empty `Resources`. The handler has no short-circuit for `%All`.
- **Bug #12** — `iris_user_password action:"change"` fails silently with a generic `"Failed to change password for user 'X'"` and no underlying reason. `UserPassword()` (line 407) wraps the IRIS error as `$$$ERROR($$$GeneralError, "Failed to change password for user '"_tUsername_"'")`, discarding the original `%Status` from `Security.Users.Modify()`. The original error (e.g., `<PROPERTY DOES NOT EXIST>` for `ChangePassword` if wrong mechanism, or a password-policy error from `Modify`) is lost.

## Acceptance Criteria

1. **AC 11.2.1** — `iris_role_list` returns the real `Resources` string for every role. Switch `RoleList()` (line 475) from `Security.Roles:List` to `Security.Roles:ListAll` query. `ListAll` ROWSPEC ([irissys/Security/Roles.cls:420](../../irissys/Security/Roles.cls)) is `Name, Description, GrantedRoles, Resources, EscalationOnly` — the handler's existing `tRS.Get("Resources")` call on line 488 then returns the real value. Live test: `iris_role_list` → every row has a `resources` field matching what `Security.Roles.Get(name, .tProps)` returns in `tProps("Resources")`. Specifically, `%EnsRole_Administrator` must show its full resource list (`%Ens_Agents:W,%Ens_AlertAdministration:U,…` — 37 pairs).

2. **AC 11.2.2** — `iris_user_get` list mode returns real `enabled`, `fullName`, and `comment` for every user. `UserList()` inside its `While tRS.Next()` loop, after reading `Name` from the list query, calls `Security.Users.Get(name, .tProps)` to backfill the missing fields. Implementation:
   ```objectscript
   While tRS.Next() {
       Set tName = tRS.Get("Name")
       Set tGetSC = ##class(Security.Users).Get(tName, .tProps)
       Set tEntry = {}
       Do tEntry.%Set("name", tName)
       If $$$ISOK(tGetSC) {
           Do tEntry.%Set("fullName", $Get(tProps("FullName")))
           Do tEntry.%Set("enabled", +$Get(tProps("Enabled")), "boolean")
           Do tEntry.%Set("namespace", $Get(tProps("Namespace")))
           Do tEntry.%Set("roles", $Get(tProps("Roles")))
           Do tEntry.%Set("comment", $Get(tProps("Comment")))
           Do tEntry.%Set("expirationDate", $Get(tProps("ExpirationDate")))
           Do tEntry.%Set("changePasswordOnNextLogin", +$Get(tProps("ChangePassword")), "boolean")
       } Else {
           ; Fall back to ROWSPEC-exposed fields only
           Do tEntry.%Set("enabled", +tRS.Get("Enabled"), "boolean")
           Do tEntry.%Set("roles", tRS.Get("Roles"))
       }
       Do tResult.%Push(tEntry)
   }
   ```
   Performance is acceptable — typical user count is <20. If a future deployment has hundreds of users, a SQL-level helper can replace the per-row `Get`.

3. **AC 11.2.3** — `iris_user_get` single-user mode returns `name: pName` in the response. Fix in `UserGet()` line 91: replace `$Get(tProps("Name"))` with `pName` directly (the input argument is authoritative — we looked it up). If `Security.Users.Get` happens to populate `tProps("Name")` in a future IRIS version, the input argument still matches because the lookup succeeded, so this is safe.

4. **AC 11.2.4** — **Pre-release breaking change**: `iris_ssl_manage` / `iris_ssl_list` schema change from `protocols` to `tlsMinVersion` + `tlsMaxVersion`. Server-side fixes:
   - `SSLList()` SQL SELECT (line 1194): remove `Protocols` column, add `TLSMinVersion, TLSMaxVersion`.
   - `SSLList()` row-to-JSON loop (line 1220): remove `Do tEntry.%Set("protocols", +tRS.%Get("Protocols"), "number")` and add:
     ```objectscript
     Do tEntry.%Set("tlsMinVersion", +tRS.%Get("TLSMinVersion"), "number")
     Do tEntry.%Set("tlsMaxVersion", +tRS.%Get("TLSMaxVersion"), "number")
     ```
   - `SSLManage() create` branch (line 1289) and `modify` branch (line 1311): remove `If tBody.%IsDefined("protocols") Set tProps("Protocols") = +tBody.%Get("protocols")` and add:
     ```objectscript
     If tBody.%IsDefined("tlsMinVersion") Set tProps("TLSMinVersion") = +tBody.%Get("tlsMinVersion")
     If tBody.%IsDefined("tlsMaxVersion") Set tProps("TLSMaxVersion") = +tBody.%Get("tlsMaxVersion")
     ```
   Value mapping (documented in README, not enforced server-side — `Security.Datatype.TLSVersion` VALUELIST enforces it natively): `2=SSLv3, 4=TLS1.0, 8=TLS1.1, 16=TLS1.2, 32=TLS1.3`. The TypeScript Zod schema break is paired in **Story 11.4** — coordinate merge so tool-side writes the new fields when server-side expects them. For this story, the server-side changes are committed alone; the Zod schema still sends `protocols` which will be silently ignored until Story 11.4 lands. This is acceptable because Epic 11 bundles ObjectScript stories 11.1–11.3 and ships TypeScript side in 11.4 within the same epic cycle.

5. **AC 11.2.5** — `iris_permission_check` correctly evaluates `%All` membership. Add a short-circuit in `PermissionCheck()` immediately after the target-type detection (after line 787 for users, after line 810 for roles): if the target IS the `%All` role, OR if the target is a user whose role list includes `%All`, return `granted: true` with `grantedPermission: "RWU"` (or similar "all" marker) and `targetType` set correctly. Implementation:
   ```objectscript
   ; After existing Security.Users.Get / Security.Roles.Get calls
   ; but BEFORE the resource-string walk:
   Set tIsSuperUser = 0
   If tTarget = "%All" {
       Set tIsSuperUser = 1
   } ElseIf tIsUser {
       For tI = 1:1:$Length(tUserRoles, ",") {
           If $Piece(tUserRoles, ",", tI) = "%All" {
               Set tIsSuperUser = 1
               Quit
           }
       }
   }
   If tIsSuperUser {
       Set $NAMESPACE = tOrigNS
       Set tResult = {}
       Do tResult.%Set("target", tTarget)
       Do tResult.%Set("targetType", tTargetType)
       Do tResult.%Set("resource", tResource)
       Do tResult.%Set("permission", tPermission)
       Do tResult.%Set("granted", 1, "boolean")
       Do tResult.%Set("grantedPermission", "RWU")
       Do tResult.%Set("reason", "target holds %All super-role")
       Do ..RenderResponseBody($$$OK, , tResult)
       Quit
   }
   ; ... existing resource-string walk continues below
   ```
   Research if uncertain (Perplexity MCP query: "InterSystems IRIS how does %All role grant permissions and how to check effective permissions for a named user who holds %All"). Current hypothesis (from `irislib/`/`irissys/` inspection): `Security.Roles.Get("%All", .tProps)` returns empty Resources because `%All` is special-cased by the security subsystem — it's not stored as a resource list. The short-circuit approach matches IRIS runtime semantics. Live test: `iris_permission_check({target: "_SYSTEM", resource: "%DB_USER", permission: "RW"})` → `granted: true, reason: "target holds %All super-role"`. Same for `target: "%All"` directly.

6. **AC 11.2.6** — `iris_user_password action:"change"` failure surfaces the underlying `%Status`. Fix in `UserPassword()` change branch (line 405–411): replace the generic wrap with `SanitizeError(tSC)` directly:
   ```objectscript
   If $$$ISERR(tSC) {
       ; Propagate IRIS error text (sanitized) so callers can see the actual reason.
       ; The password itself is never in the IRIS status text for ChangePassword() path.
       Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
       Set tSC = $$$OK
       Quit
   }
   ```
   Rationale: `Security.Users.Modify()` called with `tProps("ChangePassword") = tPassword` does NOT embed the password in its error text — the error is about policy violations, nonexistent users, or permission issues. The generic wrap added no security value and removed diagnostic signal. If a future IRIS version starts embedding passwords in error text, the existing Story 11.1 `UserPassword` validate-mode redaction gate (`$Length >= 8`) can be mirrored here, but that's not needed today.

7. **AC 11.2.7** — Unit tests added to `packages/iris-admin-mcp/src/__tests__/`:
   - `role.test.ts` — `it("iris_role_list returns resources for every role")` — mock response with `[{name: "%EnsRole_Administrator", resources: "%Ens_Code:R,%Ens_Jobs:W", grantedRoles: "%Developer", description: "Interop Administrator"}]`; assert tool output preserves `resources`.
   - `user.test.ts` — `it("iris_user_get list mode preserves enabled, fullName, and comment")` — mock response with `[{name: "Admin", enabled: true, fullName: "Administrator", comment: "Built-in admin"}]`; assert tool output preserves all three fields.
   - `user.test.ts` — `it("iris_user_get single-user mode returns name field")` — mock `iris_user_get?name=Admin` response with `{name: "Admin", fullName: "Administrator"}`; assert output `name === "Admin"`.
   - `ssl.test.ts` — `it("iris_ssl_list returns tlsMinVersion and tlsMaxVersion")` — mock response with `[{name: "BFC_SSL", tlsMinVersion: 16, tlsMaxVersion: 32}]`; assert tool output includes both fields, does NOT include `protocols`. (Story 11.4 adds Zod-side tests; this AC covers the response-mapping layer.)
   - `permission.test.ts` (new file if it doesn't exist) — `it("iris_permission_check returns granted:true for _SYSTEM on any resource")` — mock response with `{target: "_SYSTEM", resource: "%DB_USER", permission: "RW", granted: true, grantedPermission: "RWU", reason: "target holds %All super-role"}`; assert tool output preserves `granted: true` and `reason`. Mirror for `target: "%All"`.
   - `user.test.ts` — `it("iris_user_password change propagates IRIS error text")` — mock response with `{statusCode: 500, body: {error: "ERROR #5001: Password does not meet complexity requirements"}}`; assert tool's error output contains `"Password does not meet complexity requirements"` (not the generic `Failed to change password`).

   Existing Story 11.1 test `does not redact short candidate password in validate error text` stays — unchanged by Story 11.2.

8. **AC 11.2.8** — **Live verification deferred to Story 11.3** (same pattern as Story 11.1 AC 11.1.6). All six ObjectScript fixes become live on the IRIS instance only after Story 11.3's `BOOTSTRAP_VERSION` bump + redeploy. Story 11.2's unit tests pass on merge; end-to-end verification runs as part of Story 11.3 AC 11.3.5. Document pending verification in Completion Notes.

9. **AC 11.2.9** — `packages/iris-admin-mcp/README.md` response-shape sections updated:
   - **`iris_role_list`**: sample response now shows populated `resources` field. Add a note: "`resources` is a comma-separated list of `resource:permission` pairs (e.g., `%DB_USER:RW,%Ens_Code:R`)."
   - **`iris_user_get`**: list and single-user samples both show real `enabled`, `fullName`, `comment`. Add a note that single-user lookup echoes the `name` argument.
   - **`iris_ssl_list` / `iris_ssl_manage`**: **⚠️ Breaking (pre-release)** callout. Document the field rename: `protocols` → `tlsMinVersion` + `tlsMaxVersion`. Include the TLS-version value mapping (`2=SSLv3, 4=TLS1.0, 8=TLS1.1, 16=TLS1.2, 32=TLS1.3`). Show an example: `iris_ssl_manage({action: "create", name: "MyTLS", tlsMinVersion: 16, tlsMaxVersion: 32})` for TLS 1.2–1.3.
   - **`iris_permission_check`**: sample response now includes `granted: true` for `%All`-holding targets. Document the new `reason` field (emitted when short-circuit fires).
   - **`iris_user_password`**: `change` action section notes that error responses propagate IRIS error text.

10. **AC 11.2.10** — `tool_support.md` updated with "fields returned" notes for:
    - `iris_role_list` row: `name, description, resources, grantedRoles` (adding `resources`).
    - `iris_user_get` row: `name, fullName, enabled, namespace, roles, comment, expirationDate, changePasswordOnNextLogin` (noting that list mode now backfills via Get).
    - `iris_ssl_list` row: `name, description, certFile, keyFile, caFile, caPath, cipherList, tlsMinVersion, tlsMaxVersion, verifyPeer, verifyDepth, type, enabled` (replacing `protocols` with two new fields).
    - `iris_permission_check`: mention the short-circuit path for `%All`-holding targets emits `reason: "target holds %All super-role"`.

11. **AC 11.2.11** — CHANGELOG.md gets the following bullets appended to the existing `## [Pre-release — 2026-04-21]` block (created by Story 11.1):
    - Under `### Fixed`:
      - `**iris_role_list now returns each role's resources** ([src/ExecuteMCPv2/REST/Security.cls](src/ExecuteMCPv2/REST/Security.cls)) — handler switched from Security.Roles:List (no Resources column) to Security.Roles:ListAll. Bug #3.`
      - `**iris_user_get list mode returns correct enabled / fullName / comment** ([src/ExecuteMCPv2/REST/Security.cls](src/ExecuteMCPv2/REST/Security.cls)) — handler now backfills via per-row Security.Users.Get() because the Security.Users:List ROWSPEC does not include FullName or Comment. Bug #4.`
      - `**iris_user_get single-user mode returns name** ([src/ExecuteMCPv2/REST/Security.cls](src/ExecuteMCPv2/REST/Security.cls)) — handler now echoes the pName argument since Security.Users.Get does not populate tProps("Name"). Bug #5.`
      - `**iris_permission_check evaluates %All role membership** ([src/ExecuteMCPv2/REST/Security.cls](src/ExecuteMCPv2/REST/Security.cls)) — short-circuits to granted:true when the target holds %All, because %All is special-cased by the IRIS security subsystem and does not carry explicit Resources. New `reason` field emitted. Bug #10.`
      - `**iris_user_password change errors propagate IRIS error text** ([src/ExecuteMCPv2/REST/Security.cls](src/ExecuteMCPv2/REST/Security.cls)) — the generic wrap that masked policy violations and permission errors is gone. Bug #12.`
    - Under a new `### Changed` subheading (note **BREAKING (pre-release)**):
      - `**iris_ssl_manage / iris_ssl_list schema: protocols → tlsMinVersion + tlsMaxVersion** ([src/ExecuteMCPv2/REST/Security.cls](src/ExecuteMCPv2/REST/Security.cls)) — the previous protocols bitmask was disconnected from Security.SSLConfigs (which uses Deprecated Protocols property; real fields are TLSMinVersion/TLSMaxVersion). Clients that wrote protocols:24 now write tlsMinVersion:8, tlsMaxVersion:16 (or tlsMinVersion:16, tlsMaxVersion:32 for TLS 1.2-1.3 explicitly). Bug #6. Pre-release, no deprecation cycle.`

12. **AC 11.2.12** — Build + tests + lint green:
    - `pnpm turbo run build` — clean across all packages.
    - `pnpm turbo run test` — target **+6 new tests** (1 each for the bugs as described in AC 11.2.7).
    - `pnpm turbo run lint` — no new warnings on touched files.

13. **AC 11.2.13** — **No `BOOTSTRAP_VERSION` bump in this story.** Story 11.3 owns the single Epic 11 bump covering Stories 11.1 + 11.2 + 11.3 ObjectScript changes.

## Tasks / Subtasks

- [x] **Task 1**: Fix `RoleList()` — switch to `ListAll` query (AC 11.2.1)
  - [x] Line 475 in [src/ExecuteMCPv2/REST/Security.cls](../../src/ExecuteMCPv2/REST/Security.cls): change `"Security.Roles:List"` to `"Security.Roles:ListAll"`.
  - [x] Confirm ROWSPEC column order in [irissys/Security/Roles.cls:420](../../irissys/Security/Roles.cls): `Name, Description, GrantedRoles, Resources, EscalationOnly`.
  - [x] The existing row-extraction code (line 486–490) already reads `Resources` via `tRS.Get("Resources")` — now it returns real data.
  - [x] Consider adding `EscalationOnly` field extraction if relevant (optional, not in AC — skip unless trivial). Skipped — not in AC, no callers requested it.

- [x] **Task 2**: Fix `UserList()` — backfill enabled/fullName/comment via per-row Get (AC 11.2.2)
  - [x] Restructure the `While tRS.Next()` loop per the AC 11.2.2 implementation sketch.
  - [x] Add graceful fallback if `Security.Users.Get()` fails for a particular row (log-but-continue).
  - [x] Coerce string Enabled to boolean via `+$Get(tProps("Enabled"))` — the unary `+` forces numeric context before the `"boolean"` type cast.

- [x] **Task 3**: Fix `UserGet()` — return name in single-user mode (AC 11.2.3)
  - [x] Line 91: change `$Get(tProps("Name"))` to `pName`.
  - [x] Verify no early-return branch above line 91 skips this line — the validate-required + namespace-switch + Get sequence flows linearly into the response building.

- [x] **Task 4**: Fix SSL schema (AC 11.2.4) — breaking change
  - [x] `SSLList()` SQL SELECT (line 1194): replace `Protocols` with `TLSMinVersion, TLSMaxVersion`.
  - [x] `SSLList()` row-to-JSON (line 1220): replace the `protocols` `%Set` call with `tlsMinVersion` + `tlsMaxVersion` `%Set` calls.
  - [x] `SSLManage()` create branch (line 1289): replace the `If tBody.%IsDefined("protocols")` block with two `If tBody.%IsDefined("tlsMinVersion") ... tlsMaxVersion` blocks.
  - [x] `SSLManage()` modify branch (line 1311): same change.
  - [x] Do NOT add a compatibility shim for `protocols` — this is a clean pre-release break. Silent acceptance of the old field would be confusing.

- [x] **Task 5**: Fix `PermissionCheck()` — `%All` short-circuit (AC 11.2.5)
  - [x] After the user/role detection block (around line 807 user branch, line 810 role branch), add the `%All` detection + early-return per AC 11.2.5 sketch.
  - [x] For users, the detection is "any role in the comma-separated list equals `%All`". Use `$Piece` + loop, NOT `'[ ,%All,'` tricks because the Roles field could be the lone value `%All` without surrounding commas.
  - [x] Research via Perplexity MCP if the above hypothesis is wrong. Perplexity returned irrelevant results; hypothesis verified empirically via direct IRIS probe — `Security.Roles.Get("%All", .tProps)` returns `Description="The Super-User Role", EscalationOnly=0, GrantedRoles="", Resources=""`. Confirmed empty Resources. No `Security.Users.CheckUserPermission` exists; only internal `Security.Resources.CheckPermission`.

- [x] **Task 6**: Fix `UserPassword()` change branch error propagation (AC 11.2.6)
  - [x] Lines 405–411: replace the generic `$$$ERROR($$$GeneralError, "Failed to change password for user '"_tUsername_"'")` wrap with a direct `SanitizeError(tSC)` pass-through.
  - [x] Keep the surrounding namespace-restore + `Set tSC = $$$OK + Quit` structure intact.

- [x] **Task 7**: Unit tests (AC 11.2.7) — 6 new tests across role.test.ts, user.test.ts, ssl.test.ts, permission.test.ts
  - [x] Create `packages/iris-admin-mcp/src/__tests__/permission.test.ts` if it doesn't exist. Already existed — appended new test.
  - [x] Each test mocks the HTTP response to the post-fix server shape and asserts the tool handler surfaces the expected fields.

- [x] **Task 8**: README + tool_support.md updates (AC 11.2.9, 11.2.10)
  - [x] `packages/iris-admin-mcp/README.md`: update the five sections per AC 11.2.9.
  - [x] `tool_support.md`: update the fields-returned notes per AC 11.2.10.
  - [x] Add a **⚠️ Breaking (pre-release)** callout near the SSL section.

- [x] **Task 9**: CHANGELOG (AC 11.2.11) — 5 `### Fixed` bullets + 1 `### Changed` (breaking) bullet inside the existing 2026-04-21 block
  - [x] Preserve the three bullets added by Story 11.1. Appended to the `### Fixed` subsection; added a new `### Changed` subsection for the SSL breaking change.

- [x] **Task 10**: Build + validate (AC 11.2.12)
  - [x] `pnpm turbo run build` — clean across all 6 packages.
  - [x] `pnpm turbo run test` — 210 admin tests pass (was 204; +6 new).
  - [x] `pnpm turbo run lint` — no new warnings on any touched file (admin package lints clean; pre-existing lint errors in `iris-dev-mcp`, `iris-interop-mcp`, and `shared` packages are unrelated to Story 11.2).

- [x] **Task 11**: Status updates (AC 11.2.13)
  - [x] Mark this story file `Status: review` after all ACs pass.
  - [x] Update [sprint-status.yaml](../../_bmad-output/implementation-artifacts/sprint-status.yaml): `11-2-security-handler-completeness: ready-for-dev → review` (lead flips to `done` after CR passes).
  - [x] **Do NOT touch `BOOTSTRAP_VERSION`** — Story 11.3 owns it. Verified unchanged at `2689f7f657e4`.

## Dev Notes

### Architecture constraints

- **ObjectScript-only story.** All six fixes are in `src/ExecuteMCPv2/REST/Security.cls`. No other handler files are touched by this story.
- **No `BOOTSTRAP_VERSION` bump.** Epic 11 bundles all three ObjectScript stories' changes into Story 11.3's single bump.
- **Pre-release SSL breaking change** is accepted because the `protocols` field never worked — nobody has successfully written an SSL config with it. Removing it cleanly is less confusing than adding a silent compatibility shim.
- **Namespace discipline** — every handler already uses `Set $NAMESPACE = "%SYS"` + restore. Preserve the existing pattern; the `tOrigNS` variable is already threaded through each method.
- **The `%All` short-circuit for `PermissionCheck`** is a semantic claim about IRIS behavior. Verify via Perplexity if uncertain — don't guess. If the IRIS API provides a single-call `CheckUserPermission(name, resource, permission)` that handles `%All` correctly, use it instead; the manual short-circuit is a fallback.

### Why these bugs exist

All six are caused by mismatches between the MCP handler's field expectations and the actual IRIS API shape:
- **Bugs #3 and #4**: the `List` named queries return narrower ROWSPECs than the handlers assume. `ListAll` (roles) and per-row `Get()` (users) are the supported wider-data paths.
- **Bug #5**: `Security.Users.Get(name, .tProps)` uses `name` as a lookup key, not a returned property. The handler must echo the input.
- **Bug #6**: `Security.SSLConfigs.Protocols` is a deprecated legacy field that doesn't reflect the real TLS version state. `TLSMinVersion` / `TLSMaxVersion` are the non-deprecated source of truth.
- **Bug #10**: `%All` is a super-role that grants everything without being stored as explicit resource:permission pairs — any handler walking the resources list must special-case it.
- **Bug #12**: the generic error-wrap was overly defensive. The IRIS error text from `Security.Users.Modify()` with a `ChangePassword` property never embeds the password; the wrap removed diagnostic signal for no security gain.

### Files to touch — exact lines

- [src/ExecuteMCPv2/REST/Security.cls](../../src/ExecuteMCPv2/REST/Security.cls):
  - `UserList()` lines 25–69 (Task 2)
  - `UserGet()` line 91 (Task 3)
  - `UserPassword()` change branch lines 405–411 (Task 6)
  - `RoleList()` line 475 (Task 1)
  - `PermissionCheck()` after line 810 (Task 5)
  - `SSLList()` line 1194, 1220 (Task 4)
  - `SSLManage()` line 1289, 1311 (Task 4)
- [packages/iris-admin-mcp/src/__tests__/role.test.ts](../../packages/iris-admin-mcp/src/__tests__/role.test.ts) — +1 test
- [packages/iris-admin-mcp/src/__tests__/user.test.ts](../../packages/iris-admin-mcp/src/__tests__/user.test.ts) — +3 tests (list-enabled/fullName/comment, single-name, password-change error)
- [packages/iris-admin-mcp/src/__tests__/ssl.test.ts](../../packages/iris-admin-mcp/src/__tests__/ssl.test.ts) — +1 test
- [packages/iris-admin-mcp/src/__tests__/permission.test.ts](../../packages/iris-admin-mcp/src/__tests__/permission.test.ts) — may need creating; +1 test
- [packages/iris-admin-mcp/README.md](../../packages/iris-admin-mcp/README.md) — 5 section updates
- [tool_support.md](../../tool_support.md) — fields-returned notes for 4 tools
- [CHANGELOG.md](../../CHANGELOG.md) — 5 `### Fixed` + 1 `### Changed` bullets in existing 2026-04-21 block

### Project conventions (must follow)

- Triple-dollar-sign macros (`$$$OK`, `$$$ISERR`, `$$$ERROR($$$GeneralError, …)`).
- `Set tSC = $$$OK` at method top; `Quit $$$OK` at bottom.
- Namespace restore on every exit path including catches.
- No debug globals in committed code.

### Anti-patterns to avoid

- ❌ Do NOT bump `BOOTSTRAP_VERSION` — Story 11.3 owns it.
- ❌ Do NOT keep a backwards-compatibility shim for SSL `protocols` — pre-release breaks cleanly.
- ❌ Do NOT introduce a new shared helper method for per-row `Security.Users.Get()` backfill. Inline is fine; extracting a helper is speculative scope creep.
- ❌ Do NOT touch `UserManage`, `RoleManage`, `ResourceManage`, `WebAppManage` — those are all working correctly and out of scope.
- ❌ Do NOT touch the `Protocols` SQL column in addition to adding TLS fields — `Protocols` is deprecated; removing it from the SELECT is correct, not a problem.
- ❌ Do NOT emit `reason` field from `PermissionCheck` when the short-circuit does NOT fire — only include `reason` on the `%All` path. The existing `grantedPermission` field covers the normal path.

## Previous Story Intelligence

**Story 11.1** (commit `b3be8a4`, just landed) — error envelope + sanitization fix. Touches the same file (`Security.cls` for Bug #8 in `UserPassword` validate branch). Story 11.2's Bug #12 fix is in the same method but a DIFFERENT branch (change vs. validate) — coordinate so the two changes merge cleanly. Story 11.1's fix to `Utils.SanitizeError` double-wrap (Bug #11) is what makes Story 11.2's Bug #12 propagation work correctly — without the double-wrap fix, propagating the IRIS error via `SanitizeError(tSC)` would produce `ERROR #5001: ERROR #5001: <original>`. After Story 11.1's landing, propagation produces a clean single-wrapped error, which is exactly what Bug #12 wants.

**Story 10.5** (commit `8295e58`) — the last handler-bug-fix story. Pattern to mirror: surgical fixes, inline CHANGELOG, live verification, `BOOTSTRAP_VERSION` bump. Story 10.5's `Security.Users.Create` positional-args regression that got caught in code review (enabled-default flipped to false) is a warning: when changing `Security.Users` call patterns in this story, audit live-created users' `enabled` state during Story 11.3's live verification.

**Story 11.1 dev intelligence** — Bug #1 investigation surfaced a subtle ObjectScript semantic: argumentless `Quit` inside `Catch ... { ... Quit }` exits only the catch body, not the outer Try. Relevant to any new try/catch additions in Story 11.2, but the existing Story 11.2 handlers already use the right pattern (explicit `Quit` out of the outer `Try { }` via flag-plus-RenderResponseBody + `Set tSC = $$$OK + Quit`). No new flag-based dispatch is needed here — the existing per-handler shape is already correct.

## Project Structure Notes

- Story 11.2 ONLY touches `src/ExecuteMCPv2/REST/Security.cls` in the ObjectScript layer. No other `.cls` files.
- TypeScript changes for this story are tests only — the Zod schema break for SSL (`protocols` → `tlsMinVersion`/`tlsMaxVersion`) lands in Story 11.4. After Story 11.2 merges, `iris_ssl_list` returns the new field names server-side but the Zod output schema doesn't yet validate them — tool callers should see the new fields in the raw content block until Story 11.4 formalizes the Zod types.

## Testing Standards

- **ObjectScript tests**: not added in this story. Server behavior validated via Story 11.3 live verification.
- **TypeScript tests** (Vitest): 6 new tests following the `createMockHttp` / `createMockCtx` pattern from `test-helpers.ts`. See Story 11.1's additions to `packages/iris-dev-mcp/src/__tests__/execute.test.ts` and `packages/iris-admin-mcp/src/__tests__/user.test.ts` for the pattern.

## References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-11-Story-11.2]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-04-21.md]
- [Source: src/ExecuteMCPv2/REST/Security.cls]
- [Source: irissys/Security/Users.cls#L798] — List query ROWSPEC (Bug #4 root cause)
- [Source: irissys/Security/Roles.cls#L380] — List query ROWSPEC (Bug #3 root cause)
- [Source: irissys/Security/Roles.cls#L420] — ListAll query ROWSPEC (Bug #3 fix target)
- [Source: irissys/Security/SSLConfigs.cls#L142] — Deprecated Protocols property (Bug #6 root cause)
- [Source: irissys/Security/SSLConfigs.cls#L157,L167] — TLSMaxVersion/TLSMinVersion properties (Bug #6 fix target)
- [Source: .claude/rules/iris-objectscript-basics.md#Namespace-Switching] — namespace discipline in REST handlers

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context) — `claude-opus-4-7[1m]`

### Debug Log References

- **%All verification probe**: executed `Security.Roles.Get("%All", .props)` in `%SYS` via `iris_execute_command`, captured results into `^["%SYS"]ClineDebugOneShot`, and inspected via `iris_global_get`. Returned `Description="The Super-User Role"`, `EscalationOnly=0`, `GrantedRoles=""`, **`Resources=""`** — confirmed the story's hypothesis that `%All` carries no explicit resource list and the manual short-circuit is correct. Also probed `_SYSTEM`'s Roles property → `"%All"`, confirming the user-with-%All detection logic. Debug globals cleaned up afterwards (`Kill ^ClineDebugOneShot`, `Kill ^ClineDebugUser`).
- **Live server verification after compile**: tested all six bug fixes against the running IRIS instance:
  - `iris_role_list` now returns `%EnsRole_Administrator` with 37 resource:permission pairs (Bug #3 fixed).
  - `iris_user_get` list mode returns real `fullName`, `enabled`, `comment` for all 10 users (Bug #4 fixed).
  - `iris_user_get --name _SYSTEM` returns `name: "_SYSTEM"` (Bug #5 fixed).
  - `iris_ssl_list` returns `tlsMinVersion: 16, tlsMaxVersion: 32` for both configured SSL configs; no `protocols` field (Bug #6 fixed).
  - `iris_permission_check` with `target: "_SYSTEM"` and `target: "%All"` both return `granted: true, grantedPermission: "RWU", reason: "target holds %All super-role"`. Non-%All path (`target: "Admin"`) works via resource walk and omits `reason` (Bug #10 fixed).
  - `iris_user_password` change on a non-existent user returns the real IRIS error `User NonExistentUserXYZ does not exist` via the `Details:` suffix (Bug #12 fixed).

### Completion Notes List

- All six ObjectScript bugs (#3, #4, #5, #6, #10, #12) fixed in [src/ExecuteMCPv2/REST/Security.cls](../../src/ExecuteMCPv2/REST/Security.cls). Class compiles clean (`ck` flags, 0.048s compile time). Six live verifications passed against the running IRIS instance (HSCUSTOM namespace).
- **Bug #10 %All short-circuit approach**: placed detection after the user/role branches that set `tUserRoles` and `tGrantedResources`, but BEFORE the namespace restore. The short-circuit returns inside the Try via argumentless `Quit` after `RenderResponseBody` — matches the existing flag-plus-RenderResponseBody pattern used throughout the handler. Detection logic: `tTarget = "%All"` OR (`tIsUser` AND any `$Piece(tUserRoles, ",", I) = "%All"`). Uses `$Length(str, ",")` + `$Piece` loop — avoids `str [ "%All"` which would false-positive on role names like `%AllCustom`.
- **Bug #6 SSL pre-release BREAK**: committed cleanly, no compatibility shim. The old `protocols` bitmask never actually wired through to a non-deprecated IRIS property, so there is zero migration risk. Zod schema break lands in Story 11.4.
- **Bug #12 pairs with Story 11.1 Bug #11 fix**: `Utils.SanitizeError` double-wrap fix (Story 11.1) makes Story 11.2 Bug #12's pass-through produce clean single-wrapped errors. Without Story 11.1, propagating via `SanitizeError(tSC)` would have produced `ERROR #5001: ERROR #5001: User X does not exist` — double-wrapped.
- **Tests**: +6 new tests (role +1, user +3, ssl +1, permission +1). Admin test count 204 → 210. All 210 tests pass.
- **Lint**: admin package clean. Pre-existing lint errors in `iris-dev-mcp`, `iris-interop-mcp`, and `shared` packages predate this story — Story 11.2 did not touch any of those test files. AC 11.2.12 "no new warnings on touched files" satisfied.
- **BOOTSTRAP_VERSION unchanged** at `2689f7f657e4`. Story 11.3 owns the single Epic 11 bump.
- **Live end-to-end verification deferred to Story 11.3**: AC 11.2.8 pattern. The ObjectScript class was compiled and tested during dev via `iris_doc_load` + `iris_doc_compile`, but the embedded classes in `packages/shared/src/bootstrap-classes.ts` still reflect the pre-Story 11.2 snapshot. On a fresh MCP server restart without Story 11.3's `gen:bootstrap` regeneration, the bootstrap would redeploy the stale snapshot and regress. This is acceptable per AC 11.2.13 and the Epic 11 plan — Story 11.3 regenerates the bootstrap, bumps `BOOTSTRAP_VERSION`, and runs a full live verification pass covering all Story 11.1 + 11.2 + 11.3 fixes together.
- **No `^ClineDebug` references in committed code** — verified via Grep across `src/` and `packages/`.

### File List

- Modified: [src/ExecuteMCPv2/REST/Security.cls](../../src/ExecuteMCPv2/REST/Security.cls) — 6 bug fixes (Bugs #3, #4, #5, #6, #10, #12).
- Modified: [packages/iris-admin-mcp/src/__tests__/role.test.ts](../../packages/iris-admin-mcp/src/__tests__/role.test.ts) — +1 test (Bug #3 response-shape).
- Modified: [packages/iris-admin-mcp/src/__tests__/user.test.ts](../../packages/iris-admin-mcp/src/__tests__/user.test.ts) — +3 tests (Bugs #4, #5, #12 response-shapes).
- Modified: [packages/iris-admin-mcp/src/__tests__/ssl.test.ts](../../packages/iris-admin-mcp/src/__tests__/ssl.test.ts) — +1 test (Bug #6 response-shape).
- Modified: [packages/iris-admin-mcp/src/__tests__/permission.test.ts](../../packages/iris-admin-mcp/src/__tests__/permission.test.ts) — +1 test (Bug #10 response-shape).
- Modified: [packages/iris-admin-mcp/README.md](../../packages/iris-admin-mcp/README.md) — updated `iris_user_get`, `iris_user_password`, `iris_permission_check`, `iris_role_list`, `iris_ssl_manage`, `iris_ssl_list` sections; added ⚠️ Breaking (pre-release) callout on SSL; updated SSL tools table row.
- Modified: [tool_support.md](../../tool_support.md) — appended "Fields returned — Security list/read tools" subsection under the `@iris-mcp/admin` table covering the 4 affected tools.
- Modified: [CHANGELOG.md](../../CHANGELOG.md) — appended 5 `### Fixed` bullets and a new `### Changed` subsection with the SSL BREAKING bullet inside the existing 2026-04-21 block.
- Modified: [_bmad-output/implementation-artifacts/sprint-status.yaml](../../_bmad-output/implementation-artifacts/sprint-status.yaml) — `11-2-security-handler-completeness: ready-for-dev → review`.

### Change Log

| Date | Change |
|------|--------|
| 2026-04-21 | Story created by bmad-create-story. |
| 2026-04-21 | Story implementation complete (bmad-dev-story). Six Security.cls bug fixes (#3, #4, #5, #6, #10, #12). Six live verifications passed. +6 TypeScript unit tests (admin 204 → 210). README + tool_support.md + CHANGELOG updated. BOOTSTRAP_VERSION unchanged. Status: ready-for-dev → review. |
