# Story 15.6: BOOTSTRAP Bump + Live Verification + Documentation Rollup

Status: done

## Story

As the project lead,
I want the Epic-15 ObjectScript bootstrap finalized/verified, every new tool live-verified, and all docs + tool counts rolled up,
so that Epic 15 ships consistent, deployable, and accurately documented.

## Context

Final Epic 15 story — consolidation + docs (mirrors Story 14.6 / 13.2). Epic 15 added **4 new `@iris-mcp/admin` tools** (`iris_service_manage`, `iris_ldap_manage`, `iris_x509_manage`, `iris_audit_manage`) and **extended** `iris_resource_manage` with SQL-privilege actions. Suite tool count: **89 → 93** (admin 22 → 26; resource_manage extension adds no tool).

**Bootstrap (Option A reinterpretation):** under the per-story regen policy established in Story 15.1, `bootstrap-classes.ts` was regenerated after EVERY Epic-15 ObjectScript change; it is already current at `BOOTSTRAP_VERSION` `e5f4f6d88c56` (covers all Epic-15 ObjectScript through Story 15.5). So AC 15.6.1's "single bump" is realized as the **final consolidated state** — this story VERIFIES `gen:bootstrap` is idempotent (re-run produces no change) and that the embedded classes match on-disk, rather than introducing a fresh bump.

**⚠️ Frozen-foundation footgun (do NOT trip):** do NOT run `pnpm run gen:governance-baseline` / `node scripts/gen-governance-baseline.mjs` — under the Story 15.1 frozen-foundation model that generator REGROWS the baseline to include Epic-15 keys, which must NOT happen. `GOVERNANCE_BASELINE` stays the frozen 141-key Epic-14 snapshot (hash `1e62c5ad5bf7`); the new tools are governed via `mutates` + `defaultSeed`, not baseline membership. (A `--check`/no-write mode for this generator is a deferred hardening item — see deferred-work.md.)

## Acceptance Criteria

1. **AC 15.6.1 — Bootstrap finalized + verified.** Confirm `bootstrap-classes.ts` is current and covers ALL Epic-15 ObjectScript (the `Security.cls` Service/Ldap/X509/Audit/SqlPrivilege handlers + the `Dispatch.cls` routes). Run `pnpm turbo run build && pnpm run gen:bootstrap` and confirm it is **idempotent** (no diff; `BOOTSTRAP_VERSION` stays `e5f4f6d88c56`). The `bootstrap.test.ts` drift check passes (on-disk `.cls` == embedded == version hash). NEVER hand-edit `bootstrap-classes.ts` (Rule #18).

2. **AC 15.6.2 — Live-verify each new capability on HSCUSTOM (Rule #16).** A non-destructive call per new tool/capability:
   - `iris_service_manage` `list`
   - `iris_ldap_manage` `list`
   - `iris_x509_manage` `list`
   - `iris_audit_manage` `status`
   - `iris_resource_manage` `listPrivileges` (grantee=_SYSTEM)
   Capture evidence. Deploy via glob-prefixed `iris_doc_load` (Rule #17) if any redeploy is needed (it generally isn't — already deployed per story).

3. **AC 15.6.3 — Documentation rollup (counts: suite 89 → 93, admin 22 → 26).** Update, with consistent counts:
   - `packages/iris-admin-mcp/README.md` — add the 4 new tools + the `iris_resource_manage` privilege enhancement; admin count → 26.
   - `tool_support.md` — add rows for the 4 new tools + note the privilege enhancement; roll up per-server (admin → 26) + suite total → 93 + any derived "X of 93" prose.
   - `packages/iris-mcp-all/README.md` — suite "89 tools" → "93 tools".
   - `README.md` (repo root) — "89 tools" → "93 tools" (+ ASCII diagram admin count if present).
   - `CHANGELOG.md` — Epic 15 `### Added` entry (4 tools + privilege enhancement + governance classifications).
   - `docs/migration-v1-v2.md` — if it carries a suite count ("5 servers, 89 tools total"), → 93.
   - **`_bmad-output/planning-artifacts/architecture.md` (routed from Story 15.0):** fix the stale counts — `(16 tools)` on the ops line → `(17 tools)`, and the "86 tools" suite total (line ~32) → **93** (the final post-Epic-15 count).

4. **AC 15.6.4 — Deploy (Rule #17).** Any `iris_doc_load` uses a glob-prefixed path (`c:/git/iris-execute-mcp-v2/src/**/*.cls`).

5. **AC 15.6.5 — Back-compat + suite green.** Governance hash stays `1e62c5ad5bf7` / 141 keys (frozen — do NOT regenerate). Full monorepo build/test/lint green; `tsc` strict clean. Doc-only changes carry no code risk; verify the doc counts are internally consistent (per-server columns sum to the suite total).

## Tasks / Subtasks

- [x] **Task 1 — Bootstrap verify (AC 15.6.1):** `pnpm turbo run build && pnpm run gen:bootstrap`; confirm no diff + `bootstrap.test.ts` green + version `e5f4f6d88c56`.
- [x] **Task 2 — Live-verify (AC 15.6.2):** non-destructive call per new tool/capability on HSCUSTOM; capture evidence.
- [x] **Task 3 — Docs rollup (AC 15.6.3):** counts suite 89→93, admin 22→26; the 6 doc surfaces above incl. the routed architecture.md fix. Keep counts internally consistent.
- [x] **Task 4 — Suite green (AC 15.6.5):** full monorepo build/test/lint; governance hash `1e62c5ad5bf7` unchanged; do NOT run gen:governance-baseline.

## Dev Notes

- **Counts (verified at story creation, generator output — captured WITHOUT committing the generator's baseline rewrite):** suite = 93 tools across 5 packages; per-package: iris-dev 24, iris-admin **26**, iris-interop 19, iris-ops 17, iris-data 7. Admin went 22 → 26 (the 4 new tools). `iris_resource_manage` extension adds governance KEYS (3) but no new tool. Cross-check `index.test.ts` (`toHaveLength(26)` / `toolCount 26`).
- **Do NOT run `gen:governance-baseline`** (frozen-foundation footgun — it regrows the 141-key baseline). If you need to confirm counts, read `index.test.ts` or count the `tools` arrays; do not invoke the governance generator. If it is accidentally run, `git checkout -- packages/shared/src/governance-baseline.ts` to restore the frozen file.
- **Bootstrap is already current** (`e5f4f6d88c56`) — this story should produce NO bootstrap change; if `gen:bootstrap` produces a diff, investigate (it would mean an earlier story's regen was incomplete).
- **architecture.md** is a planning artifact (was deliberately deferred from Story 15.0 to land here at the final count). Fix both the ops `(16 tools)`→`(17 tools)` and the suite `86 tools`→`93`.
- Pattern: mirror Story 14.6 / 13.2 docs-rollup discipline; verify every load-bearing documented number against the code.

## Dev Agent Record

### Completion Notes

**AC 15.6.1 — Bootstrap finalized + verified (idempotent).** `pnpm turbo run build` (6/6 packages, tsc strict clean) then `pnpm run gen:bootstrap` produced **no diff** to `bootstrap-classes.ts` — `BOOTSTRAP_VERSION` stays `e5f4f6d88c56` (13 classes). Confirmed via `git diff --stat` (empty). Verified all Epic-15 ObjectScript is embedded: `ServiceList`/`ServiceManage`, `LdapList`/`LdapManage`, `X509List`/`X509Manage`, `AuditStatus`/`AuditManage`, `SqlPrivilege*` handlers in the embedded `Security.cls`, plus the `/security/service`, `/security/ldap`, `/security/x509`, `/security/audit`, `/security/sqlprivilege` routes in the embedded `Dispatch.cls`. `bootstrap.test.ts` drift check green (41 tests; on-disk `.cls` == embedded == version hash). **Bootstrap was already current per Option A per-story regen — no fresh bump needed, exactly as the story predicted.**

**AC 15.6.2 — Live-verify on HSCUSTOM (Rule #16).** The running MCP server in this session predates Epic 15 (its `iris_resource_manage` schema only exposed create/modify/delete), so the new tools weren't callable as MCP tools — verified directly against the deployed REST endpoints (`http://localhost:52773/api/executemcp/v2/security/...`, `_SYSTEM:SYS`) per the story's allowance. All HTTP 200 with valid JSON:
- `GET /security/service` (service `list`) → full service inventory (`%Service_Bindings` enabled, `%Service_CallIn` disabled, …).
- `GET /security/ldap` (ldap `list`) → `[{"name":"workgroup.com","enabled":false,…}]`.
- `GET /security/x509` (x509 `list`) → `[]` (no X.509 creds configured; valid empty result).
- `GET /security/audit` (audit `status`) → `{"auditEnabled":true,"events":[…]}`.
- `GET /security/sqlprivilege?grantee=_SYSTEM` (`listPrivileges`) → `{"grantee":"_SYSTEM","level":"object","privileges":[…grantedVia:"SuperUser"…]}`.
No redeploy was needed (handlers already deployed per prior Epic-15 stories).

**AC 15.6.3 — Documentation rollup (suite 89→93, admin 22→26).** Counts verified against code (`index.test.ts` per package): dev 24 + admin **26** + interop 19 + ops 17 + data 7 = **93**; admin `index.test.ts` asserts `toHaveLength(26)` / `toolCount 26`. Updated 7 surfaces with internally-consistent counts:
- `packages/iris-admin-mcp/README.md` — header + 4 new tool tables (service/ldap/x509/audit) + SQL-privilege actions section + `iris_resource_manage` row + Namespace-Scoping exception note.
- `tool_support.md` — admin header (22)→(26), `iris_resource_manage` endpoint note, 4 new rows (#23–26), Mix 22→26 ExecuteMCPv2 + Epic-15 note, Suite-wide rollup (admin 22→26, ExecuteMCPv2 66→70, Total 89→93), derived prose (66 of 89/74% → 70 of 93/75%, both occurrences), placeholder-note 89→93.
- `packages/iris-mcp-all/README.md` — admin table row 22→26, suite 89→93.
- `README.md` (root) — admin table row 22→26, suite 89→93, ASCII diagram admin (22)→(26).
- `CHANGELOG.md` — new `[Pre-release — 2026-06-16]` § with Epic 15 `### Added` (4 tools + SQL-privilege extension, with per-action read/write governance classifications + frozen-baseline note + bootstrap `e5f4f6d88c56`).
- `docs/migration-v1-v2.md` — 89→93 (both occurrences).
- `_bmad-output/planning-artifacts/architecture.md` (routed from Story 15.0) — line-32 suite total `86`→`93`; ASCII tree block refreshed to current verified per-server counts (dev 20→24, admin 22→26, ops 16→17, data 9→7) so the block sums to 93 (was 86, internally stale across dev/admin/data too — fixed per AC 15.6.5 consistency requirement).

**AC 15.6.4 / 15.6.5 — Deploy + back-compat + suite green.** No `iris_doc_load` redeploy needed. Governance baseline frozen: `GOVERNANCE_BASELINE_HASH` stays `1e62c5ad5bf7`, `git diff` on `governance-baseline.ts` empty (gen:governance-baseline NOT run). Full monorepo green: `pnpm turbo run test` 12/12 (shared 500, admin 439, dev 293, data 120, interop 171, ops 159); `pnpm turbo run lint` 6/6; `pnpm turbo run build --force` 6/6 (tsc strict clean, 0 errors). Doc counts internally consistent (per-server columns sum to 93).

**Decisions.** (1) Bootstrap idempotent — confirmed no diff, version unchanged at `e5f4f6d88c56`, matching the story's Option A prediction. (2) Final counts: suite **93**, admin **26**, ExecuteMCPv2-backed **70**. (3) architecture.md ASCII tree: scope was widened beyond the AC-named ops `(16→17)` line to also fix the co-located stale dev/admin/data counts in the same block, because AC 15.6.5 requires per-server columns to sum to the suite total — leaving dev=20/admin=22/data=9 would have left the block summing to 86, contradicting the corrected 93 total on line 32.

### File List

- `README.md` (modified)
- `packages/iris-mcp-all/README.md` (modified)
- `packages/iris-admin-mcp/README.md` (modified)
- `tool_support.md` (modified)
- `CHANGELOG.md` (modified)
- `docs/migration-v1-v2.md` (modified)
- `_bmad-output/planning-artifacts/architecture.md` (modified)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — status ready-for-dev → in-progress → review)

_No code or ObjectScript changes; no `bootstrap-classes.ts` / `governance-baseline.ts` regeneration (both confirmed unchanged)._

## Change Log

| Date | Change |
|---|---|
| 2026-06-16 | Story 15.6 implemented (Epic 15 closer). Bootstrap verified idempotent at `e5f4f6d88c56` (no diff; bootstrap.test.ts 41 green). Live-verified all 4 new admin tools + listPrivileges on HSCUSTOM via REST (HTTP 200). Docs rollup suite 89→93 / admin 22→26 across 7 surfaces (admin README, tool_support.md, iris-mcp-all README, root README, CHANGELOG, migration-v1-v2, architecture.md). Governance baseline NOT regenerated (hash 1e62c5ad5bf7 frozen). Full suite green: test 12/12 (shared 500/admin 439/dev 293/data 120/interop 171/ops 159), lint 6/6, build --force 6/6 tsc strict clean. Status → review. |
| 2026-06-16 | Story 15.6 authored (Epic 15 closer). Bootstrap finalized/verified idempotent at `e5f4f6d88c56` (Option A per-story regen already current); live-verify the 4 new tools + privilege enhancement; docs rollup (suite 89→93, admin 22→26) across iris-admin README, tool_support.md, iris-mcp-all README, root README, CHANGELOG, migration-v1-v2, + the routed architecture.md count fix from Story 15.0. Frozen-foundation governance baseline NOT regenerated (hash 1e62c5ad5bf7); gen:governance-baseline must not be run. |
