---
date: 2026-04-21
trigger_type: defect-batch
scope_classification: Moderate
status: Approved
handoff: Scrum Master → Development team (cross-package)
---

# Sprint Change Proposal — 2026-04-21

## Epic 11: Post-Publish Bug Fix Batch (IRIS MCP Server Suite)

---

## Section 1 — Issue Summary

### What triggered this change

On 2026-04-21, the user ran a comprehensive test pass against the IRIS MCP Server Suite covering all five server packages (`iris-dev-mcp`, `iris-admin-mcp`, `iris-data-mcp`, `iris-interop-mcp`, `iris-ops-mcp`). The test created, modified, and deleted test assets (roles, resources, users, web applications, SSL configs, credentials, lookup tables, scheduled tasks, globals, classes) and inspected the responses against IRIS authoritative source (`irislib/` and `irissys/` local exports, plus direct probes via `Security.Users.Get()`, `Security.Roles.Get()`, `SYS.Database`, etc.).

**16 bugs were identified** across 4 of the 5 packages:

1. `iris_execute_command` — any runtime ObjectScript error produces a non-JSON response (envelope broken).
2. `iris_database_list` — always reports `size:0` for every database (USER is actually 11 MB).
3. `iris_role_list` — always reports `resources:""` (verified `%EnsRole_Administrator` actually has 37 resource:permission pairs).
4. `iris_user_get` list mode — always reports `enabled:false, fullName:"", comment:""` for every user.
5. `iris_user_get` single-user mode — returns `name:""` in the response even though lookup succeeded.
6. `iris_ssl_manage` / `iris_ssl_list` — the `protocols` field doesn't map to the underlying `Security.SSLConfigs` shape (which uses `TLSMinVersion` / `TLSMaxVersion`); input silently dropped on create, output always `0` on list.
7. `iris_doc_search` — default `files` pattern doesn't take effect; callers that don't pass `files` explicitly get empty results.
8. `iris_user_password` validate mode — error message over-redacts: every occurrence of the candidate password character is replaced in the error text ("Password does not match length or pattern" → "P***ssword does not m***tch length or p***ttern" for candidate `a`).
9. `iris_metrics_system` — counters returned are stale/wrong (`iris_global_references_total=2`, `iris_routine_commands_total=0` after 33 hours of uptime).
10. `iris_permission_check` — returns `granted:false` for `_SYSTEM` and for the `%All` role on any resource.
11. `Utils.SanitizeError` — nested/doubled error wrapping (`خطأ #5001: خطأ #5001: Failed to change password…`).
12. `iris_user_password` change mode — fails silently with only `Failed to change password for user 'X'` and no underlying reason.
13. `iris_rest_manage` `action:"list"` — omits hand-written `%CSP.REST` dispatch classes (e.g., `ExecuteMCPv2.REST.Dispatch` in HSCUSTOM); the underlying `%REST.API.GetAllRESTApps` is spec-first only by design.
14. `iris_analytics_cubes` — `lastBuildTime` returned in raw `$HOROLOG` format (`67360,85964.1540167`) instead of ISO 8601.
15. `iris_config_manage get locale` — returns `availableLocales[]` and `localeCount` but omits the *current* locale.
16. `iris_doc_put` description — self-contradictory; warns against production use without a clear "scratch/debug only" marker at the suite level.

### When and how the issue was discovered

User request: "Comprehensively test the IRIS MCP Server Suite tools." The session created test resources, exercised every tool at least once (including error paths), cross-verified each response against `Security.Users.Get()` / `SYS.Database` / `Security.Roles.Get()` via a probe class, and produced a numbered bug report. All test assets were cleaned up before the report was filed.

### Evidence

- Full tool-level test trace from the 2026-04-21 session (see the bug report at the end of the conversation transcript for reproductions).
- IRIS library source inspection (`irissys/Security/Roles.cls` line 380 `List` query ROWSPEC; line 420 `ListAll` query ROWSPEC) confirming Bug #3's root cause.
- `irissys/Security/Users.cls` line 798 `List` ROWSPEC confirming Bug #4's root cause.
- `irissys/Security/SSLConfigs.cls` line 459 `List` ROWSPEC confirming Bug #6's root cause.
- `irislib/%SYS/%REST.API.cls` full source inspection confirming Bug #13's root cause (spec-first filter is by design in the InterSystems API — tool must add a mode to crawl `GetAllWebRESTApps`).
- Direct probe outputs for every suspicious field (enabled, fullName, Resources, Size, Protocols, etc.).

### Issue type

**Defect batch identified during pre-publish test pass.** Not a new requirement, not a strategic pivot, not an implementation-path failure. The MVP scope is intact; these are correctness defects against already-shipped FRs, uncovered by the first comprehensive black-box test against a populated IRIS instance.

---

## Section 2 — Impact Analysis

### Epic impact

- **Epics 1–10**: all `done`; retrospectives complete. No rework, no resequencing.
- **Epic 11**: net-new bug-fix epic, same structural pattern as Epic 10 (which itself was added via course correction). Sits before first npm publish as a quality gate.
- **No epic is invalidated** — all 16 bugs are defects against FRs that remain valid.

### Story impact

- No in-flight stories affected — Epic 10 closed and retrospected 2026-04-20.
- Four new stories in Epic 11 (11.1–11.4).

### Artifact conflicts

- **PRD** (`prd.md`): no changes. All 16 bugs are correctness defects against existing FRs, not scope changes. `iris_ssl_manage` field rename (`protocols` → `tlsMinVersion`/`tlsMaxVersion`) is a schema-shape change, not an FR change.
- **Architecture** (`architecture.md`): no component or pattern changes. All fixes are bug-squash inside existing handlers.
- **Epics** (`epics.md`): new `## Epic 11` section appended.
- **Sprint status** (`sprint-status.yaml`): new `epic-11: backlog` block with 4 stories.

### Source files touched

**ObjectScript** (`src/ExecuteMCPv2/…`):
- `REST/Command.cls` — Bug #1 error envelope
- `REST/Security.cls` — Bugs #3, #4, #5, #6 (server side), #10, #12
- `REST/Config.cls` — Bug #2 database size join
- `REST/Monitor.cls` — Bug #9 metrics counters
- `REST/SystemConfig.cls` — Bug #15 locale current
- `Utils.cls` — Bugs #8, #11 sanitization & error wrapping

**TypeScript packages**:
- `packages/iris-dev-mcp/src/tools/search.ts` — Bug #7 default files pattern
- `packages/iris-dev-mcp/src/tools/doc.ts` — Bug #16 description rework
- `packages/iris-data-mcp/src/tools/rest.ts` — Bug #13 scope param + wrapper
- `packages/iris-data-mcp/src/tools/analytics.ts` — Bug #14 horolog → ISO
- `packages/iris-admin-mcp/src/tools/ssl.ts` — Bug #6 (TS side) field rename

**Generated** (auto-updated by `npm run gen:bootstrap`):
- `bootstrap-classes.ts` — `BOOTSTRAP_VERSION` hash bump, picks up all ObjectScript edits from Stories 11.1–11.3.

### Documentation impact

Per the pattern set in Story 10.5 / 10.6 (inline CHANGELOG + README per story, no standalone rollup), each story owns its doc updates. No new tools → no tool counts change → no top-level READMEs mass edit.

Files touched per story:
- **CHANGELOG.md** — new `## [Pre-release — 2026-04-21]` block with `### Fixed` (most bugs) and `### Changed` (SSL field rename, marked **BREAKING** for the pre-release).
- **packages/\*/README.md** — response-shape changes for each affected tool.
- **tool_support.md** — "fields returned" notes for tools whose response shape changed.
- **Top-level README.md** — status callout only; no tool-count changes.

### Secondary artifacts

- **Bootstrap regression guard**: Story 11.3's bootstrap bump should produce a new hash; existing installs auto-upgrade on next MCP server restart.
- **Tests**: each story adds unit tests for its bug fixes (target ~12–15 new tests total across `packages/*/src/__tests__/`).

---

## Section 3 — Recommended Approach

**Option 1: Direct Adjustment** — new Epic 11 with 4 grouped stories.

### Rationale

- Matches Epic 10's shape (pre-existing course-correction precedent).
- Bugs cluster naturally by source file (3 ObjectScript stories + 1 TypeScript story).
- Single `BOOTSTRAP_VERSION` bump at end of Story 11.3 covers all ObjectScript edits in one auto-upgrade — no partial upgrade states.
- Pre-publish window is the right place to break the SSL field shape (`protocols` → `tlsMinVersion`/`tlsMaxVersion`).

### Effort and risk

- **Effort**: Medium. ~4 stories, mostly surgical edits in already-understood handlers. Story 11.2 is the longest (6 bugs in one file) but all are localized.
- **Risk**: Low. No new IRIS classes. No new transport layer. Standard auto-bootstrap upgrade path covers ObjectScript side. TypeScript changes are schema-additive except SSL field rename (explicitly pre-release breaking, marked in CHANGELOG).
- **Timeline**: delays first npm publish by ~1 epic-cycle. Acceptable tradeoff — ship clean rather than ship-then-patch.

### Alternatives considered

- **Option 2 (Rollback)**: no completed work to roll back. N/A.
- **Option 3 (MVP scope reduction)**: not applicable — these are correctness defects, not scope.
- **Sub-option: split ObjectScript bugs across multiple bootstrap bumps** rejected — three upgrades for three stories, no benefit, more risk of partial-state installs.

---

## Section 4 — Detailed Change Proposals

### Epic 11: Post-Publish Bug Fix Batch (IRIS MCP Server Suite)

**Goal**: Fix the 16 defects identified in the 2026-04-21 comprehensive test pass before first npm publish.

**Scope**: Correctness fixes across `ExecuteMCPv2.REST.*` handlers (ObjectScript) and `packages/*/src/tools/*` (TypeScript). One `BOOTSTRAP_VERSION` bump at end of Story 11.3. Inline CHANGELOG + README updates per story (no standalone rollup story — zero new tools).

**Stories**:
- **11.1** — ObjectScript error envelope & sanitization (`Command.cls` + `Utils.cls`) — Bugs #1, #8, #11.
- **11.2** — Security handler completeness (`Security.cls`) — Bugs #3, #4, #5, #6 (server side), #10, #12. SSL response-shape break.
- **11.3** — DB / metrics / config accuracy + BOOTSTRAP_VERSION bump + live verification (`Config.cls` + `Monitor.cls` + `SystemConfig.cls` + `bootstrap-classes.ts`) — Bugs #2, #9, #15.
- **11.4** — TypeScript tool fixes across `iris-dev-mcp`, `iris-data-mcp`, `iris-admin-mcp` — Bugs #6 (TS surface), #7, #13, #14, #16.

**Out of scope (deferred)**:
- Arabic `خطأ` error-text prefix — IRIS server-side locale issue (`araw`); out of scope for tool-level fix. Optional "force English status text" wrapper in `Utils.SanitizeError` deferred.
- Epic 10 deferred items — unchanged (digit-prefixed package rows, `.manifest.json.tmp` leak, synthetic-corpus tests for search, `ctx.ensureNamespacePrereq` helper).

Full acceptance criteria and task breakdowns are appended to `_bmad-output/planning-artifacts/epics.md` under `## Epic 11`.

---

## Section 5 — Implementation Handoff

### Scope classification

**Moderate**:
- New epic entry in `epics.md` (additive, does not restructure earlier epics).
- New `epic-11` block in `sprint-status.yaml`.
- Cross-package source changes (ObjectScript + 3 TypeScript packages).
- One breaking pre-release schema change (SSL field rename — explicitly called out in CHANGELOG).

### Handoff

- **Scrum Master (Bob)** — register Epic 11 in `sprint-status.yaml`, create Story 11.1 via `/bmad-create-story`.
- **Developer (Amelia)** — execute stories sequentially (11.1 → 11.2 → 11.3 → 11.4) following the epic-cycle flow. Each story ships with build + tests + lint green and CHANGELOG entry.
- **Research tool**: Perplexity MCP for IRIS API uncertainty — flagged in individual stories where uncertain (e.g., Story 11.3 Bug #9 correct `%Monitor.System.*` / `$SYSTEM.Monitor` source; Story 11.2 Bug #10 `%All` permission semantics).

### Success criteria

- All 16 bugs have passing unit tests and live-verified reproductions resolved.
- `pnpm turbo run build`, `pnpm turbo run test`, `pnpm turbo run lint` all green across the monorepo.
- `BOOTSTRAP_VERSION` bumped once (end of Story 11.3); auto-upgrade verified on an existing install by restarting MCP server and confirming the new hash takes.
- CHANGELOG, per-package READMEs, `tool_support.md`, and top-level README status callout all reflect Epic 11 fixes.
- Pre-publish smoke test (from Story 9.3) still passes after Epic 11.

### Next steps

1. Write files (this session): `_bmad-output/planning-artifacts/epics.md` (append Epic 11), `_bmad-output/implementation-artifacts/sprint-status.yaml` (add epic-11 block).
2. Hand off to Scrum Master for Story 11.1 creation.
3. Execute epic-cycle normally.
