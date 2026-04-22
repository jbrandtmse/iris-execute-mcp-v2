---
date: 2026-04-22
trigger_type: defect-batch
scope_classification: Moderate
status: Proposed
handoff: Scrum Master → Development team (cross-package)
---

# Sprint Change Proposal — 2026-04-22

## Epic 12: Post-Epic-11 Bug Fix Batch & Feature Gap Closure

---

## Section 1 — Issue Summary

### What triggered this change

On 2026-04-22, the user ran a second comprehensive test pass against the IRIS MCP Server Suite after Epic 11 closed. All 16 bugs that Epic 11 targeted were re-verified and confirmed fixed. However, the broader exercise surfaced **7 new bugs** and **9 feature-level gaps** in tool surfaces that Epic 11's scoped batch did not cover.

**7 new bugs** (8 counting the regression — Epic 11's Bug #12 fix propagated the error but left the underlying wrong-property bug in place):

1. **BUG-1 (HIGH)** — `iris_user_password action:"change"` completely broken. Handler sets `tProps("ChangePassword") = tPassword` but `ChangePassword` is the boolean "force change on next login" flag; correct property is `Password`. Regression/incomplete fix from Epic 11 Bug #12.
2. **BUG-2 (HIGH)** — `iris_production_manage action:"create"` broken: `<METHOD DOES NOT EXIST>Create,Ens.Config.Production`. The handler calls a non-existent method.
3. **BUG-3 (HIGH)** — `iris_production_control action:"stop"` broken: `<INVALID CLASS>Class '%Library.DynamicObject' does not support MultiDimensional operations`. `start`, `restart`, `update`, `recover` likely share the same bug.
4. **BUG-4 (MEDIUM)** — `iris_database_manage action:"modify"` rejects `maxSize` with `<PROPERTY DOES NOT EXIST>Modify *MaxSize,Config.Databases`. Tool schema advertises `SYS.Database` fields (`maxSize`, `expansionSize`) but handler only forwards to `Config.Databases.Modify()` per Rule #3 (Config vs SYS class separation).
5. **BUG-5 (MEDIUM)** — `iris_docdb_property create` silently ignores the `type` parameter. Sent `%Integer`, got `%Library.String`.
6. **BUG-6 (MEDIUM)** — `iris_docdb_find` filter not applied. `{age:{$gt:26}}` returns all documents regardless. Compounded by BUG-5 (string typing).
7. **BUG-7 (LOW)** — UTF-8 mojibake in `iris_metrics_alerts` console-log echoes. `خطأ` appears as `Ø®Ø·Ø£` (Latin-1 rendering of UTF-8 bytes).
8. **BUG-8 (LOW)** — `iris_execute_command` error path produces `???` where sibling tools produce `خطأ` (redirect-buffer charset handling differs from direct-response path).

**9 feature-level gaps**:

- **FEAT-1** — `iris_oauth_manage create server` missing required fields (`customizationNamespace`, `customizationRoles`); `supportedScopes` string not split into the required collection. Creating an OAuth server is impossible through the tool.
- **FEAT-2** — `iris_rest_manage scope:"all"` returns *only* hand-written apps, not the union with spec-first. Caller reasonably expects "all" to mean both.
- **FEAT-3** — `iris_transform_list` / `iris_rule_list` need `prefix`/`filter`/pagination. `transform_list` returned 622 rows on this HealthShare instance with no way to narrow.
- **FEAT-4** — `iris_user_password validate` lacks policy context. Both `abc` and `StrongPass123!` return `valid:true`. Response should surface the active password-rule regex/min-length.
- **FEAT-5** — Database delete leaves scheduled background work (extent-index rebuild alert fires after delete). Upstream IRIS behavior; best we can do is document in the tool description.
- **FEAT-6** — `iris_rest_manage get` dumps full swagger spec (51.5KB for FHIR mgmnt). Add `fullSpec:boolean` opt-in; default to summary (paths count, definitions count, basePath, description).
- **FEAT-7** — No tool for clearing/acknowledging alerts. `iris_metrics_alerts` returns active alerts but there's no manage counterpart.
- **FEAT-8** — `iris_global_list` `filter` is case-sensitive; `iris_doc_list` `filter` is case-insensitive. Cross-tool inconsistency for the same concept.
- **FEAT-9** — `iris_execute_command` error path: decode bytes as UTF-8 (fixes BUG-8 at the TypeScript layer if the server sends raw bytes correctly).

### When and how the issue was discovered

User request: "Test the IRIS MCP Server Suite comprehensively including the tools that could be destructive. Be careful to not destroy any existing assets on the server. Use test assets that you create instead."

The session created, modified, and deleted test assets (`TESTMCP*` / `TESTMCPRes` / `TESTMCPRole` / `TESTMCPUser` / `TESTMCPSSL` / `TESTMCPDB` / `TESTMCPNS` / `TESTMCPCred` / `TESTMCPTable` / `TESTMCP_Task` / `TESTMCPGlobal`) across all five servers. Error paths were exercised for every tool. The IRIS `%Service_DocDB` service was temporarily enabled (and then re-disabled) so the data server's docdb tools could be tested. All test assets were cleaned up before the report was filed.

### Evidence

- Full tool-level test trace from the 2026-04-22 session.
- IRIS library source inspection ([src/ExecuteMCPv2/REST/Security.cls:420](../../src/ExecuteMCPv2/REST/Security.cls#L420)) confirming BUG-1 root cause (wrong property name).
- IRIS error-envelope evidence: `<PROPERTY DOES NOT EXIST>Modify *MaxSize,Config.Databases` confirms BUG-4 root cause (Config.Databases has no `MaxSize` — it's on `SYS.Database`, per Rule #3).
- Cross-tool comparison of error-prefix rendering (`iris_execute_classmethod` returns `خطأ`, `iris_execute_command` returns `???`) confirms BUG-8's I/O-redirect charset origin.
- Epic 11's 16 bugs all re-verified fixed — see Section 3 below for the verification matrix.

### Issue type

**Defect batch + feature-gap closure identified during second comprehensive test pass.** Not a new requirement, not a strategic pivot. Epic 12 is the same pattern as Epics 10 and 11 — a correction pass before first npm publish.

---

## Section 2 — Impact Analysis

### Epic impact

- **Epics 1–11**: all `done`; retrospectives complete (Epic 11 closed 2026-04-22).
- **Epic 12**: net-new bug-fix + feature-gap epic, same structural pattern as Epic 11.
- **No epic is invalidated** — all bugs are defects against existing FRs; all feature gaps are additive (one new tool, two new parameters, one new field).

### Story impact

- No in-flight stories affected — Epic 11 closed.
- Six new stories in Epic 12 (12.1–12.6).

### Artifact conflicts

- **PRD** (`prd.md`): one potential addition — FR for an alerts-manage tool (Epic 12 / Story 12.6 adds a new tool). All other changes are correctness defects or additive fields on existing FRs. Decision: add a new FR line for the alerts-manage tool in the same pattern as other ops tools (e.g., FR for `iris_metrics_alerts` already exists — `iris_alerts_manage` is its CRUD counterpart).
- **Architecture** (`architecture.md`): no component or pattern changes. All fixes are bug-squash inside existing handlers; the one new tool lives in `iris-ops-mcp` alongside existing alert tools.
- **Epics** (`epics.md`): new `## Epic 12` section appended.
- **Sprint status** (`sprint-status.yaml`): new `epic-12: backlog` block with 6 stories.

### Source files touched

**ObjectScript** (`src/ExecuteMCPv2/…`):
- `REST/Security.cls` — BUG-1 (password property) + FEAT-4 (password policy surface)
- `REST/Interop.cls` — BUG-2 (production create) + BUG-3 (production control DynamicObject access)
- `REST/Config.cls` — BUG-4 (database modify split between Config.Databases and SYS.Database) + FEAT-5 note
- `REST/Monitor.cls` or new `REST/Alerts.cls` — FEAT-7 (new alerts-manage handler)
- `Utils.cls` — potentially touched if BUG-8 needs server-side charset fix (verify first)
- `Setup.cls` — webapp entry for new alerts endpoint if FEAT-7 uses a new URL

**TypeScript packages**:
- `packages/iris-admin-mcp/src/tools/user.ts` — BUG-1 wire response unchanged (server fix is what matters); FEAT-4 surface the policy in validate response
- `packages/iris-admin-mcp/src/tools/oauth.ts` — FEAT-1 (OAuth server create: customizationNamespace, customizationRoles, supportedScopes-as-collection)
- `packages/iris-admin-mcp/src/tools/database.ts` — BUG-4 surface validation (reject fields the server can't accept, or split across Config/SYS calls)
- `packages/iris-interop-mcp/src/tools/production.ts` — BUG-2/3 surface unchanged
- `packages/iris-data-mcp/src/tools/rest.ts` — FEAT-2 scope semantics rethink; FEAT-6 get-swagger summary mode
- `packages/iris-data-mcp/src/tools/docdb.ts` — BUG-5 type forwarding, BUG-6 filter translation
- `packages/iris-interop-mcp/src/tools/transforms.ts` + `rules.ts` — FEAT-3 filter/prefix
- `packages/iris-dev-mcp/src/tools/globals.ts` — FEAT-8 case-insensitive filter
- `packages/iris-dev-mcp/src/tools/execute.ts` or shared client — BUG-8/FEAT-9 charset decode audit
- `packages/iris-ops-mcp/src/tools/alerts.ts` — **new tool** `iris_alerts_manage` for FEAT-7

**Generated**:
- `bootstrap-classes.ts` — `BOOTSTRAP_VERSION` hash bump at the end of Epic 12 (Story 12.2, 12.3, or 12.5 depending on which lands last). Covers all ObjectScript edits from 12.1–12.4 (+ 12.6 if it adds a new handler).

### Documentation impact

Inline per story (same pattern as Epic 11 — no standalone documentation rollup):
- **Per-package READMEs**: update affected tool entries.
- **`tool_support.md`**: add row for `iris_alerts_manage`; field-level notes for changed tools.
- **`CHANGELOG.md`**: new `## [Pre-release — 2026-04-22]` block with `### Fixed` / `### Added` / `### Changed` sections.
- **`.claude/rules/project-rules.md`**: likely two new rules after Epic 12 retrospective — one for Config vs SYS property surface mapping (BUG-4 shape), one for "read the class property type, not just the name" (BUG-1 shape). Retrospective decides.

---

## Section 3 — Epic 11 Verification Matrix (carried forward from test pass)

All 16 Epic 11 bugs confirmed fixed on 2026-04-22:

| Bug | Fix confirmed by |
|-----|-------|
| #1 `execute_command` non-JSON | Error `<DIVIDE>Execute` now returns as JSON |
| #2 `database_list` size=0 | IRISLIB=368MB, HSLIB=1362MB — real sizes |
| #3 `user_get` missing fullName/comment | Returned correctly |
| #4 `user_get` missing changePassword | Returned |
| #5 `role_list` missing resources | `%Developer` resources populated |
| #6 SSL `protocols` → `tlsMinVersion`/`tlsMaxVersion` | Both fields present |
| #7 `doc_search` default files pattern | Works with defaults (after MCP server reload — stale build caught during test) |
| #8 password redaction | Unchanged in validate path; change path broken for separate reason (BUG-1) |
| #9 `metrics_system` per-process counters | Shows 1.9B global refs / 6B routine cmds (instance-wide) |
| #10 `%All` short-circuit | `_SYSTEM` + `%DB_USER:RW` → `granted:true, reason:"target holds %All super-role"` |
| #11 double-wrapped prefix | Error text comes back clean (single prefix) |
| #12 user_password generic error | `NoSuchUser999` returns real IRIS text; BUG-1 is orthogonal |
| #13 `rest_manage` scope param | Both `spec-first` and `all` work (but semantics need clarification — see FEAT-2) |
| #14 `analytics_cubes` horolog | Schema has `lastBuildTime` + `lastBuildTimeRaw` (no cubes defined to verify live) |
| #15 `config_manage get locale` | Returns `current:"enuw"` |
| #16 `doc_put` description | Leads with "Debug/scratch tool" |

Epic 11 is functionally complete. Epic 12 is not a regression fix on Epic 11 — it's coverage that Epic 11 didn't scope.

---

## Section 4 — Recommended Approach

### Path forward

**Direct Adjustment**: Add Epic 12 (six stories) to the backlog before first npm publish, same pattern as Epic 11 (four stories). Epic 12 is the last quality gate before publishing.

### Rationale

- **Severity**: BUG-1 through BUG-3 are HIGH (tools entirely broken). They must be fixed before publish — shipping a release where `iris_user_password change` always fails is not acceptable.
- **Blast radius**: small. All fixes are localized to specific handler methods / tool files. No architectural changes. Same pattern as Epic 11.
- **Retrospective signal**: Epic 11's own retro called out "test every CRUD path, not just happy-path reads" as a lesson — Epic 12 test pass is exactly that lesson applied. Fixing now (before publish) is cheaper than an Epic 13 hotfix after.
- **Publishing checklist integration**: Story 9.3 (pre-publish smoke test) re-runs AFTER Epic 12 closes, using Epic 12 validation as input.

### Effort estimate

- **Story 12.1**: small. One-line property-name fix in Security.cls + FEAT-4 password policy surface + unit tests. Target: 2–3 hours.
- **Story 12.2**: medium. Audit whole Interop.cls for DynamicObject access bugs, fix stop/start/restart/update/recover. Target: 3–5 hours.
- **Story 12.3**: medium. Design production-create flow (class generation + Save + IPM-awareness). Target: 3–5 hours. Research first.
- **Story 12.4**: medium. Split database modify between Config.Databases and SYS.Database; fix DocDB type forwarding and find-filter translation. Target: 4–6 hours.
- **Story 12.5**: medium. TS-only pass: OAuth fields, rest_manage scope semantics, swagger summary, transform/rule filters, global-list case consistency. Target: 3–5 hours.
- **Story 12.6**: small-medium. New `iris_alerts_manage` tool + handler + tests + docs. Target: 2–4 hours.

**Total**: roughly 2–3 days of focused dev work, same shape as Epic 11.

### Risk assessment

- **Low-medium**. Biggest risk is Story 12.3 (production create) — IPM and class-generation behavior needs careful research before committing to an approach. Use Perplexity + `irissys/Ens/Config/Production.cls` source-read to de-risk.
- **BOOTSTRAP_VERSION coordination**: single bump at the end (same pattern as Epic 11) — one ObjectScript auto-upgrade covers 12.1–12.4 and optionally 12.6.
- **SSL schema already broken (Epic 11 pre-release break)**: Epic 12 does NOT add a second schema break. All changes are additive or bug fixes.

### Timeline impact

- Epic 12 closes before the pre-publish smoke test re-run (Story 9.3). First npm publish still depends on the publishing checklist (user has not published to npm yet — see memory `user_npm_publish_experience`).

---

## Section 5 — Detailed Change Proposals

### Stories (Epic 12)

- **12.1 — Password change fix + validate response policy surface** (BUG-1, FEAT-4)
  - Fix [src/ExecuteMCPv2/REST/Security.cls:420](../../src/ExecuteMCPv2/REST/Security.cls#L420): change `tProps("ChangePassword") = tPassword` to `tProps("Password") = tPassword`. Add a live-verification AC.
  - FEAT-4: after validate returns, surface the active password policy (min-length, pattern) from `Security.System` or `$SYSTEM.Security.PasswordValidate()` metadata.
  - Tests: add a real change test (`change` then `validate` with new pwd), a "password policy surfaced" assertion.

- **12.2 — Production control DynamicObject audit** (BUG-3)
  - Fix [src/ExecuteMCPv2/REST/Interop.cls](../../src/ExecuteMCPv2/REST/Interop.cls) `ProductionControl()` method's DynamicObject access pattern (likely `tBody("key")` → `tBody.%Get("key")`). Audit the whole class for same pattern — fix every occurrence.
  - Tests: start/stop/restart/update/recover happy-path + error-path unit tests against mocked IRIS.

- **12.3 — Production create** (BUG-2)
  - Research first: read `irissys/Ens/Config/Production.cls` source + check how Mgmnt Portal creates productions. Decide between (a) class generation + `%Save()` + compile, or (b) `Ens.Config.Production:%New(name):%Save()` if supported.
  - Implement in `Interop.cls` `ProductionManage()` method for `create` action.
  - Tests: create a TESTMCP.Prod, verify it appears in `iris_production_summary`, delete it.

- **12.4 — Database modify Config/SYS split + DocDB type + find filter + DB-delete docs** (BUG-4, BUG-5, BUG-6, FEAT-5)
  - Fix [src/ExecuteMCPv2/REST/Config.cls](../../src/ExecuteMCPv2/REST/Config.cls) `DatabaseManage()`: when `modify` receives `maxSize` / `expansionSize`, route to `SYS.Database.MaxSize` / `ExpansionSize` via `%OpenId(directory)` + `%Save()`. Keep `Config.Databases.Modify()` for configuration fields only.
  - Fix [packages/iris-data-mcp/src/tools/docdb.ts](../../packages/iris-data-mcp/src/tools/docdb.ts) property create: research Atelier DocDB `POST /prop/...` body shape; if type field is in wrong position, correct it.
  - Fix DocDB find filter: translate `{age:{$gt:26}}` to SQL `WHERE age > 26` or use the Atelier find query param the underlying IRIS API expects.
  - Doc FEAT-5: add a "Note: deleting a database does not cancel pending background work against it" to `iris_database_manage` description for `delete` action.
  - Tests: modify a DB's maxSize; insert typed DocDB docs + filtered query.

- **12.5 — TS-only surface cleanup** (FEAT-1, FEAT-2, FEAT-3, FEAT-6, FEAT-8, FEAT-9)
  - **FEAT-1** — `packages/iris-admin-mcp/src/tools/oauth.ts`: add `customizationNamespace` and `customizationRoles` parameters; split `supportedScopes` string into a JSON array on the wire.
  - **FEAT-2** — `packages/iris-data-mcp/src/tools/rest.ts`: rename/clarify `scope` values. Options: (a) `scope: "spec-first" | "legacy" | "all"` where `"all"` is the union; (b) keep current values and rewrite the description to be unambiguous. Pick (a) since it's semantically cleaner.
  - **FEAT-3** — `packages/iris-interop-mcp/src/tools/transforms.ts` + `rules.ts`: add `prefix` and `filter` parameters (plain substring, server-side via `Name LIKE '%<filter>%'`). Mirror `iris_doc_list` semantics. Add optional cursor-based pagination.
  - **FEAT-6** — `packages/iris-data-mcp/src/tools/rest.ts` `get` action: add `fullSpec:boolean` (default false). When false, return `{name, dispatchClass, namespace, swaggerSpec: {basePath, pathCount, definitionCount, description}}`. When true, return the full blob as today.
  - **FEAT-8** — `packages/iris-dev-mcp/src/tools/globals.ts`: swap server-side `[` contains operator for case-insensitive match (e.g., `$ZCONVERT(name, "L") [ $ZCONVERT(filter, "L")`). Document in the tool description.
  - **FEAT-9 / BUG-8** — Audit the shared HTTP client's response-body decode path for UTF-8 vs Latin-1. Fix `iris_execute_command`'s `???`-where-`خطأ`-should-be mojibake. Same audit covers `iris_metrics_alerts` BUG-7 if the issue is on the TS side.
  - Tests: one per FEAT bullet (6 new tests roughly).

- **12.6 — `iris_alerts_manage` new tool** (FEAT-7)
  - New handler method `AlertsManage()` in `Monitor.cls` (or a new `Alerts.cls`) with actions `clear` (by index), `clearAll`, and `acknowledge`.
  - New TS tool `iris_alerts_manage` in `packages/iris-ops-mcp/src/tools/alerts.ts` alongside existing `iris_metrics_alerts`.
  - Add tool_support.md row; README entry; one FR addition in prd.md.
  - Tests: create alert via `Write $SYSTEM.Event.Alert("test")` in a probe class, clear it via tool, verify gone.

### PRD update

Append one line to `prd.md` in the Operations & Monitoring FR section:

**NEW FR** (numbering depends on current PRD state — verify when writing the edit):
> The operator can clear or acknowledge IRIS system alerts via `iris_alerts_manage`.

### Epics.md update

Append `## Epic 12: Post-Epic-11 Bug Fix Batch & Feature Gap Closure` section with stories 12.1–12.6. Same structure as Epic 11.

### Sprint status update

New `epic-12` block:
```yaml
# Epic 12: Post-Epic-11 Bug Fix Batch & Feature Gap Closure
# Added 2026-04-22 via bmad-correct-course. See sprint-change-proposal-2026-04-22.md.
# Single BOOTSTRAP_VERSION bump at end of Story 12.4 (or 12.6 if alerts adds a handler) covers 12.1–12.4.
epic-12: backlog
12-1-password-change-fix-and-policy-surface: backlog
12-2-production-control-dynamicobject-audit: backlog
12-3-production-create: backlog
12-4-database-modify-docdb-and-delete-docs: backlog
12-5-typescript-tool-surface-cleanup: backlog
12-6-alerts-manage-new-tool: backlog
epic-12-retrospective: optional
```

### Architecture, UX, Spec

- **Architecture**: no changes.
- **UX**: n/a (no UI component).
- **Spec**: no changes.

---

## Section 6 — Implementation Handoff

### Change scope classification

**Moderate**: Requires backlog reorganization (new epic inserted before first npm publish). No fundamental replan. Same scope class as Epic 11.

### Handoff recipients

- **Scrum Master (Bob)**: add Epic 12 to sprint plan, create Story 12.0 (Epic 11 deferred cleanup) if any items carry forward from Epic 11's retrospective, then create Story 12.1 via `bmad-create-story`.
- **Development team (Amelia)**: execute stories 12.1 → 12.6 in order via `/epic-cycle 12`.
- **QA (Murat)**: live-verification AC in Story 12.2, 12.3, 12.6 (the ObjectScript-touching stories that bump BOOTSTRAP_VERSION).
- **Tech Writer (Paige)**: CHANGELOG + README + tool_support.md updates inline per story.

### Success criteria

- All 8 bugs from the 2026-04-22 test pass are fixed (verified via live re-run of reproductions in Story 12.4's live-verification AC).
- All 9 feature gaps are closed (unit tests for each).
- BOOTSTRAP_VERSION bumps cleanly (single hash change covers ObjectScript edits from 12.1–12.4, optionally 12.6).
- Pre-publish smoke test (Story 9.3) re-run passes after Epic 12 closes.
- No new regressions on Epic 11's 16 bugs (verification matrix re-run as part of Story 12.4's live AC).

---

## Section 7 — Approval Checklist

- [ ] Story list (12.1–12.6) agreed.
- [ ] Stories cover all 8 bugs and 9 feature gaps (see mapping above).
- [ ] Pre-publish gate intact: Epic 12 completes before first npm publish.
- [ ] No PRD/Architecture/UX conflicts beyond the single new FR for `iris_alerts_manage`.
- [ ] Single BOOTSTRAP_VERSION bump strategy confirmed.
- [ ] Inline documentation pattern (no standalone rollup story) confirmed — same as Epic 11.

---

**Awaiting approval to commit the `epics.md` append + `sprint-status.yaml` update.**
