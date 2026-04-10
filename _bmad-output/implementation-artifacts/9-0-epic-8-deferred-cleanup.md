# Story 9.0: Epic 8 Deferred Cleanup

Status: review

## Story

As a developer,
I want all deferred work items from Epic 8 formally triaged and the triage documented,
so that Epic 9 begins with a clean and explicit backlog state and no deferred item is silently forgotten before the first npm publish.

## Context

Epic 8 (Documentation & Release Preparation) completed on 2026-04-07 with 7/7 stories and a formal retrospective. During beta testing on 2026-04-09, a defect was discovered in Claude Desktop that triggered the creation of Epic 9 (Tool Name Flattening) via `/bmad-correct-course`. See [sprint-change-proposal-2026-04-09.md](../planning-artifacts/sprint-change-proposal-2026-04-09.md).

Per the `/epic-cycle` pipeline Step 0.5, this story formally triages every item in Epic 8's retrospective and in `deferred-work.md` against Epic 9's scope (pre-publish tool-name compatibility fix).

**Triage result:** Every item is either already addressed, already embedded in another Epic 9 story, post-Epic 9 publishing work, or cosmetic/won't-fix. **Zero items require action in Story 9.0** — this story exists as a mandatory documentation artifact to record that triage explicitly.

## Acceptance Criteria

1. **AC1**: The triage tables below are reviewed and verified to match the current state of `epic-8-retro-2026-04-07.md` and `deferred-work.md`. No retrospective action item or deferred work entry is missing from the triage.
2. **AC2**: `deferred-work.md` is updated to append a Story 9.0 closure section that notes which Epic 8 deferred items are being explicitly deferred *to the publishing checklist* (rather than to Epic 9 stories), and which are being retained as cosmetic follow-ups. No code-side closures required — this is a pure documentation update.
3. **AC3**: No source-code, test, or package README changes are made in this story. All tooling-related changes live in Stories 9.1 and 9.2.
4. **AC4**: `turbo build` and `turbo test` still pass (regression check — should be no-op since no source changes).
5. **AC5**: Story 9.0 is committed separately from Story 9.1 to preserve the epic-cycle per-story git history.

## Triage Table — Epic 8 Retrospective Action Items

| # | Source | Item | Decision | Rationale |
|---|---|---|---|---|
| 1 | Retro Post-Project Action #1 | npm publishing session — account, org, package.json fields, publish | **Drop** | This is the activity that happens *after* Epic 9 unblocks it. Post-Epic 9 work, not Epic 9 cleanup. |
| 2 | Retro Post-Project Action #2 | Bootstrap drift check before every publish | **Drop (covered elsewhere)** | Already embedded as an AC in Story 9.2 (`npm run gen:bootstrap` verification). |
| 3 | Retro Post-Project Action #3 | IPM publishing via Open Exchange | **Drop** | Post-Epic 9 publishing path, unrelated to tool-name rename. |
| 4 | Retro Post-Project Action #4 | Consolidate duplicate `getIntegrationConfig` helpers | **Defer** | Cosmetic cleanup. Unrelated to Epic 9 scope. Retained in `deferred-work.md` for future visibility. |
| 5 | Retro Post-Project Action #5 | Extract shared env var docs across client-config guides | **Defer** | Cosmetic/DRY improvement. Unrelated to Epic 9 scope. Retained in `deferred-work.md`. |
| 6 | Retro Follow-Through row | Create test production + integration tests for interopRest/ruleGet/transformTest | **Drop** | Already formally deferred in Epic 8 retro as "too complex for cleanup". Not Epic 9 related. |
| 7 | Retro Follow-Through row | MCP test harness | **Drop** | Already formally deferred in Epic 8 retro as "post-project". Not Epic 9 related. |

## Triage Table — `deferred-work.md` Active Entries

These are the unclosed entries at the bottom of `deferred-work.md` (post-Story-8.0 closures).

| # | Source | Item | Decision | Rationale |
|---|---|---|---|---|
| 1 | Story 8.0 code review | Duplicate `getIntegrationConfig` helper (two files producing same config) | **Defer** | Same as Retro action #4. Cosmetic only. Retained in `deferred-work.md`. |
| 2 | Story 8.1 code review | Per-package README dead links (pointed to files not yet existing) | **Drop (resolved)** | Story 8.2 created the READMEs the links pointed to. Dead-link condition no longer exists. |
| 3 | Story 8.4 code review | DRY env var docs across client-config (`claude-desktop.md`, `claude-code.md`, `cursor.md`) | **Defer** | Same as Retro action #5. Cosmetic only. Retained in `deferred-work.md`. |
| 4 | Story 8.6 code review | Missing `license`, `repository`, `author`, `keywords`, `engines`, `publishConfig` in `package.json` files | **Defer to publishing checklist** | This is a pre-publish readiness requirement already tracked in [`research/publishing-checklist-npm-ipm.md`](../planning-artifacts/research/publishing-checklist-npm-ipm.md) item A2. Belongs to the publishing session, not Epic 9. |

## Tasks / Subtasks

- [x] Task 1: Verify triage coverage (AC: 1)
  - [x] Re-read `_bmad-output/implementation-artifacts/epic-8-retro-2026-04-07.md`
  - [x] Re-read `_bmad-output/implementation-artifacts/deferred-work.md`
  - [x] Cross-check every action item and deferred entry against the two triage tables above
  - [x] If any item is missing from the tables, add it with a decision

- [x] Task 2: Update `deferred-work.md` with Story 9.0 closure section (AC: 2)
  - [x] Append a new section titled `## Triaged via Story 9.0 (2026-04-09)` to `deferred-work.md`
  - [x] For each item in the triage tables above with decision **Drop (resolved)**, mark it as resolved with a reference to Story 9.0 and the resolving story (e.g., Story 8.2 for the dead-link case)
  - [x] For each item with decision **Defer**, add a bullet stating it remains open as a cosmetic follow-up, not tracked by any Epic 9 story
  - [x] For the publishing-related defer (package.json fields), add a bullet explicitly pointing at `research/publishing-checklist-npm-ipm.md` item A2 as the authoritative tracker
  - [x] Do NOT remove or rewrite any existing entries — append only

- [x] Task 3: No source changes verification (AC: 3)
  - [x] Confirm that Task 1 and Task 2 touch only `_bmad-output/implementation-artifacts/9-0-epic-8-deferred-cleanup.md` and `_bmad-output/implementation-artifacts/deferred-work.md`
  - [x] Git status should show only those two files modified (plus any untracked story completion notes)

- [x] Task 4: Regression check (AC: 4)
  - [x] Run `turbo build` at the repo root — must exit 0
  - [x] Run `turbo test` at the repo root — must exit 0
  - [x] No code changes were made, so this should be a clean baseline capture for Story 9.1 to compare against

- [ ] Task 5: Commit (AC: 5) — **deferred to epic-cycle lead per parent-agent instructions**
  - [ ] Stage `_bmad-output/implementation-artifacts/9-0-epic-8-deferred-cleanup.md` and `_bmad-output/implementation-artifacts/deferred-work.md`
  - [ ] Commit with message `docs(story-9.0): Epic 8 deferred cleanup — triage only, zero code changes`
  - [ ] Do NOT commit `sprint-status.yaml` changes yet (the epic-cycle lead will update status after commit)

## Dev Notes

- **This is a documentation-only story.** No source code, no tests, no package READMEs. If the dev agent starts editing files under `packages/`, something has gone wrong — stop and escalate to the lead.
- The triage tables above are the authoritative source. The dev agent should not re-do the triage analysis — the analyst (Mary) did that on 2026-04-09 when the Sprint Change Proposal was written.
- `deferred-work.md` has a specific append-only convention. Do not rewrite existing entries. Add a new section at the bottom.
- Regression check (turbo build + turbo test) is a **baseline capture** — Story 9.1 will compare its post-rename test results against this baseline, so it must pass cleanly with the current codebase (which still has dotted tool names in source).

### Project Structure Notes

- All file operations in this story live under `_bmad-output/implementation-artifacts/`
- No changes to `packages/`, `src/`, or `_bmad-output/planning-artifacts/`
- No changes to `architecture.md`, `prd.md`, or `epics.md` — those were already updated by the analyst on 2026-04-09

### References

- [`epic-8-retro-2026-04-07.md`](epic-8-retro-2026-04-07.md) — Epic 8 retrospective with Post-Project Action Items
- [`deferred-work.md`](deferred-work.md) — active deferred entries from Epic 8 code reviews
- [`sprint-change-proposal-2026-04-09.md`](../planning-artifacts/sprint-change-proposal-2026-04-09.md) — Epic 9 Sprint Change Proposal
- [`epics.md`](../planning-artifacts/epics.md) — Epic 9 definition and stories
- [`research/publishing-checklist-npm-ipm.md`](../planning-artifacts/research/publishing-checklist-npm-ipm.md) — the authoritative tracker for the `license`/`repository`/etc. package.json fields

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context) — dev-story workflow, 2026-04-09

### Debug Log References

None required. Documentation-only story with no code execution.

### Completion Notes List

- **Triage verification (Task 1):** Cross-checked every Epic 8 retrospective action item (5 Post-Project Actions + 2 deferred Follow-Through rows) and every unclosed `deferred-work.md` entry (4 code-review-derived items) against the two authoritative triage tables in this story file. All 11 items are covered. No additions to the tables were needed.
- **Append-only update (Task 2):** Added a new `## Triaged via Story 9.0 (2026-04-09)` section at the bottom of `deferred-work.md`. Existing entries were left untouched. The new section groups items into four categories: Resolved, Retained as cosmetic follow-ups, Deferred to the publishing checklist, and Dropped.
- **No source changes (Task 3):** Verified via `git status --short`. Only `deferred-work.md` and this story file were touched. No files under `packages/`, `src/`, or any `.ts`/`.cls` were modified. The modified `sprint-status.yaml` was pre-existing from epic-cycle Step 0.5 when the story was created — not touched by this dev session.
- **Regression baseline (Task 4):** `npx turbo build` → 6/6 tasks successful (all cached). `npx turbo test` → 12/12 tasks successful. Total test counts across all packages: **51 test files, 993 tests, 0 failures** (shared: 10/185, dev: 10/200, admin: 11/198, interop: 9/161, ops: 7/149, data: 4/100). This is the clean baseline that Story 9.1 will compare its post-rename test results against.
- **Commit deferred:** Task 5 is intentionally left unchecked. Per parent-agent instructions, the epic-cycle lead handles commit/push after code review. Dev agent does not commit or modify `sprint-status.yaml`.

### File List

- `_bmad-output/implementation-artifacts/deferred-work.md` — **Modified** (appended Story 9.0 triage closure section; no existing entries altered)
- `_bmad-output/implementation-artifacts/9-0-epic-8-deferred-cleanup.md` — **Modified** (task checkboxes, Dev Agent Record, status → review)

## Change Log

| Date | Change | Author |
|---|---|---|
| 2026-04-09 | Completed documentation-only triage of Epic 8 deferred items. Appended Story 9.0 closure section to `deferred-work.md`. Regression baseline captured (turbo build 6/6 cached, turbo test 993/993 tests pass). Status → review. | Amelia (dev agent, Claude Opus 4.6) |
