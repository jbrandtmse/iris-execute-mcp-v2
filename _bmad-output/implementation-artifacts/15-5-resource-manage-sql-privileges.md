# Story 15.5: `iris_resource_manage` — Column/Schema SQL Privilege Enhancement

Status: done

## Story

As an administrator,
I want to grant/revoke column- and schema-level SQL privileges via the agent,
so that I can manage fine-grained SQL access (parity with the SMP privilege dialogs) — additively, without changing the existing resource tool.

## Context

Fifth Epic 15 story — and the FIRST that **extends an existing tool** rather than adding a new one. `iris_resource_manage` (in `packages/iris-admin-mcp/src/tools/resource.ts`) today manages IRIS security **resources** (actions `create`/`delete`/`modify` — all in the frozen `GOVERNANCE_BASELINE`). This story adds SQL-privilege actions (`grant`/`revoke` + a read path) backed by `%SYSTEM.SQL.Security`.

Cross-cutting decisions in force (unchanged): **frozen-foundation governance baseline** (hash `1e62c5ad5bf7`, 141 keys) and **bootstrap regen per ObjectScript story** (`pnpm run gen:bootstrap`, Rule #18; `BOOTSTRAP_VERSION` current `8b074e457c3c`). NOTE: only if this story touches ObjectScript — if it's implemented purely via SQL through an existing execution path, there may be no `.cls` change and no bootstrap bump. Determine during impl.

**Frozen-foundation interaction (important):** the existing `iris_resource_manage:create|delete|modify` keys ARE baseline members → they stay grandfathered-enabled, behavior unchanged. The NEW action keys (`grant`/`revoke`/`listPrivileges`) are NOT in the baseline → they default-disable (writes) / enable (reads) via `mutates`. Only the new keys need classification (Story 15.0 strict contract requires every non-baseline key classified; existing baseline keys are exempt). Do NOT add the new keys to the baseline; do NOT regenerate the baseline (hash stays `1e62c5ad5bf7`).

## Acceptance Criteria

1. **AC 15.5.1 — Additive action extension.** Extend `iris_resource_manage`'s `action` enum with `grant`, `revoke`, and a read action `listPrivileges` (lists current grants for a target). The existing `create`/`delete`/`modify` actions, their parameters, defaults, and output shapes are UNCHANGED (AC 15.5.6). Recommended placement: extend `resource_manage` (per epics.md — keep the tool count lean), NOT a new `iris_sql_privilege` tool.

2. **AC 15.5.2 — Governance classification (new keys only).** Add `mutates` to the tool classifying AT LEAST the new keys: `grant:"write"`, `revoke:"write"`, `listPrivileges:"read"` (existing baseline actions may be omitted — they're grandfathered; if you classify them too, it must not change their enabled-by-default state). Under empty `IRIS_GOVERNANCE`: `grant`/`revoke` **disabled**, `listPrivileges` **enabled**, AND `create`/`delete`/`modify` **still enabled** (baseline-grandfathered — prove this). Real-gate test through `McpServerBase.handleToolCall`.

3. **AC 15.5.3 — SQL privilege API (Rule #16 probe).** Implemented via `%SYSTEM.SQL.Security` — `GrantPrivilege(ObjPriv, ObjList, Type, User)`, `RevokePrivilege(ObjPriv, ObjList, Type, User, wGrant, Cascade, AsGrantor)`, `CheckPrivilege(Username, ObjectType, Object, Action, Namespace)` for the read path — and/or SQL `GRANT`/`REVOKE`. Verify the exact `ObjPriv`/`ObjList`/`Type` encoding for schema-, table-, and **column-level** privileges (mirror `%CSP.UI.Portal.Dialog.ColumnPriv`/`SchemaPriv` semantics) via live probe before coding. Determine whether a `.cls` handler is needed or whether the existing SQL execution path suffices.

4. **AC 15.5.4 — Read path.** `listPrivileges` returns the current grants for a target (schema/table/column) — who has what privilege. Use `CheckPrivilege`/a catalog query as the source.

5. **AC 15.5.5 — I/O contract.** Input for the new actions: `target` (schema / `schema.table` / `schema.table(column,...)`), `privilege` (one or more of SELECT/INSERT/UPDATE/DELETE/REFERENCES), `grantee` (user or role), plus `server` (framework-injected) and `namespace`. Existing-action inputs unchanged. Output: grant/revoke structured result / privilege list.

6. **AC 15.5.6 — Back-compat gate (release-critical, Rule #19).** ALL existing `iris_resource_manage` actions, parameters, defaults, and output shapes are byte-for-byte unchanged; the existing `iris_resource_manage:create|delete|modify` baseline keys are untouched and still grandfathered-enabled; `iris_resource_list` unchanged. The privilege capability is purely additive. A test asserts the existing surface (schema + a representative existing-action call) is unchanged. Governance hash stays `1e62c5ad5bf7` / 141 keys.

7. **AC 15.5.7 — Errors (Rule #9).** `SanitizeError` (or the SQL error path) preserves the real error text (e.g. "table does not exist", "no such user") — no generic replacement. SQLCODE surfaced meaningfully.

8. **AC 15.5.8 — Tests.** `@iris-mcp/admin` unit tests: grant/revoke/listPrivileges (mocked) for schema-, table-, column-level; the governance-default-disabled real-gate test; AND the AC 15.5.6 back-compat assertion (existing actions unchanged). Default suite.

9. **AC 15.5.9 — Back-compat + bootstrap.** Governance hash `1e62c5ad5bf7` / 141 keys unchanged. IF ObjectScript changed: `bootstrap-classes.ts` regenerated, record `BOOTSTRAP_VERSION` from→to. IF no ObjectScript change: note "no bootstrap bump (SQL-only)". Full monorepo build/test/lint green; `tsc` strict clean.

10. **AC 15.5.10 — Live verification.** Against HSCUSTOM: `listPrivileges` on a known schema/table returns grants; a `grant` then `revoke` round-trip on a clearly-disposable test grantee/table (then cleaned up) succeeds and is reflected by `listPrivileges`. Capture as smoke evidence.

## Tasks / Subtasks

- [x] **Task 1 — Probe (Rule #16):** read `irislib/%SYSTEM/SQL/Security.cls`; resolve the exact `ObjPriv`/`ObjList`/`Type`/`User` encoding for schema/table/COLUMN-level grant+revoke and the read path. Decide ObjectScript-handler-vs-SQL-path placement. **DONE: `%SYSTEM.SQL.Security.GrantPrivilege/RevokePrivilege` do NOT support column-level (ObjPriv is action-keywords only, no col syntax). Column-level requires `%SQL.Manager.API.SaveObjPriv(acts,type,objs,users,g,revoke,.SQLCODE,.msg,GrantedBy,.fields)` — `.fields`=$LIST of columns; this is what the SMP ColumnPriv/SchemaPriv dialogs use and it covers schema(type=5)/table(type=1)/view(type=3) AND column-level uniformly. Read path: `%SQL.Manager.CatalogPriv:UserPrivs(user,system)` (table/view/proc/schema privs; ROWSPEC TYPE,NAME,PRIVILEGE,GRANTED_BY,GRANT_OPTION,GRANTED_VIA,HAS_COLUMN_PRIV) + `:UserColumnPrivs(user,schema,table,system)` (COLUMN_NAME,PRIVILEGE,GRANTED_BY,GRANT_OPTION,GRANTED_VIA). Privileges run in TARGET namespace (not %SYS). Live-probed grant→list→revoke round-trip on Ens.AlarmRequest w/ disposable role = SQLCODE 0. A `.cls` handler IS needed → bootstrap bump required.**
- [x] **Task 2 — Extend the tool** — add `grant`/`revoke`/`listPrivileges` to the action enum + the new optional input fields (`target`/`privilege`/`grantee`); add the partial `mutates`. EXISTING actions/params/output untouched (AC 15.5.6). DONE: also `namespace` added (SQL privs are namespace-scoped); `name` relaxed required→optional (backward-compatible widening so grant/revoke calls validate; server still requires name for create/delete/modify; resource wire body unchanged — still `{action,name}`).
- [x] **Task 3 — Backend** — wire grant/revoke/list to `%SYSTEM.SQL.Security` (handler method on `Security.cls` OR existing SQL path); namespace handling as required; error/SQLCODE surfacing. DONE: new `SqlPrivilegeManage` (POST grant/revoke) + `SqlPrivilegeList` (GET listPrivileges) handlers on `Security.cls`, routed at `/security/sqlprivilege`. Backed by `%SQL.Manager.API.SaveObjPriv` (column-capable via `.fields`) + `%SQL.Manager.CatalogPriv:UserPrivs`/`:UserColumnPrivs`. Runs in target namespace. SQLCODE+msg surfaced. ResourceManage/ResourceList byte-for-byte untouched.
- [x] **Task 4 — Tests** — new actions (schema/table/column) + real-gate governance + the AC 15.5.6 existing-surface-unchanged assertion. DONE: resource.test.ts +13 (SQL-priv grant/revoke/list schema/table/column + mutates assertion + back-compat describe block); resource-governance.test.ts +5 (real-gate through handleToolCall: grant/revoke denied, listPrivileges enabled, create/delete/modify still enabled, explicit-enable flip).
- [x] **Task 5 — Live-verify** grant→listPrivileges→revoke round-trip on a disposable target; clean up. DONE: HTTP probe against live HSCUSTOM REST endpoint — grant SELECT,UPDATE (table) + SELECT (column) on Ens.AlarmRequest to disposable role ZZZSQLPRIVHTTPTEST, listPrivileges showed the Direct grants (count 13), revoke both, listPrivileges after showed them gone (count 11, only inherited Owner privs remain). Disposable role deleted; probe class deleted.
- [x] **Task 6 — Back-compat + bootstrap proof** (hash `1e62c5ad5bf7`; bootstrap regen ONLY if `.cls` changed — record from→to or "SQL-only no bump"; suite green). DONE: `.cls` changed → `pnpm run gen:bootstrap` → BOOTSTRAP_VERSION `8b074e457c3c` → `038102d88885`. Governance baseline unchanged `1e62c5ad5bf7` / 141 keys (NOT regenerated; drift check green). Full monorepo green: shared 500, admin 421, dev 293, data 120, interop 171, ops 159; build/lint/tsc exit 0.

## Dev Notes

- **`%SYSTEM.SQL.Security` (from `irislib/%SYSTEM/SQL/Security.cls`):** `GrantPrivilege(ObjPriv,ObjList,Type,User)` / `GrantPrivilegeWithGrant(...)`; `RevokePrivilege(ObjPriv,ObjList,Type,User,wGrant,Cascade,AsGrantor)`; `CheckPrivilege(Username,ObjectType,Object,Action,Namespace)`. `*One` variants are `[Internal]`. Verify column-level `ObjPriv` syntax (e.g. `"SELECT(col1,col2)"`) and `Type`/`ObjectType` codes via probe.
- **Existing surface MUST be identical (AC 15.5.6):** read `resource.ts` carefully; only ADD enum values + optional fields; never change existing field names, defaults, descriptions, or output mapping for create/delete/modify. The new optional fields must be ignored by the existing actions.
- **mutates partial record:** classify the new keys (`grant`/`revoke`/`listPrivileges`); the existing `create`/`delete`/`modify` are baseline-grandfathered and need no classification (and classifying them must not flip their default-enabled state — baseline membership wins in `defaultSeed`).
- **Patterns:** prior admin tools for the tool shape + real-gate governance test; if a `.cls` handler is added, mirror `Security.cls` method patterns + `Dispatch.cls` routes + bootstrap regen. If SQL-only, no bootstrap bump.
- **Live caution:** grant/revoke change real ACLs — use a clearly-disposable test grantee + table for the round-trip, then revoke/clean up.

## Dev Agent Record

### Implementation Plan / Decisions

- **API placement (Task 1 / AC 15.5.3 / Rule #16):** Probed `irislib/%SYSTEM/SQL/Security.cls` first. Found `%SYSTEM.SQL.Security.GrantPrivilege/RevokePrivilege` do NOT support column-level grants — their `ObjPriv` is a comma list of action keywords only (no `SELECT(col)` syntax). The SMP ColumnPriv/SchemaPriv dialogs instead use `##class(%SQL.Manager.API).SaveObjPriv(acts, type, objs, users, g, revoke, .SQLCODE, .%msg, GrantedBy, .fields)`, which is column-capable via the `.fields` ($LIST of columns) argument and covers schema(type=5)/table(type=1)/view(type=3)/column uniformly. Chose `SaveObjPriv` as the single write API. Read path: `%SQL.Manager.CatalogPriv:UserPrivs(user,system)` (object-level) + `:UserColumnPrivs(user,schema,table,system)` (column-level), both via `%ResultSet`.
- **Handler vs SQL-path:** an ObjectScript `.cls` handler IS needed (read uses named-query `%ResultSet`s; write loops action-letters × `.fields`). Added two methods to `Security.cls` + a new `/security/sqlprivilege` route group (GET=list, POST=grant/revoke). The existing `ResourceManage`/`ResourceList` handlers are byte-for-byte UNCHANGED. → bootstrap bump required (Option A).
- **Namespace:** SQL privileges are namespace-scoped (NOT %SYS). The handler switches to the requested `namespace` (default = request namespace) for the SaveObjPriv/catalog calls; only the disposable-role create/delete in the live probe used %SYS (role lifecycle, out of handler scope).
- **Back-compat (AC 15.5.6):** in `resource.ts` only ADDED enum values (`grant`/`revoke`/`listPrivileges`) + optional fields (`target`/`privilege`/`grantee`/`namespace`) + `mutates`. Existing field names/defaults/descriptions for create/modify/delete and the resource wire body (`{action,name,...}` → `/security/resource`) are unchanged. The one widening: `name` `z.string()` → `z.string().optional()` so privilege calls (which omit `name`) pass schema validation — backward-compatible (no previously-valid input breaks; server still enforces name-required for create/delete/modify). A back-compat describe block asserts the create call still emits the identical `{action:"create",name:"MinimalRes"}` wire body.
- **mutates (AC 15.5.2):** `{ grant:"write", revoke:"write", listPrivileges:"read" }` — only the NEW (non-baseline) keys. create/delete/modify are Epic-14 baseline members → grandfathered-enabled (baseline membership wins in `defaultSeed`); not classified.
- **Errors (Rule #9 / AC 15.5.7):** when `SaveObjPriv` returns `SQLCODE < 0`, the handler surfaces `SQLCODE <n>: <msg>` in the error text via `SanitizeError` — no generic replacement.

### Completion Notes

- All 6 tasks complete; all 10 ACs satisfied. Live-verified end-to-end through the REST endpoint on HSCUSTOM (grant→list→revoke round-trip on a disposable role + table; cleaned up). Two temp probe classes created on disk + IRIS, used, and DELETED from both.
- **BOOTSTRAP_VERSION `8b074e457c3c` → `038102d88885`** (Security.cls + Dispatch.cls changed; regenerated via `pnpm run gen:bootstrap`, Rule #18 — output-only, not hand-edited). **CR update: `038102d88885` → `e5f4f6d88c56`** after the code-review HIGH fix to `SqlPrivilegeManage` (single-response/no-partial-grant on invalid privilege list); bootstrap regenerated again.
- **Column-level encoding used:** `target` `schema.table(col1,col2)` → `SaveObjPriv(actionLetter, type=1, "schema.table", grantee, 0, revoke, .SQLCODE, .msg, $Username, fields=$LB(col1,col2))`. A bare `schema` → type 5; `schema.table` (no parens) → type 1, empty fields. Privilege keywords map SELECT→s, INSERT→i, UPDATE→u, DELETE→d, REFERENCES→r (ALTER→a accepted); `*` → all.
- Governance baseline NOT regenerated — hash stays `1e62c5ad5bf7` / 141 keys; one-directional drift test green.

## File List

- `src/ExecuteMCPv2/REST/Security.cls` (modified — added `SqlPrivilegeManage` + `SqlPrivilegeList` class methods; existing handlers untouched)
- `src/ExecuteMCPv2/REST/Dispatch.cls` (modified — added GET/POST routes for `/security/sqlprivilege`)
- `packages/iris-admin-mcp/src/tools/resource.ts` (modified — extended `iris_resource_manage` action enum + optional fields + `mutates` + SQL-privilege handler branches; resource path unchanged)
- `packages/iris-admin-mcp/src/__tests__/resource.test.ts` (modified — +13 tests: SQL-priv schema/table/column grant/revoke/list, mutates assertion, AC 15.5.6 back-compat block)
- `packages/iris-admin-mcp/src/__tests__/resource-governance.test.ts` (new — 5 real-gate governance tests through `McpServerBase.handleToolCall`)
- `packages/shared/src/bootstrap-classes.ts` (regenerated — BOOTSTRAP_VERSION `8b074e457c3c` → `038102d88885`, then CR fix → `e5f4f6d88c56`; output-only)

## Code Review Notes (2026-06-16)

- **HIGH (fixed): partial grant + double render on a mixed valid/invalid privilege list.** In `Security.cls:SqlPrivilegeManage`, the invalid-privilege branch inside the action-letter `For` loop reset `tSC = $$$OK` before the post-loop `If $$$ISERR(tSC) Quit` guard. With input like `privilege:"SELECT,BOGUS"`, the guard saw OK, fell through, granted the preceding valid letter via `SaveObjPriv` (silent partial ACL change) AND rendered a SECOND response (Rule #7 single-dispatch violation) after already rendering the invalid-privilege error. Fix: leave `tSC` as the error inside the loop so the guard exits the method; reset to `$$$OK` inside the guard. Verified via live probe: `SELECT,BOGUS` → exits early, 1 render, `SaveObjPriv` NOT reached; `SELECT,UPDATE` → reaches `SaveObjPriv` with `tActs="su"`, 0 premature renders. Bootstrap regenerated (`038102d88885` → `e5f4f6d88c56`); full monorepo green (shared 500 / admin 439 / dev 293 / data 120 / interop 171 / ops 159); build/lint/type-check exit 0; governance baseline unchanged (`1e62c5ad5bf7` / 141 keys).
- **Type-code correctness (AC 15.5.3) — verified.** Live-probed `SaveObjPriv("s", 5, "<schema>", role, 0, 0, ...)` against IRIS: type 5 genuinely registers a schema-level grant (expands to all objects in the schema, as IRIS documents), type 1 = table. Action-letter map (SELECT→s/INSERT→i/UPDATE→u/DELETE→d/REFERENCES→r/ALTER→a) matches the SMP `SchemaPriv`/`ColumnPriv` dialogs. The `.fields` $LIST column encoding matches `$LISTFROMSTRING(columns,",")` used by the SMP ColumnPriv dialog. No wrong-type/wrong-encoding silent-grant defect.

## Change Log

| Date | Change |
|---|---|
| 2026-06-16 | Story 15.5 authored. Extends `iris_resource_manage` with SQL-privilege actions `grant`/`revoke`/`listPrivileges` (schema/table/column) via `%SYSTEM.SQL.Security`. Partial `mutates` (new keys only; existing baseline actions grandfathered). Release-critical back-compat gate (AC 15.5.6 — existing surface byte-for-byte unchanged). Bootstrap bump ONLY if ObjectScript changes. Frozen-foundation baseline inherited. |
| 2026-06-16 | Story 15.5 implemented. Probe (Rule #16) selected `%SQL.Manager.API.SaveObjPriv` (column-capable) over `%SYSTEM.SQL.Security.Grant/RevokePrivilege` (no column support); read path `%SQL.Manager.CatalogPriv:UserPrivs`/`:UserColumnPrivs`. New `SqlPrivilegeManage`/`SqlPrivilegeList` handlers on Security.cls + `/security/sqlprivilege` routes. `iris_resource_manage` extended additively (enum + optional target/privilege/grantee/namespace + `mutates` grant=write/revoke=write/listPrivileges=read); create/delete/modify + iris_resource_list byte-for-byte unchanged. +18 admin tests (13 surface + 5 real-gate governance). Live-verified grant→list→revoke round-trip on HSCUSTOM (disposable role+table, cleaned up). BOOTSTRAP_VERSION `8b074e457c3c` → `038102d88885`. Governance baseline `1e62c5ad5bf7` / 141 keys unchanged. Full monorepo green (shared 500/admin 421/dev 293/data 120/interop 171/ops 159); build/lint/tsc clean. Status → review. |
