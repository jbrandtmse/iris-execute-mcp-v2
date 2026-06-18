# Story 15.2: `iris_ldap_manage` — LDAP Configurations

Status: done

## Story

As an administrator,
I want to manage and test LDAP configurations via the agent,
so that I can configure delegated authentication — with the mutating actions safely opt-in under governance.

## Context

Second Epic 15 admin tool. Follows the pattern established and proven in **Story 15.1** (`iris_service_manage`, commit `5d59d83`): a single multi-action `@iris-mcp/admin` tool + a `%SYS` ObjectScript REST handler + per-action `mutates` governance + a Dispatch route, with the two cross-cutting decisions already in force:
- **Frozen-foundation governance baseline** (AC 15.1.7): `GOVERNANCE_BASELINE` stays the immutable Epic-14 141-key snapshot (hash `1e62c5ad5bf7`). This tool's new keys are NOT added to it; they default-disable (writes) / default-enable (reads) via `mutates` + `defaultSeed`. No drift-test change is needed (15.1 already made it one-directional).
- **Bootstrap regen per ObjectScript story** (AC 15.1.8 Option A): editing the bootstrapped `Security.cls`/`Dispatch.cls` requires `pnpm run gen:bootstrap` (Rule #18); `BOOTSTRAP_VERSION` moves to the new content hash (current: `d0cf367c3cfc`). Record from→to. Story 15.6 does the final consolidation.

## Acceptance Criteria

1. **AC 15.2.1 — Tool surface.** Tool `iris_ldap_manage` in `@iris-mcp/admin`; single multi-action tool; `action: z.enum(["list","get","create","modify","delete","test"])`. `annotations.readOnlyHint:false` (can mutate). No `server` field (framework-injected — D2). Registered in `packages/iris-admin-mcp/src/tools/index.ts`.

2. **AC 15.2.2 — Governance classification.** `mutates: { list:"read", get:"read", test:"read", create:"write", modify:"write", delete:"write" }` (ALL six action keys classified, per Story 15.0's strict contract). `test` is a connection/validity check that does NOT mutate IRIS config → classified `read` (available by default for diagnostics). Under empty `IRIS_GOVERNANCE`: `create`/`modify`/`delete` resolve **disabled**; `list`/`get`/`test` **enabled**. A real-gate test (through `McpServerBase.handleToolCall`) asserts a disabled write is denied (`GOVERNANCE_DISABLED`, handler not invoked) and an explicit enable flips it.

3. **AC 15.2.3 — ObjectScript handler.** New methods (e.g. `LdapList` + `LdapManage`) on `ExecuteMCPv2.REST.Security`, backed by `%SYS` `Security.LDAPConfigs` (`List` query, `Get(name,.props)`, `Create(name,.props)`, `Modify(name,.props)`, `Delete(name)` — verify exact signatures against `irissys/Security/LDAPConfigs.cls` per Rule #2 before coding). Namespace save/restore (`Set tOrigNS=$NAMESPACE`/`Set $NAMESPACE="%SYS"`/restore — NEVER `New $NAMESPACE`; catch restores NS first line). `/security/ldap` GET+POST routes in `Dispatch.cls`.

4. **AC 15.2.4 — Bind-password redaction (Rule #9).** `LDAPSearchPassword` (`Security.Datatype.Password`) and any other secret material is NEVER returned in `get`/`list` output — redact to `"***"` or omit. Apply the length-gated redaction guidance so a short password value can't corrupt unrelated output. Avoid `[Deprecated, Internal]` props (e.g. `LDAPDomainName`) per Rule #4.

5. **AC 15.2.5 — `test` action scope (Rule #16 live probe).** Confirm via live probe whether `Security.LDAPConfigs` (or `%SYS.LDAP`) exposes a connection-test API. If yes, `test` exercises it and returns a structured pass/fail. If NO test-connection API exists, **scope `test` down** to a config-validity check (config exists + required fields present + reachable host syntactically valid) and note the scope-down in the Dev Notes + tool description. Do NOT fabricate a connection where the API doesn't support it.

6. **AC 15.2.6 — I/O contract.** Input: `action`, `name`, `settings` (object — config fields for create/modify), `server` (framework-injected), `namespace`. Output: config list / single config (password-redacted) / create-modify-delete structured result / test result. `{ content:[text], structuredContent }`.

7. **AC 15.2.7 — Errors (Rule #9).** `SanitizeError` preserves the `%Status` text (e.g. "config does not exist") — no generic replacement.

8. **AC 15.2.8 — Tests (AC 15.2.5 epics).** `@iris-mcp/admin` unit tests for each action (mocked HTTP) incl. password-redaction assertion + the governance-default-disabled real-gate test (default suite). Round-trip create→get(redacted)→modify→delete (mocked).

9. **AC 15.2.9 — Back-compat + bootstrap (Rules #18/#19).** Governance hash stays `1e62c5ad5bf7`, 141 foundation keys; new LDAP keys NOT in baseline. `bootstrap-classes.ts` regenerated; record `BOOTSTRAP_VERSION` from→to. Full monorepo build/test/lint green; `tsc` strict clean.

10. **AC 15.2.10 — Live verification.** Deploy `Security.cls` to HSCUSTOM via `iris_doc_load` (glob path, Rule #17), compile, live `list` returns configs (or an empty list if none configured — that's valid) and `get` on a known config (or a graceful "not found" if none exist). Capture as smoke evidence. No destructive create/delete against live unless on a clearly-disposable test config that is then removed.

## Tasks / Subtasks

- [x] **Task 1 — Read `irissys/Security/LDAPConfigs.cls`** (Rule #2): List ROWSPEC, CRUD signatures, password field(s), test-connection API existence (Rule #16). Resolve AC 15.2.5 scope.
- [x] **Task 2 — TypeScript tool** — mirror `packages/iris-admin-mcp/src/tools/service.ts`; six-action enum + `mutates` record; password redaction in output mapping; register in `index.ts`.
- [x] **Task 3 — ObjectScript handler** — `LdapList`/`LdapManage` on `Security.cls`; `/security/ldap` routes in `Dispatch.cls`; namespace save/restore; `SanitizeError`; password redaction server-side too (defense in depth).
- [x] **Task 4 — Tests** — per-action + redaction + real-gate governance.
- [x] **Task 5 — Deploy + live-verify** (Rule #17).
- [x] **Task 6 — Bootstrap regen + back-compat proof** (`gen:bootstrap`; hash `1e62c5ad5bf7` unchanged; record BOOTSTRAP_VERSION from→to; full suite green).

## Review Findings

Code review 2026-06-16 (parallel adversarial lenses: Blind Hunter, Edge Case Hunter, Acceptance Auditor — applied directly to the 355-line tracked diff + 4 new test files, all read in full). **No HIGH or MEDIUM findings; nothing patched. Story passes.**

Security-critical AC 15.2.4 (bind-password redaction) independently verified at the redaction authority (ObjectScript server): `LDAPSearchPassword` is never read into any output buffer — `BuildLdapEntry` omits it, the `List` ROWSPEC has no password column, success envelopes carry only `{action,name,success}`, and error paths route `%Status` through `SanitizeError` (IRIS `LDAPConfigs` %Status carries no password). CRUD signatures + `List` ROWSPEC verified against `irissys/Security/LDAPConfigs.cls` (Rule #2). `LDAPDomainName` `[Deprecated, Internal]` avoided (Rule #4). Namespace save/restore correct on all paths incl. catch-first-line (Rule #3); no `New $NAMESPACE`. `test` is an honest non-mutating config-validity check (no fabricated bind — Rule #16). Governance: 6 keys classified, none in frozen baseline (hash `1e62c5ad5bf7`/141 — green), writes default-disabled / reads default-enabled through the real `McpServerBase.handleToolCall` gate with per-action granularity. Bootstrap regen idempotent → `BOOTSTRAP_VERSION` `80487cda8d82` confirmed. Full monorepo green: build 6/6, type-check 12/12, lint 0, tests (shared 500, admin 300, dev 293, interop 171, data 120, ops 159).

- [x] [Review][Defer] `BuildLdapValidity` flags blank `LDAPHostNames` as invalid though it is not a `[Required]` prop (blank = default domain LDAP server on Windows) [src/ExecuteMCPv2/REST/Security.cls:BuildLdapValidity] — deferred (LOW, heuristic non-authoritative check), see deferred-work.md CR 15.2-1
- [x] [Review][Defer] `LdapList` does not `tRS.Close()` on the in-loop exception path [src/ExecuteMCPv2/REST/Security.cls:LdapList] — deferred, pre-existing (same class as CR 15.1-1; codebase-wide hardening pass)
- [x] [Review][Defer] `test` re-`Get`s the config via a separate round-trip; combined config+validity needs two calls [packages/iris-admin-mcp/src/tools/ldap.ts] — deferred (LOW, cosmetic/ergonomic), see deferred-work.md CR 15.2-3

## Dev Notes

- **`Security.LDAPConfigs` (from `irissys/Security/LDAPConfigs.cls`):** key props include `Description`, `LDAPBaseDN` (Required), `LDAPBaseDNForGroups` (Required), `LDAPFlags` (Security.Datatype.LDAPFlags — bit flags incl. enabled/AD/groups/kerberos), `LDAPHostNames`, `LDAPSearchPassword` (**REDACT** — Security.Datatype.Password), `LDAPClientTimeout`. AVOID `LDAPDomainName` (`[Deprecated, Internal]` — Rule #4). Verify the `List` query ROWSPEC + `Create`/`Modify`/`Delete`/`Exists` signatures against source before coding (Rule #2). `Create` likely needs the required fields; surface a clear error if missing.
- **`test`:** the impl note flags uncertainty — probe for a connection-test classmethod (Rule #16). If absent, validity-check scope-down (documented), classified `read`.
- **Established patterns to copy from Story 15.1:** `service.ts` (tool shape, `mutates` record, `ctx.paginate`/`ctx.http`, structuredContent), `Security.cls` `ServiceList`/`ServiceManage` (namespace save/restore, `%ResultSet`/`Get`/`Modify`, `SanitizeError`), `Dispatch.cls` `/security/service` routes, and the `service-governance.test.ts` real-gate harness.
- **Redaction (Rule #9):** mirror the existing user/SSL password-handling in `Security.cls` if present; never echo `LDAPSearchPassword`. Use a minimum-length gate on any `$Replace`-style redaction so a 1-char password can't corrupt the payload.
- **Bootstrap:** `iris_doc_load path="c:/git/iris-execute-mcp-v2/src/**/Security.cls" compile=true namespace=HSCUSTOM`; then `pnpm run gen:bootstrap`; do NOT hand-edit `bootstrap-classes.ts`.

## Dev Agent Record

### Task 1 findings (Rule #2 / Rule #16) — `irissys/Security/LDAPConfigs.cls`

- **`List` query ROWSPEC** (narrow, password-free, safe to surface): `Name:%String, LDAP Enabled:%String, Description:%String, LDAPCACertFile:%String`.
- **CRUD signatures** (all confirmed against source): `Create(Name, ByRef Properties)`, `Modify(Name, ByRef Properties)`, `Delete(Name)`, `Get(Name, ByRef Properties)`, `Exists(Name, ByRef LDAP, ByRef Status)`.
- **Password field:** `LDAPSearchPassword` (`Security.Datatype.Password`). **Live probe (`workgroup.com`) confirmed `Get()` DOES populate `Properties("LDAPSearchPassword")` with a 3-char stored value** — so redaction is mandatory and was implemented by OMITTING the key from the mapping entirely (`BuildLdapEntry`), never reading it. Verified live: `get` response carries no `ldapSearchPassword` key.
- **Avoided** `LDAPDomainName` (`[Deprecated, Internal]` — Rule #4).
- **AC 15.2.5 resolution — `test` scope-down (Rule #16):** probed both `Security.LDAPConfigs` and `irislib/%SYS/LDAP.cls`. **No high-level connection-test class method exists** — `%SYS.LDAP` exposes only low-level primitives (`Init`, `Connect`, `Binds`/`SimpleBinds`, `SearchExts`). Building a real bind would require orchestrating those against a live server with the encrypted search password (`Get`/`Set` are `[Internal]`). Per AC 15.2.5 ("do NOT fabricate a connection"), `test` is scoped DOWN to a **non-mutating config-validity check**: config exists + required fields (`LDAPBaseDN`, `LDAPBaseDNForGroups`, `LDAPSearchUsername`, `LDAPHostNames`) present + host port syntactically numeric. Classified `read`. Documented in the tool description and the `test` response (`checkType:"config-validity"`, `note:…`).

### Completion Notes

- **Tool** `iris_ldap_manage` added (`packages/iris-admin-mcp/src/tools/ldap.ts`), registered in `index.ts`; six-action enum `["list","get","create","modify","delete","test"]`, `annotations.readOnlyHint:false`, no `server` field (framework-injected D2). `mutates: { list:read, get:read, test:read, create:write, modify:write, delete:write }`.
- **ObjectScript handler** `LdapList`/`LdapManage` (+ `BuildLdapEntry`/`BuildLdapValidity` Internal helpers) on `ExecuteMCPv2.REST.Security`; namespace save/restore (never `New $NAMESPACE`; catch restores NS first); `SanitizeError` on every error path. `/security/ldap` GET+POST routes added to `Dispatch.cls`.
- **Redaction (AC 15.2.4):** password never surfaced (server-side omission in `BuildLdapEntry` + write-only accept in `LdapManage` + no echo on success). The list ROWSPEC has no password column. No `$Replace`-style redaction was needed (the value is never placed into any output buffer), so the length-gate concern does not arise.
- **Governance real-gate test (AC 15.2.2):** `ldap-governance.test.ts` (4 tests) through `McpServerBase.handleToolCall` — `create`/`modify`/`delete` denied (`GOVERNANCE_DISABLED`, handler not invoked) under empty `IRIS_GOVERNANCE`; `list`/`get`/`test` allowed; explicit enable of `create` flips just that key (`delete` stays denied).
- **Unit tests (AC 15.2.8):** `ldap.test.ts` (20 tests) — per-action mocked-HTTP, password-redaction assertions, round-trip create→get(redacted)→modify→delete, no-op/missing-name guards, error-text preservation, metadata.
- **Live verification (AC 15.2.10):** deployed to HSCUSTOM, compiled clean. `list` → `[{name:"workgroup.com",…}]`; `get` → full config WITHOUT password key; `test` → `valid:true, checkType:"config-validity"`; `get NoSuchConfig` → real IRIS error text preserved ("LDAP Configuration NoSuchConfig does not exist"). No destructive create/delete on the live config.
- **Back-compat + bootstrap (AC 15.2.9):** governance baseline hash unchanged `1e62c5ad5bf7`; new LDAP keys NOT in baseline (write keys default-disabled via `mutates`). `bootstrap-classes.ts` regenerated via `pnpm run gen:bootstrap` (Rule #18 — not hand-edited). **`BOOTSTRAP_VERSION`: `d0cf367c3cfc` → `80487cda8d82`.** Full monorepo build/test/lint/type-check green (admin 279, shared 500, dev 293; lint 6/6; tsc strict 12/12).
- Disposable probe class `ExecuteMCPv2.Temp.LdapProbe` created for Task 1 investigation and removed from both IRIS and disk before completion.

### File List

- `packages/iris-admin-mcp/src/tools/ldap.ts` (new)
- `packages/iris-admin-mcp/src/tools/index.ts` (modified — import + register `ldapManageTool`)
- `packages/iris-admin-mcp/src/__tests__/ldap.test.ts` (new)
- `packages/iris-admin-mcp/src/__tests__/ldap-governance.test.ts` (new)
- `packages/iris-admin-mcp/src/__tests__/index.test.ts` (modified — 23→24 counts + `iris_ldap_manage` name assertion)
- `src/ExecuteMCPv2/REST/Security.cls` (modified — `LdapList`, `LdapManage`, `BuildLdapEntry`, `BuildLdapValidity`)
- `src/ExecuteMCPv2/REST/Dispatch.cls` (modified — `/security/ldap` GET+POST routes)
- `packages/shared/src/bootstrap-classes.ts` (regenerated — `BOOTSTRAP_VERSION` `d0cf367c3cfc` → `80487cda8d82`)

## Change Log

| Date | Change |
|---|---|
| 2026-06-16 | Story 15.2 authored. `iris_ldap_manage` (list/get/create/modify/delete/test); per-action `mutates` (writes default-disabled, test=read); `Security.LDAPConfigs` `%SYS` handler + `/security/ldap` route; bind-password redaction (Rule #9, AC 15.2.4); `test` scope TBD via live probe (Rule #16). Frozen-foundation baseline + bootstrap-regen patterns inherited from Story 15.1. |
| 2026-06-16 | Story 15.2 implemented. `test` scoped to non-mutating config-validity check (no high-level LDAP connection-test API exists — Rule #16). `LDAPSearchPassword` redacted by omission (live-confirmed `Get()` populates it). All 6 ACs' tests green: ldap.test.ts (20) + ldap-governance.test.ts real-gate (4) + index.test.ts (23→24). Live-verified list/get/test on HSCUSTOM. `BOOTSTRAP_VERSION` d0cf367c3cfc → 80487cda8d82; governance baseline hash unchanged 1e62c5ad5bf7. Full suite green. |
