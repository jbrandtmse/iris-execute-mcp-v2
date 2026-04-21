---
date: 2026-04-20
trigger_type: post-retro-cleanup
scope_classification: Minor
status: Approved
handoff: Development team
parent_epic: Epic 10
new_stories: [10.5, 10.6]
related_artifacts:
  - docs/known-bugs-2026-04-20.md
  - _bmad-output/implementation-artifacts/epic-10-retro-2026-04-20.md
---

# Sprint Change Proposal — 2026-04-20 (Stories 10.5 + 10.6)

## Post-Epic-10-Retro Cleanup Pass — Items 1, 2, 3, 7

---

## Section 1 — Issue Summary

### What triggered this change

The Epic 10 retrospective ([epic-10-retro-2026-04-20.md](../implementation-artifacts/epic-10-retro-2026-04-20.md)) closed Epic 10 cleanly but identified seven action items. Of those, four are well-scoped and the user has approved addressing them now:

1. **`iris_task_history` `taskId` filter is silently ignored** — pre-Epic-10 defect in our REST handler. Documented end-to-end in [docs/known-bugs-2026-04-20.md](../../docs/known-bugs-2026-04-20.md#bug-1--iris_task_history-taskid-parameter-is-silently-ignored). Surfaced because the retest pass enabled live verification that mocked tests can't catch.
2. **`iris_resource_manage` and `iris_role_manage` `create` with `description` argument crashes** with `<UNDEFINED>Create *Description`. Same documentation source. Same retest-surfacing.
3. **`iris_package_list` (and `iris_doc_list`) ignore the `generated` query param on the `/modified/{ts}` Atelier branch** — deferred LOW from Story 10.1 code review, [logged in deferred-work.md](../implementation-artifacts/deferred-work.md). Symmetric inconsistency that deserves a tiny fix in both tools at once.
7. **README CSP-symmetry note for `iris_package_list`** — Story 10.4 added a CSP-asymmetry callout to the `iris_doc_export` README block; the same note belongs on `iris_package_list` for discoverability symmetry.

### Items NOT in scope this pass

The retro identified seven action items total. Items 4 ("digit-prefixed package rows"), 5 (".manifest.json.tmp leak"), 6 ("Epic 9 retrospective"), 8 ("iris_doc_search synthetic-corpus test"), and 10 ("ctx.ensureNamespacePrereq helper extraction") are intentionally deferred — all are LOW or COSMETIC per the retro's analysis. Item 9 (Epic 9 retrospective) is a process item, not a code change, and remains a standing offer.

### Issue type

**Pre-Epic-10 defects + post-Epic-10 polish** — none of these items are new requirements; they're either bugs against existing functionality (1, 2, 3) or documentation symmetry (7). Item 4 of the source-bug taxonomy: "Failed approach requiring different solution" doesn't apply; these are misuse of IRIS API contracts (1, 2) and an inconsistency in our own URL-building code (3).

### Evidence

Both code-side bugs (1, 2) reproduced live this morning at the same IRIS instance the retest pass used:

- **IRIS version**: `IRIS for Windows (x86-64) 2025.1 (Build 230.2U) Wed Jun 4 2025 18:53:21 EDT` (per `iris_server_info.content.version`)
- **Atelier API**: v8
- **MCP suite commit at reproduction**: `a813685` (Epic 10 retro)
- **Bootstrap version deployed**: `5ffd4dee0649`

Captured error text and exact reproduction steps for items 1 and 2 are in [docs/known-bugs-2026-04-20.md](../../docs/known-bugs-2026-04-20.md). Item 3's evidence is in the deferred-work.md entry from the Story 10.1 code review. Item 7 is a documentation gap observable by reading the package README.

---

## Section 2 — Impact Analysis

### Epic impact

- **Epic 10**: reopens `done → in-progress` until Stories 10.5 and 10.6 ship, then re-closes. The retrospective stays `done` (we already ran it).
- **Epics 1–9**: untouched.
- **Stories 10.1–10.4**: untouched.

### Story impact

- Two net-new stories in Epic 10: 10.5 (ObjectScript handler bug fixes) and 10.6 (TypeScript + docs cleanup).
- The split is by deployment surface: 10.5 changes ObjectScript and triggers a `BOOTSTRAP_VERSION` bump (auto-upgrades existing installs); 10.6 is TypeScript + docs only (rebuild + MCP restart).

### Artifact conflicts

| Artifact | Impact |
|---|---|
| [prd.md](prd.md) | **No change**. All four items are bug fixes against existing FRs (FR89 task scheduling, FR48 role management, FR50/FR52 resource management, FR108 package listing). |
| [epics.md](epics.md) | Epic 10 Stories bullet gains 10.5 and 10.6; two new story blocks appended after Story 10.4. |
| [architecture.md](architecture.md) | No change. |
| [README.md](README.md) | No change. |
| [packages/iris-dev-mcp/README.md](../../packages/iris-dev-mcp/README.md) | One `<details>` block (or surrounding context) for `iris_package_list` gains a CSP-asymmetry note (Story 10.6). |
| [tool_support.md](tool_support.md) | No change. |
| [CHANGELOG.md](CHANGELOG.md) | Two new bullets in the existing `## [Pre-release — 2026-04-20]` `### Fixed` section, contributed by Story 10.5. Story 10.6 contributes optionally — at the dev agent's discretion (the changes are minor symmetry fixes; the dev agent decides if they warrant a separate bullet). |

### Technical impact

- **Story 10.5**:
  - Modifies [src/ExecuteMCPv2/REST/Task.cls](../../src/ExecuteMCPv2/REST/Task.cls) `TaskHistory()` (~5 LOC change to switch named queries based on `tTaskId`)
  - Modifies [src/ExecuteMCPv2/REST/Security.cls](../../src/ExecuteMCPv2/REST/Security.cls) `ResourceManage()` and `RoleManage()` (~3 LOC change in each `create` branch to use positional scalar args instead of byref array)
  - **`BOOTSTRAP_VERSION` bumps** to a new hash; existing installs auto-upgrade via the version-stamped probe path.
  - Adds ~3 unit tests (1 per affected tool: task, resource, role).
- **Story 10.6**:
  - Modifies [packages/iris-dev-mcp/src/tools/packages.ts](../../packages/iris-dev-mcp/src/tools/packages.ts) and [packages/iris-dev-mcp/src/tools/doc.ts](../../packages/iris-dev-mcp/src/tools/doc.ts) `/modified/` branches (~5 LOC each to add `generated` query param)
  - Modifies [packages/iris-dev-mcp/README.md](../../packages/iris-dev-mcp/README.md) (one note added to `iris_package_list` `<details>` block)
  - **No `BOOTSTRAP_VERSION` change.** TypeScript-only.
  - Adds ~4 unit tests (2 in `doc.test.ts` + 2 in `packages.test.ts`).
- **Combined target**: 269 → 275–276 tests pass.

---

## Section 3 — Recommended Approach

### Selected path: Direct Adjustment — append Stories 10.5 and 10.6 to Epic 10

| Option | Verdict | Rationale |
|---|---|---|
| **Option 1 (chosen) — Direct Adjustment under Epic 10** | Viable | Two-story split by deployment surface (ObjectScript vs TypeScript) maps to clean PR boundaries. Epic 10 is the natural home — Story 10.4 already established the precedent of post-retro additions under the same epic. |
| **Option 2 — New Epic 11** | Viable but heavier | Cleaner narrative but adds ceremony for what's a small batch of cleanup work. The retro process showed Epic 10 is the right scope for these fixes (they all live in code Epic 10 lit up via testing). |
| **Option 3 — Standalone fix-bundle without epic ceremony** | Viable but lighter | Like the 2026-04-19 bug-fix pass that bundled 6 fixes into commits without a formal epic. Fast but skips the structured /bmad-create-story → /bmad-dev-story → /bmad-code-review pipeline that's been working well across Epic 10. |

User selected Option 1 with two-story split.

### Effort, risk, timeline

- **Effort**: Low. Story 10.5: ~10 LOC + 3 tests. Story 10.6: ~10 LOC + 4 tests + 1 README paragraph.
- **Risk**: Low.
  - Story 10.5: ObjectScript fix verified live against real IRIS. Both bugs have documented root causes pointing at exact lines. Auto-upgrade path established and tested across two prior `BOOTSTRAP_VERSION` bumps.
  - Story 10.6: Pure TypeScript symmetry fix + docs. No deployment risk. Existing tests cover the `/modified/` branch already; new tests just add `generated`-param assertions.
- **Timeline**: Two short sprints' worth of effort. Each story independently committable.

---

## Section 4 — Detailed Change Proposals

### Proposal 1 — Story 10.5 block in [epics.md](epics.md)

```markdown
### Story 10.5: ObjectScript handler bug fixes (post-retro cleanup)

**As a** developer using `iris_task_history`, `iris_resource_manage`, or `iris_role_manage`,
**I want** the documented input parameters to actually work,
**so that** I can filter task history by task ID and create resources/roles with descriptions, instead of silently getting unfiltered results or hitting `<UNDEFINED>` errors.

**Trigger**: Two pre-Epic-10 defects in our `ExecuteMCPv2.REST.*` handlers, surfaced during the 2026-04-19 manual retest pass and documented in [docs/known-bugs-2026-04-20.md](../../docs/known-bugs-2026-04-20.md). Epic 10 retro Action Items #1 and #2.

**Acceptance Criteria**:

- **AC 10.5.1** — `iris_task_history` with `taskId: <id>` filters to that task only. The `TaskHistory()` classmethod in [src/ExecuteMCPv2/REST/Task.cls](../../src/ExecuteMCPv2/REST/Task.cls) selects `%SYS.Task.History:TaskHistoryForTask(Task)` named query (line 148 of `%SYS.Task.History.cls`) when `tTaskId` is set, and the existing `TaskHistoryDetail(NULL)` query when `tTaskId` is empty. Existing pagination/cap behavior unchanged.
- **AC 10.5.2** — Field-name extraction in `TaskHistory()` works against BOTH named queries (the ROWSPECs differ in column order but both expose the field names the handler reads via `tRS.Get("Task Name")`, `tRS.Get("Task")`, etc.). Verify by inspection of `%SYS.Task.History.cls` ROWSPECs at lines 148 and 170.
- **AC 10.5.3** — `iris_resource_manage create` with a `description` argument succeeds. The `ResourceManage()` classmethod in [src/ExecuteMCPv2/REST/Security.cls](../../src/ExecuteMCPv2/REST/Security.cls) calls `Security.Resources.Create(tName, tDescription, tPublicPermission)` with positional scalars (extracted via `$Get(tProps("Description"))` etc.), NOT `Create(tName, .tProps)` with a byref array. The byref-array call pattern is correct for `Modify` and `Get` (which take `ByRef Properties`), but `Create` takes `Description As %String` as positional arg #2.
- **AC 10.5.4** — `iris_role_manage create` with a `description` argument succeeds. Same fix pattern as AC 10.5.3 applied to `RoleManage()` calling `Security.Roles.Create()` — verify the exact positional argument order in `%SYS:Security.Roles.cls` before fixing (likely `Name, Description, Resources, GrantedRoles` per IRIS conventions, but confirm).
- **AC 10.5.5** — Unit tests added in `packages/iris-ops-mcp/src/__tests__/task.test.ts`, `packages/iris-admin-mcp/src/__tests__/resource.test.ts`, `packages/iris-admin-mcp/src/__tests__/role.test.ts` per the Tasks list.
- **AC 10.5.6** — Live verification (post-bootstrap-upgrade): re-run the reproductions in [docs/known-bugs-2026-04-20.md](../../docs/known-bugs-2026-04-20.md). `iris_task_history({ taskId: <real-id>, maxRows: 10 })` returns only rows for that task. `iris_resource_manage({ action: "create", name: "MCPTestStory105", description: "test" })` succeeds. Same for `iris_role_manage`. Clean up created assets after verification.
- **AC 10.5.7** — `BOOTSTRAP_VERSION` bumps to a new hash; existing installs auto-upgrade via the version-stamped probe on next MCP server restart. The upgrade redeploys + recompiles all 13 handler classes per the standard auto-upgrade flow.
- **AC 10.5.8** — CHANGELOG.md gets two new bullets appended to the existing `## [Pre-release — 2026-04-20]` `### Fixed` section (between the existing `iris_doc_export` cap fix and the `iris_execute_tests ^UnitTestRoot` fix). Each bullet references the relevant `src/ExecuteMCPv2/REST/*.cls` file and the issue.
- **AC 10.5.9** — Build + tests + lint green: `pnpm turbo run build`, `pnpm turbo run test`, `pnpm turbo run lint`.

**Tasks** (per Section 4 Proposal 1 of this document — see above for full list).
```

### Proposal 2 — Story 10.6 block in [epics.md](epics.md)

```markdown
### Story 10.6: TypeScript + docs cleanup (post-retro polish)

**As a** developer using `iris_doc_list` or `iris_package_list` with `modifiedSince` and a `generated` filter,
**I want** the `generated` flag to actually be honored on the `/modified/{ts}` Atelier branch,
**so that** I get the same filtering behavior whether I'm asking "all docs" or "docs modified since X".

**As a** developer using `iris_package_list` against system namespaces,
**I want** the README to flag the CSP static-asset asymmetry the same way it flags it for `iris_doc_export`,
**so that** I know to pass `category: "CLS"` to avoid the noise.

**Trigger**: Epic 10 retro Action Items #3 and #7. Item #3 was originally surfaced as a deferred LOW from the Story 10.1 code review (in [_bmad-output/implementation-artifacts/deferred-work.md](../../_bmad-output/implementation-artifacts/deferred-work.md)). Item #7 is the README symmetry follow-up from Story 10.4's CSP-asymmetry note.

**Acceptance Criteria**:

- **AC 10.6.1** — In `packages/iris-dev-mcp/src/tools/packages.ts` and `packages/iris-dev-mcp/src/tools/doc.ts`, the `/modified/{ts}` URL gets `generated=1` or `generated=0` as a query param when the user-provided value is set. When `generated` is undefined, do NOT add the param.
- **AC 10.6.2** — Unit tests in `packages.test.ts` and `doc.test.ts` assert that when `modifiedSince` AND `generated` are both set, the constructed URL contains BOTH the `/modified/<encoded-ts>` path AND the `generated=1` (or `0`) query param. Also assert when `generated` is omitted, the param is absent.
- **AC 10.6.3** — In `packages/iris-dev-mcp/README.md`, the `iris_package_list` `<details>` example block (or surrounding context) gains a CSP-asymmetry note mirroring the existing one on `iris_doc_export`.
- **AC 10.6.4** — Build + tests + lint green.
- **AC 10.6.5** — TypeScript-only change. No `BOOTSTRAP_VERSION` bump.

**Tasks** (per Section 4 Proposal 2 of this document — see above for full list).
```

### Proposal 3 — Epic 10 Stories bullet update in [epics.md](epics.md)

```diff
 **Stories**:
 - 10.1 `iris_package_list` — package listing with depth + prefix
 - 10.2 `iris_doc_export` — bulk download to disk
 - 10.3 Documentation rollup (README suite + per-package + tool_support.md + CHANGELOG)
 - 10.4 `iris_doc_export` response-envelope cap (post-merge bug-fix)
+- 10.5 ObjectScript handler bug fixes (post-retro cleanup) — taskId filter, resource/role description
+- 10.6 TypeScript + docs cleanup (post-retro polish) — generated flag on /modified/, README CSP symmetry
```

### Proposal 4 — sprint-status.yaml updates

```diff
   epic-10: done
   10-1-iris-package-list: done
   10-2-iris-doc-export: done
   10-3-documentation-rollup: done
   10-4-doc-export-response-cap: done
+  10-5-objectscript-handler-bug-fixes: backlog
+  10-6-typescript-docs-cleanup: backlog
   epic-10-retrospective: done
```

After 10.5 and 10.6 land: `epic-10` flips back to `done`. Retrospective stays `done`.

### Proposal 5 — No PRD change (explicit non-edit)

All four items are bug fixes against existing FRs:
- FR89 (task scheduling — `iris_task_history`): the filter behavior is implied by the documented `taskId?` parameter, not a new functional addition.
- FR50 (role management) and FR52 (resource management): the `description` argument is part of the documented input shape.
- FR108 (package listing): the `generated` parameter is part of the documented filter surface.

No new functional requirements — only correct implementation of existing ones.

---

## Section 5 — Implementation Handoff

### Scope classification

**Minor** — direct implementation by the development team. Two stories, both small.

### Recipients

- **Story 10.5**: Any developer familiar with the `ExecuteMCPv2.REST.*` ObjectScript handlers and the `Security.*` IRIS API.
- **Story 10.6**: Any developer familiar with `packages/iris-dev-mcp/src/tools/*` and the test patterns in `packages.test.ts` / `doc.test.ts`.

### Sequencing

1. **Story 10.5 first** (more user-impact, includes BOOTSTRAP_VERSION bump). Existing installs auto-upgrade and bug fixes are immediately effective.
2. **Story 10.6 second** (lower-risk TS+docs polish). Independent of 10.5; could run in parallel if separate developers.

### Success criteria

- **Story 10.5**:
  - `iris_task_history({ taskId: 1000, maxRows: 10 })` returns only rows for task 1000 (not the unfiltered 10 from before).
  - `iris_resource_manage({ action: "create", name: "MCPTestStory105", description: "test" })` returns success (not `<UNDEFINED>Create *Description`).
  - Same for `iris_role_manage`.
  - Build + test + lint green; ~3 new tests.
  - BOOTSTRAP_VERSION changes; existing installs auto-upgrade on next MCP server restart.
- **Story 10.6**:
  - `iris_doc_list({ modifiedSince: "2026-01-01T00:00:00Z", generated: true })` produces a URL containing `generated=1`.
  - Same for `iris_package_list`.
  - README has the CSP note on `iris_package_list`.
  - Build + test + lint green; ~4 new tests.

### Deliverables checklist

**Story 10.5**:
- [ ] `src/ExecuteMCPv2/REST/Task.cls` — switch named queries based on `tTaskId`
- [ ] `src/ExecuteMCPv2/REST/Security.cls` — positional-scalar `Create` calls
- [ ] `packages/iris-ops-mcp/src/__tests__/task.test.ts` — 1 new test
- [ ] `packages/iris-admin-mcp/src/__tests__/resource.test.ts` — 1 new test
- [ ] `packages/iris-admin-mcp/src/__tests__/role.test.ts` — 1 new test
- [ ] `packages/shared/src/bootstrap-classes.ts` — regenerated (BOOTSTRAP_VERSION bump)
- [ ] `CHANGELOG.md` — 2 bullets
- [ ] `_bmad-output/planning-artifacts/epics.md` — Story 10.5 block + bullet update
- [ ] `_bmad-output/implementation-artifacts/sprint-status.yaml` — 10-5 entry, epic-10 → in-progress

**Story 10.6**:
- [ ] `packages/iris-dev-mcp/src/tools/packages.ts` — generated query param on /modified/ branch
- [ ] `packages/iris-dev-mcp/src/tools/doc.ts` — same
- [ ] `packages/iris-dev-mcp/src/__tests__/packages.test.ts` — 2 new tests
- [ ] `packages/iris-dev-mcp/src/__tests__/doc.test.ts` — 2 new tests
- [ ] `packages/iris-dev-mcp/README.md` — CSP note on iris_package_list
- [ ] `_bmad-output/planning-artifacts/epics.md` — Story 10.6 block (already done by this proposal)
- [ ] `_bmad-output/implementation-artifacts/sprint-status.yaml` — 10-6 entry

### No cross-server or breaking-change concerns

- Story 10.5 fixes break NO existing API contracts — they make documented contracts actually work.
- Story 10.6 fix is purely additive (a query param that wasn't being sent now is sent).
- README change is documentation; no code runtime impact.
- BOOTSTRAP_VERSION change in 10.5 → existing installs auto-upgrade per the established pattern; no operator action required.
