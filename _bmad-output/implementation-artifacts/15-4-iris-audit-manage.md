# Story 15.4: `iris_audit_manage` — Audit Configuration & Log

Status: done

## Story

As an administrator,
I want to configure auditing and manage the audit log via the agent,
so that I can run compliance operations — with destructive/mutating actions safely opt-in under governance.

## Context

Fourth Epic 15 admin tool — the broadest (7 actions across two IRIS subsystems). Follows the proven Story 15.1/15.2/15.3 pattern. Cross-cutting decisions in force (unchanged): **frozen-foundation governance baseline** (hash `1e62c5ad5bf7`, 141 keys; new keys NOT added) and **bootstrap regen per ObjectScript story** (`pnpm run gen:bootstrap`, Rule #18; `BOOTSTRAP_VERSION` current `dc6e10143476`).

Distinguish **instance audit** (`%SYS.Audit` + `Security.Events` event config) — this story — from the **Ensemble event/message log** (already covered by `iris_production_logs`). This tool COMPLEMENTS the existing read-only `iris_audit_events` (in `@iris-mcp/ops` — `iris-ops-mcp/src/tools/system.ts`); note the relationship in the tool description (AC 15.4.2).

## Acceptance Criteria

1. **AC 15.4.1 — Tool surface.** Tool `iris_audit_manage` in `@iris-mcp/admin`; single multi-action tool; `action: z.enum(["status","enable","disable","configureEvent","view","purge","export"])`. `annotations.readOnlyHint:false`, `annotations.destructiveHint:true` (the tool includes the destructive `purge`). No `server` field (D2). Registered in `index.ts`.

2. **AC 15.4.2 — Governance classification.** `mutates: { status:"read", view:"read", enable:"write", disable:"write", configureEvent:"write", purge:"write", export:"write" }` (all 7 classified — Story 15.0 strict contract; `status`/`view` read, the rest write). Under empty `IRIS_GOVERNANCE`: `enable`/`disable`/`configureEvent`/`purge`/`export` **disabled**, `status`/`view` **enabled** — proven through the real `McpServerBase.handleToolCall` gate. Tool description notes the relationship to the read-only `iris_audit_events`.

3. **AC 15.4.3 — ObjectScript handler + API mapping (Rule #2/#16 probe).** New methods (e.g. `AuditStatus`/`AuditManage`) on `ExecuteMCPv2.REST.Security` (or a new adjacent class), backed by:
   - `status` → instance audit on/off + event-config summary (`Security.Events:List` ROWSPEC: Source/Type/Name/Description/Enabled/Total/Written/Lost).
   - `configureEvent` → `Security.Events.Modify(Source,Type,Name,.props)` (enable/disable a specific audit event).
   - `view` → `%SYS.Audit` `ListExecute`/`ListFetch`/`ListClose` (filters: begin/end datetime, event source/type, username, + a max-rows cap).
   - `export` → `%SYS.Audit.Export(FileName,.NumExported,Flags,...)` (server-side file; return the path + count).
   - `enable`/`disable` (instance auditing) and `purge` → **PROBE the exact API (Rule #16):** likely `$SYSTEM.Security.Audit` / `%SYS.Audit` start/stop + a purge/clean method. If a clean purge API does NOT exist, scope `purge` to what IS supported (e.g. `Copy`-to-archive-then-clean, or date-bounded delete) and DOCUMENT the mechanism; do NOT fabricate. If `enable`/`disable` instance auditing has no safe programmatic API, scope down + document.
   Namespace save/restore (NEVER `New $NAMESPACE`; catch restores NS first). `/security/audit` GET (status/view) + POST (the rest) routes in `Dispatch.cls`.

4. **AC 15.4.4 — I/O contract.** Input: `action`, filter/config params (`source`,`type`,`name`,`enabled` for configureEvent; `begin`,`end`,`user`,`event`,`maxRows` for view; `fileName`/filters for export; bounds for purge), `server` (framework-injected), `namespace`. Output: audit status / events / configure result / purge count / export {path,count}.

5. **AC 15.4.5 — `purge`/`export` safety.** `purge` is destructive — require an explicit confirmation parameter or clear bounded scope, and return the count purged; never purge silently. `export` writes a server-side file — return the location; ensure the path is controlled (no arbitrary path traversal from caller input). `view` supports filtering (event, user, time, max rows) with a sane default cap.

6. **AC 15.4.6 — Errors (Rule #9).** `SanitizeError` preserves `%Status` text. No secret/PII leakage beyond what the audit log itself contains.

7. **AC 15.4.7 — Tests.** `@iris-mcp/admin` unit tests for each action (mocked HTTP) + the governance-default-disabled real-gate test (writes denied, status/view enabled; default suite). `view` filter mapping; `purge` confirmation-required; `export` path+count.

8. **AC 15.4.8 — Back-compat + bootstrap.** Governance hash `1e62c5ad5bf7` / 141 keys unchanged (audit keys NOT in baseline); the existing `iris_audit_events` tool is UNCHANGED (this is additive); `bootstrap-classes.ts` regenerated; record `BOOTSTRAP_VERSION` from→to; full monorepo build/test/lint green; `tsc` strict clean.

9. **AC 15.4.9 — Live verification.** Deploy `Security.cls` (or new class) to HSCUSTOM (`iris_doc_load` glob, Rule #17), compile; live `status` returns the audit on/off + event summary; `view` returns recent audit records (with a small maxRows). NO destructive `purge`/`disable` against the live instance during smoke (or only on a clearly-safe, reversible scope); `export` to a temp path then clean up.

## Tasks / Subtasks

- [x] **Task 1 — Probe (Rule #2/#16):** read `irissys/Security/Events.cls` + `irislib/%SYS/Audit.cls` + `irislib/%SYSTEM/Security.cls`. Resolve the exact `enable`/`disable`/`purge` APIs; resolve `view` query usage; resolve `export` signature. Record findings + any scope-downs.
- [x] **Task 2 — TypeScript tool** — mirror prior admin tools; 7-action enum + `mutates`; register in `index.ts`; tool description notes the `iris_audit_events` relationship + the `purge` destructiveness.
- [x] **Task 3 — ObjectScript handler** — `AuditStatus`/`AuditManage`; `/security/audit` GET+POST; namespace save/restore; `SanitizeError`; purge confirmation + export path control.
- [x] **Task 4 — Tests** — per-action + real-gate governance + purge-confirmation + view-filter.
- [x] **Task 5 — Deploy + live-verify** (status/view; no destructive ops on live).
- [x] **Task 6 — Bootstrap regen + back-compat proof** (existing `iris_audit_events` untouched; hash `1e62c5ad5bf7`; record BOOTSTRAP_VERSION from→to; suite green).

## Review Findings (code review 2026-06-16)

- [x] [Review][Patch] HIGH — purge wildcard-only bypass → full unbounded audit-log wipe; fixed in BOTH layers (`"*"` no longer counts as a bound) + regression test [src/ExecuteMCPv2/REST/Security.cls:AuditManage; packages/iris-admin-mcp/src/tools/audit.ts; audit-coverage.test.ts]
- [x] [Review][Patch] MEDIUM/LOW — export path containment hardened with a post-NormalizeFilename prefix re-check [src/ExecuteMCPv2/REST/Security.cls:AuditManage]
- [x] [Review][Defer] export has no scope requirement (full-log export) — DISMISSED, intentional (path-controlled, non-destructive) [deferred-work.md CR 15.4-3]
- [x] [Review][Defer] export overwrites same-named file silently [deferred-work.md CR 15.4-4]
- [x] [Review][Defer] export accepts Windows reserved device names / trailing dot-space [deferred-work.md CR 15.4-5]
- [x] [Review][Defer] view client-side pagination over server-capped result; count is page-length (suite-wide pattern) [deferred-work.md CR 15.4-6]
- [x] [Review][Defer] enable/disable echo requested value without re-reading AuditEnabled [deferred-work.md CR 15.4-7]
- [x] [Review][Defer] AuditStatus reuses tRS for two result sets; mid-iteration close-in-catch (pre-existing pattern) [deferred-work.md CR 15.4-8]

Full monorepo green after fixes: shared 500, admin 401, dev 293, data 120, interop 171, ops 159; build / lint / tsc exit 0. Governance hash `1e62c5ad5bf7` unchanged. `BOOTSTRAP_VERSION e353c54c5547 → 8b074e457c3c`.

## Dev Agent Record

### Probe findings (Task 1, Rule #2/#16) — ALL actions backed by public APIs, NO scope-downs

| Action | IRIS API (in `%SYS`) | Notes |
|---|---|---|
| status (on/off) | `Security.System.Get($$$SystemSecurityName, .props)` → `props("AuditEnabled")` | `AuditEnabled` is a `BooleanYN` (1/0 logical, "Yes"/"No" display) — handler coerces. |
| status (event summary) | `Security.Events:List` named query (public, `SqlProc`) | ROWSPEC `Source,Type,Name,Description,Enabled,Total,Written,Lost` — exactly as Dev Notes. |
| enable / disable | `Security.System.Modify($$$SystemSecurityName, .props)` with `props("AuditEnabled")=1/0` | `Stop()` on `%SYS.Audit` is `[Internal]`; the correct, supported instance toggle is the `AuditEnabled` system property. No scope-down. |
| configureEvent | `Security.Events.Modify(Source, Type, Name, .props)` with `props("Enabled")=1/0` | Public; matches Dev Notes. |
| view | `%SYS.Audit:List` named query (public — same query the read-only `iris_audit_events` uses) | Execute params: Begin, End, EventSources, EventTypes, Events, Usernames. `ListExecute/Fetch/Close` are `[Internal]`, so the public `%ResultSet … :List` cursor is used (not the raw query methods). |
| purge | `%SYS.Audit.Delete(.NumDeleted, Begin, End, EventSources, EventTypes, Events, Usernames, SystemIDs)` (public) | Requires `%Admin_Secure:Use`; writes its own audit records bracketing the delete; returns count. This is the safe BOUNDED purge. NOT `Erase()` (full-wipe, the unbounded path) — deliberately not exposed. No scope-down. |
| export | `%SYS.Audit.Export(FileName, .NumExported, Flags, Begin, End, EventSources, EventTypes, Events, Usernames)` (public) | Returns count; handler returns the resolved server-side path. |

Notably `%SYSTEM.Security.Audit(...)` is an ABSTRACT audit-write hook, NOT the enable/disable API — the real enable/disable lives on `Security.System.AuditEnabled` (probe corrected this before coding).

### Completion notes

- **TypeScript** (`packages/iris-admin-mcp/src/tools/audit.ts`): single `iris_audit_manage` tool, 7-action enum, `mutates` all-7 (`status`/`view` read; `enable`/`disable`/`configureEvent`/`purge`/`export` write), `annotations.destructiveHint:true`, no `server` field (D2), `scope:"SYS"`. `status`/`view` are GET; the 5 writes are POST. Guards: `configureEvent` requires source+type+name+enabled (and honors `enabled:false`); `purge` requires `confirm:true` AND ≥1 bound; `export` requires a bare `fileName` and rejects path separators / `..`. Description notes the `iris_audit_events` relationship + purge destructiveness. Registered in `index.ts`.
- **ObjectScript** (`src/ExecuteMCPv2/REST/Security.cls`): `AuditStatus()` (GET — `?action=status|view`) and `AuditManage()` (POST — enable/disable/configureEvent/purge/export). Namespace save/restore via `Set tOrigNS=$NAMESPACE` (NEVER `New $NAMESPACE`); catch restores NS first; `SanitizeError` (Rule #9) on all error paths. Server-side purge confirmation + bounded-scope re-validation (defense in depth — a direct REST caller bypasses the TS guard). Export path control: caller passes a bare name; server rejects `/ \ .. :` and writes into `<ManagerDirectory>/auditexport/`, returning the resolved location. Routes added to `Dispatch.cls`.
- **Live verification (HSCUSTOM)** via a disposable `ExecuteMCPv2.Temp.AuditProbe` (deleted after): `status` → `auditEnabled=1`, 75 events from `Security.Events:List`; `view` → 5 recent records from `%SYS.Audit:List`. No destructive ops run against live.
- **Back-compat:** governance baseline hash unchanged `1e62c5ad5bf7` / 141 keys (0 `iris_audit_manage` keys in baseline — frozen-foundation honored). Existing `iris_audit_events` (ops) untouched — ops suite 159 pass. `BOOTSTRAP_VERSION dc6e10143476 → e353c54c5547` (dev) → `8b074e457c3c` (code-review fix, below).

### Code-review fixes (2026-06-16)

- **HIGH — purge wildcard-only bypass (AC 15.4.5).** The bounded-scope gate counted any NON-EMPTY filter as a bound, so a `"*"` (match-all) value satisfied it. A direct REST caller (or the TS layer) passing `{action:"purge", confirm:true, source:"*"}` — with empty begin/end and the other filters defaulting to `"*"` — produced `%SYS.Audit.Delete(.n,"","","*","*","*","*")`, i.e. a FULL unbounded wipe of the audit log, exactly the outcome AC 15.4.5 requires to be impossible. Fixed in BOTH layers (defense in depth): `Security.cls` `AuditManage` purge gate and `audit.ts` `hasBound` now treat `"*"` as NOT a bound (begin/end still count when non-empty). Regression test added (`audit-coverage.test.ts` — wildcard-only purge rejected, never hits the wire).
- **MEDIUM/LOW — export containment hardening (AC 15.4.5).** Added a post-`NormalizeFilename` containment re-check in `Security.cls` `AuditManage` export branch: the resolved `tFullPath` must still begin with the fixed `auditexport` directory, so confinement no longer rests solely on the character blacklist.
- Redeployed `Security.cls` to HSCUSTOM (compiled clean), regenerated bootstrap (`e353c54c5547 → 8b074e457c3c`). Full monorepo green: admin 401, shared 500, ops 159; build / lint / tsc all exit 0; governance baseline hash `1e62c5ad5bf7` unchanged.
- **Suites:** admin 372 (audit.test.ts 22 + audit-governance.test.ts 7 + index 25→26), shared 500, dev 293, data 120, interop 171, ops 159. Build / lint / typecheck all exit 0.

## File List

- `packages/iris-admin-mcp/src/tools/audit.ts` (new)
- `packages/iris-admin-mcp/src/tools/index.ts` (modified — register `auditManageTool`)
- `packages/iris-admin-mcp/src/__tests__/audit.test.ts` (new)
- `packages/iris-admin-mcp/src/__tests__/audit-governance.test.ts` (new)
- `packages/iris-admin-mcp/src/__tests__/index.test.ts` (modified — tool count 25→26 + name assertion)
- `src/ExecuteMCPv2/REST/Security.cls` (modified — `AuditStatus` + `AuditManage` handlers)
- `src/ExecuteMCPv2/REST/Dispatch.cls` (modified — `/security/audit` GET+POST routes)
- `packages/shared/src/bootstrap-classes.ts` (regenerated — `dc6e10143476 → e353c54c5547` dev; → `8b074e457c3c` after CR fix)
- `packages/iris-admin-mcp/src/__tests__/audit-coverage.test.ts` (modified — CR regression: wildcard-only purge rejected)

## Dev Notes

- **`Security.Events` (from `irissys/Security/Events.cls`):** `Get(Source,Type,Name,.props)`, `Modify(Source,Type,Name,.props)`, `List(...)` ROWSPEC `Source,Type,Name,Description,Enabled,Total,Written,Lost`. Use `Modify` for `configureEvent`; `List` for `status` event summary.
- **`%SYS.Audit` (from `irislib/%SYS/Audit.cls`):** `Export(FileName,.NumExported,Flags,Begin,End,EventSources,EventTypes,Events,Usernames,SystemIDs)`, `Copy(...)`, `ListExecute`/`ListFetch`/`ListClose` (Internal custom query — use for `view` with filters). PROBE for the purge + instance enable/disable methods (Rule #16) — `Stop()` is Internal; the enable/disable + purge entry points may be on `%SYS.Audit` or `$SYSTEM.Security.Audit`; confirm before coding.
- **Patterns to copy:** prior admin tools (`service.ts`/`ldap.ts`/`x509.ts`), `Security.cls` handler methods, `Dispatch.cls` routes, the real-gate governance test harness.
- **`purge` is the riskiest action** — gate it behind an explicit confirm param + bounded scope; return the count; smoke must NOT purge live data.
- **Bootstrap:** `iris_doc_load path="c:/git/iris-execute-mcp-v2/src/**/Security.cls" compile=true namespace=HSCUSTOM`; then `pnpm run gen:bootstrap`.

## Change Log

| Date | Change |
|---|---|
| 2026-06-16 | Story 15.4 authored. `iris_audit_manage` (status/enable/disable/configureEvent/view/purge/export); per-action `mutates` (status/view read, rest write); `destructiveHint:true` (purge); `Security.Events` + `%SYS.Audit` handler + `/security/audit` route; enable/disable/purge APIs TBD via live probe (Rule #16); purge confirmation + export path control. Complements read-only `iris_audit_events`. Frozen-foundation + bootstrap-regen inherited. |
| 2026-06-16 | Story 15.4 implemented (dev). Probe resolved all 7 actions to public IRIS APIs with NO scope-downs: enable/disable → `Security.System.AuditEnabled` (not `%SYS.Audit.Stop` which is Internal); purge → bounded `%SYS.Audit.Delete` (not `Erase`); view → `%SYS.Audit:List`; export → `%SYS.Audit.Export`; configureEvent → `Security.Events.Modify`; status → `Security.System.Get` + `Security.Events:List`. TS tool `audit.ts` (7-action enum, all-7 mutates, destructiveHint, no `server`) + `index.ts`. ObjectScript `AuditStatus`/`AuditManage` on `Security.cls` + `/security/audit` GET+POST in `Dispatch.cls` (NS save/restore, SanitizeError, server-side purge-confirm + bounded-scope + export path control). Tests: audit.test.ts 22 + audit-governance.test.ts 7 (real-gate, all 5 writes denied / status+view allowed under empty IRIS_GOVERNANCE) + index 25→26. Live-verified status (auditEnabled=1, 75 events) + view (5 records) on HSCUSTOM; no destructive ops. Back-compat: baseline hash `1e62c5ad5bf7`/141 keys unchanged, `iris_audit_events` untouched (ops 159 pass). BOOTSTRAP_VERSION `dc6e10143476 → e353c54c5547`. Full suite/build/lint/tsc green. Status → review. |
