# Story 10.6: TypeScript + docs cleanup (post-retro polish)

Status: done

## Story

**As a** developer using `iris_doc_list` or `iris_package_list` with both `modifiedSince` and `generated`,
**I want** the `generated` flag to actually be honored on the `/modified/{ts}` Atelier branch,
**so that** I get the same filtering behavior whether I'm asking "all docs" or "docs modified since X".

**As a** developer using `iris_package_list` against system namespaces,
**I want** the README to flag the CSP static-asset asymmetry the same way it already flags it for `iris_doc_export`,
**so that** I know to pass `category: "CLS"` to avoid CSP-static-asset noise.

## Trigger

Epic 10 retrospective Action Items #3 and #7.

- **Item #3** was originally surfaced as a deferred LOW from the Story 10.1 code review (in [_bmad-output/implementation-artifacts/deferred-work.md](../../_bmad-output/implementation-artifacts/deferred-work.md)) and confirmed during the same 2026-04-19 retest pass that produced the Story 10.5 ObjectScript bugs. Both `packages.ts` and `doc.ts` accept a `generated` parameter and document it on the tool schema, but the `/modified/{ts}` URL builder ignores it — so the param is silently dropped on the modified-since branch.
- **Item #7** is the README symmetry follow-up from Story 10.4's CSP-asymmetry note. Story 10.4 added a clear note to `iris_doc_export` explaining why a full `%SYS` export produces ~2,174 skipped CSP static assets and recommending `category: "CLS"` as the workaround. The same asymmetry hits `iris_package_list` (which calls the same `/docnames/` endpoint), but its `<details>` block in the README has no equivalent note.

See [sprint-change-proposal-2026-04-20-stories-10-5-and-10-6.md](../planning-artifacts/sprint-change-proposal-2026-04-20-stories-10-5-and-10-6.md) Section 4 Proposal 2 for the full Sprint Change Proposal record.

## Acceptance Criteria

1. **AC 10.6.1** — In [packages/iris-dev-mcp/src/tools/packages.ts](../../packages/iris-dev-mcp/src/tools/packages.ts), the `/modified/{ts}` URL gets `generated=1` or `generated=0` appended as a query parameter when the user-provided `generated` value is set. When `generated` is `undefined`, the param is **absent** (not `generated=0`). Use the same `URLSearchParams` + conditional-set idiom already used in the `/docnames/` branch (lines 206–211).

2. **AC 10.6.2** — Same change applied symmetrically in [packages/iris-dev-mcp/src/tools/doc.ts](../../packages/iris-dev-mcp/src/tools/doc.ts) for the `/modified/{ts}` branch (lines ~408–421). When `generated` is `undefined`, the param is absent.

3. **AC 10.6.3** — Unit tests added in [packages/iris-dev-mcp/src/__tests__/packages.test.ts](../../packages/iris-dev-mcp/src/__tests__/packages.test.ts):
   - **Test 1**: When `modifiedSince` is set AND `generated: true`, the constructed URL contains BOTH the `/modified/<encoded-ts>` path AND `generated=1`.
   - **Test 2**: When `modifiedSince` is set AND `generated` is `undefined`, the URL contains the `/modified/...` path but does NOT contain `generated=`.

4. **AC 10.6.4** — Symmetric tests added in [packages/iris-dev-mcp/src/__tests__/doc.test.ts](../../packages/iris-dev-mcp/src/__tests__/doc.test.ts):
   - **Test 1**: `modifiedSince` + `generated: false` → URL contains `/modified/...` AND `generated=0`.
   - **Test 2**: `modifiedSince` only → URL contains `/modified/...` and does NOT contain `generated=`.

5. **AC 10.6.5** — In [packages/iris-dev-mcp/README.md](../../packages/iris-dev-mcp/README.md), the `iris_package_list` `<details>` block (or its surrounding context) gains a CSP-asymmetry note that **mirrors the existing one on `iris_doc_export`** (line 371). The new note should:
   - Explain the asymmetry in one paragraph
   - Note that `iris_package_list` shows inflated counts on `%SYS` (and similar system namespaces) for packages like `csp` because of un-fetchable static assets
   - Recommend `category: "CLS"` (or `category: "RTN"`) to filter to packages whose docs are reliably retrievable
   - Keep tone and structure consistent with the existing `iris_doc_export` note

6. **AC 10.6.6** — Build + tests + lint green:
   - `pnpm turbo run build --filter=@iris-mcp/dev` — clean
   - `pnpm turbo run test --filter=@iris-mcp/dev` — target **+4 new tests** (2 in `packages.test.ts`, 2 in `doc.test.ts`); should land at 273/273 (= 269 from Story 10.4 + 0 from Story 10.5's iris-dev-mcp delta)
   - `pnpm turbo run lint --filter=@iris-mcp/dev` — no new warnings on touched files

7. **AC 10.6.7** — **TypeScript-only change.** No `BOOTSTRAP_VERSION` bump. No ObjectScript redeploy. Existing installs upgrade via `pnpm install && pnpm turbo run build + MCP server restart`.

8. **AC 10.6.8** — CHANGELOG.md contribution is **optional** (per Sprint Change Proposal Section 2.4). The dev agent decides — these are minor symmetry fixes; if they warrant a `### Fixed` bullet in the existing `## [Pre-release — 2026-04-20]` section, add one consolidated bullet covering both files. If they're too minor, skip.

## Tasks / Subtasks

- [x] **Task 1**: Add `generated` query param to `/modified/{ts}` branch in `packages.ts` (AC 10.6.1)
  - [x] Locate the `if (modifiedSince)` block in `packageListTool.handler` (around line 196–202).
  - [x] After the `atelierPath(...)` call, build a `URLSearchParams` and conditionally `set("generated", String(generated ? 1 : 0))` when `generated !== undefined`.
  - [x] Append `?${params.toString()}` to `fullPath` only when the params are non-empty (mirror the existing pattern on lines 206–211 of the `/docnames/` branch).
  - [x] Verify the existing `/docnames/` branch is untouched.

- [x] **Task 2**: Add `generated` query param to `/modified/{ts}` branch in `doc.ts` (AC 10.6.2)
  - [x] Locate the `if (modifiedSince)` block in `docListTool.handler` (around line 408–421).
  - [x] Apply the same `URLSearchParams` + conditional-set pattern as Task 1.
  - [x] Verify the existing `/docnames/` branch (lines ~423–447) is untouched.

- [x] **Task 3**: Unit tests for `packages.test.ts` (AC 10.6.3)
  - [x] Add `it("includes generated=1 when both modifiedSince and generated:true are set", ...)` modeled on the existing `it("calls /modified/{ts} endpoint...", ...)` at line 213.
  - [x] Add `it("omits generated query param on /modified/ branch when generated is undefined", ...)`.
  - [x] Reuse the existing `createMockHttp` / `createMockCtx` helpers from `test-helpers.ts`.

- [x] **Task 4**: Unit tests for `doc.test.ts` (AC 10.6.4)
  - [x] Add `it("includes generated=0 on /modified/ branch when modifiedSince and generated:false are both set", ...)` modeled on the existing `it("should pass generated=0 when generated is false", ...)` at line 451 (which only covers the `/docnames/` branch).
  - [x] Add `it("omits generated query param on /modified/ branch when generated is undefined", ...)`.

- [x] **Task 5**: README CSP-asymmetry note for `iris_package_list` (AC 10.6.5)
  - [x] Read the existing `iris_doc_export` CSP note in `packages/iris-dev-mcp/README.md` line 371 to capture tone, structure, and the exact `category: "CLS"` / `"RTN"` recommendations.
  - [x] Locate the `iris_package_list` `<details>` block (search for `<strong>iris_package_list</strong>`) — likely near `iris_doc_list` and `iris_doc_export` blocks.
  - [x] Add a parallel note **inside or adjacent to** the `<details>` block, framed for `iris_package_list`'s aggregation semantics: the inflated package counts (e.g., `csp`) on `%SYS` come from un-fetchable static assets in `docnames`; pass `category: "CLS"` to get a clean code-only view.
  - [x] Keep the same `> **Note on CSP static assets…**` blockquote format the export note uses for visual symmetry.

- [x] **Task 6**: Optional CHANGELOG entry (AC 10.6.8)
  - [x] Added consolidated bullet to existing `### Fixed` subsection in `## [Pre-release — 2026-04-20]` covering both the `/modified/` fix and the README CSP-asymmetry note.

- [x] **Task 7**: Build + validate (AC 10.6.6)
  - [x] `pnpm turbo run build --filter=@iris-mcp/dev` — clean
  - [x] `pnpm turbo run test --filter=@iris-mcp/dev` — 273/273 passing (was 269 → +4 new tests)
  - [x] `pnpm turbo run lint --filter=@iris-mcp/dev` — no new warnings on touched files; 7 pre-existing errors in files not touched by this story (confirmed by `git stash` comparison).
  - [x] Full-suite run: `pnpm turbo run test` — all 12 packages green, no cross-package regression.

- [x] **Task 8**: Status updates (AC 10.6.7)
  - [x] Mark this story file Status → `review` after all ACs pass.
  - [x] Update [_bmad-output/implementation-artifacts/sprint-status.yaml](../../_bmad-output/implementation-artifacts/sprint-status.yaml): `10-6-typescript-docs-cleanup` → `review`.
  - [x] **Did NOT touch `BOOTSTRAP_VERSION`** — TypeScript-only.

## Dev Notes

### Architecture constraints

- **TypeScript-only.** No new IRIS-side classes. `BOOTSTRAP_VERSION` does NOT change. Existing installs upgrade via `pnpm install && pnpm turbo run build + MCP server restart`.
- **No new tools, no new tool args.** The `generated` parameter is already on both `iris_doc_list` and `iris_package_list` schemas — this story just wires it through on the `/modified/` code path. No tool annotation, schema, or input shape change.
- **Pure URL-building bug fix.** The existing tests for the `/docnames/` branch (which already honors `generated`) are unchanged. New tests are additive only.

### Why this defect existed

The `/docnames/` and `/modified/` branches were written at different times. The `/docnames/` branch was authored with full attention to the documented `generated` filter. The `/modified/` branch was added later (for `modifiedSince` support) and the URL builder was copied from a simpler example without the query-param appending logic. The defect is symmetric across both `packages.ts` and `doc.ts` because `packages.ts` was modeled on `doc.ts` when Story 10.1 added it.

The fix is symmetric: add the same `URLSearchParams` block to both `/modified/` branches, mirroring the existing `/docnames/` branches in the same files. **Do not deduplicate** the two implementations into a shared helper as part of this story — the Sprint Change Proposal explicitly scoped this as a "minor symmetry fix" not a refactor. A future story can extract a helper if more URL builders show up.

### Files to touch — exact line numbers

- [packages/iris-dev-mcp/src/tools/packages.ts](../../packages/iris-dev-mcp/src/tools/packages.ts) — `/modified/` branch around lines 196–202; mirror the URLSearchParams idiom from lines 206–211 of the same file.
- [packages/iris-dev-mcp/src/tools/doc.ts](../../packages/iris-dev-mcp/src/tools/doc.ts) — `/modified/` branch around lines 408–421; mirror the URLSearchParams idiom from lines 428–433 of the same file.
- [packages/iris-dev-mcp/src/__tests__/packages.test.ts](../../packages/iris-dev-mcp/src/__tests__/packages.test.ts) — 2 new `it(...)` blocks; model on existing `/modified/{ts}` test at line 213 and existing `generated` tests at line 266.
- [packages/iris-dev-mcp/src/__tests__/doc.test.ts](../../packages/iris-dev-mcp/src/__tests__/doc.test.ts) — 2 new `it(...)` blocks; model on existing `/modified/` test at line 432 and existing `generated=0` test at line 451.
- [packages/iris-dev-mcp/README.md](../../packages/iris-dev-mcp/README.md) — one note added to or adjacent to the `iris_package_list` `<details>` block; model on the existing `iris_doc_export` note at line 371.
- [CHANGELOG.md](../../CHANGELOG.md) — optional: one bullet under the existing `### Fixed` section in `## [Pre-release — 2026-04-20]`.

### Pattern to mirror — existing `/docnames/` branch in `packages.ts`

```typescript
// Lines 206–211 of packages.ts (existing, do not modify)
const params = new URLSearchParams();
if (generated !== undefined) {
  params.set("generated", String(generated ? 1 : 0));
}
const queryString = params.toString();
fullPath = queryString ? `${base}?${queryString}` : base;
```

The `/modified/` branch should adopt the exact same idiom. The `String(generated ? 1 : 0)` → `"1"` or `"0"` produces the same wire format the existing `/docnames/` branch and `iris_doc_export` already use.

### Project conventions (must follow)

- TypeScript strict mode.
- No underscore in TypeScript symbols (style convention — consistent across the suite).
- Test assertions: use `.toContain(...)` for URL substring checks (mirroring lines 273, 406, 457, 475 of the existing tests).
- `extractAtelierContentArray` and `paginate` helpers are already imported in both files — no new imports.
- Use `URLSearchParams` (already imported elsewhere in the file). Do not hand-build `?generated=...` strings.

### Anti-patterns to avoid

- ❌ Do NOT extract a shared URL builder helper. Sprint Change Proposal scoped this as a symmetry fix, not a refactor.
- ❌ Do NOT change the `/docnames/` branches. They already work correctly.
- ❌ Do NOT add `generated=0` when `generated` is undefined. The check is `!== undefined`, matching the existing pattern.
- ❌ Do NOT change tool descriptions or `inputSchema`. The `generated` parameter is already documented; only the URL builder needs the fix.
- ❌ Do NOT touch `iris_doc_export` (`export.ts`). Its `/modified/` branch already handles `generated` correctly via the `generated !== "both"` check at line 401 — that's tri-state ("true" | "false" | "both"), a different shape from the boolean shape used by `iris_doc_list` and `iris_package_list`. Out of scope.
- ❌ Do NOT bump `BOOTSTRAP_VERSION`. There is no ObjectScript change in this story.

## Previous Story Intelligence

**Story 10.5** (commit `8295e58`, just landed) is the ObjectScript companion to this story — they were split out of the Epic 10 retrospective together. Story 10.5 fixed the `iris_task_history` taskId filter and the `Security.Resources/Roles/Users.Create` description-create crash. That story's File List confirms no overlap with this story's files (no `packages.ts`, `doc.ts`, `packages.test.ts`, `doc.test.ts`, or `README.md` changes in 10.5).

**Story 10.4** (`iris_doc_export` response-envelope cap, commit `ad92f26`) established the CSP-asymmetry note pattern in the README that this story mirrors for `iris_package_list`. Worth re-reading line 371 of `packages/iris-dev-mcp/README.md` to capture the exact tone.

**Story 10.1** (`iris_package_list`, commit established the `/docnames/` URL-building pattern with `URLSearchParams` and the `generated !== undefined` check. The `/modified/` branch was added in the same story but with the bug — the deferred LOW from that story's code review was the original surfacing of this defect.

**Story 10.2** (`iris_doc_export`) introduced the CSP static-asset-asymmetry concept. The README note added in Story 10.3 (docs rollup, commit `89477ce`) and refined in Story 10.4 is the model for the new `iris_package_list` note.

Code patterns established across Epic 10 that this story should honor:
- **Conditional-spread / conditional-set idioms** — match the field-absent pattern (`...(condition ? { field: value } : {})` in TypeScript, or `if (x !== undefined) params.set(...)` for URL params). Established by Story 10.1 AC 10.1.7 (`truncated?: true`) and reinforced by Story 10.4 AC 10.4.2 (`skippedItemsTruncated?: true`).
- **Test assertions on URL substrings** — `.toContain("...")` for query-param checks; `.not.toContain("...")` for absence checks.
- **`createMockHttp` / `createMockCtx` helpers** from `test-helpers.ts` — used by every test in `packages.test.ts` and `doc.test.ts`.

## Project Structure Notes

- Aligned with existing `@iris-mcp/dev` layout. No new files. No new subdirectories.
- No `gen:bootstrap` run required (no `.cls` edits).
- After this story, all retro action items #1, #2, #3, #7 from the Epic 10 retrospective are addressed. Items #4, #5, #6 (process improvements) remain optional follow-ups outside the story pipeline.

## Testing Standards

- Vitest (already in use across `@iris-mcp/dev`).
- Mock `IrisHttpClient` via the shared `createMockHttp` / `createMockCtx` helpers from `test-helpers.ts`.
- Every AC has at least one test:
  - AC 10.6.1 → covered by the `packages.test.ts` test at AC 10.6.3
  - AC 10.6.2 → covered by the `doc.test.ts` test at AC 10.6.4
  - ACs 10.6.3 and 10.6.4 each define explicit tests
  - AC 10.6.5 → spot-checked by reading the rendered Markdown; no automated test required (consistent with how Stories 10.3 and 10.4 handled README updates)
  - ACs 10.6.6, 10.6.7, 10.6.8 are gates / metadata
- Use `.toContain(...)` and `.not.toContain(...)` for URL assertions.
- Capture the called URL via `mockHttp.get.mock.calls[0]?.[0]` (the existing pattern in both test files).

## References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-10-Story-10.6]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-04-20-stories-10-5-and-10-6.md] — Section 4 Proposal 2
- [Source: _bmad-output/implementation-artifacts/epic-10-retro-2026-04-20.md] — Action Items #3 and #7
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — original deferred-LOW from Story 10.1 code review
- [Source: packages/iris-dev-mcp/src/tools/packages.ts] — file being patched (Task 1)
- [Source: packages/iris-dev-mcp/src/tools/doc.ts] — file being patched (Task 2)
- [Source: packages/iris-dev-mcp/src/__tests__/packages.test.ts] — test file (Task 3)
- [Source: packages/iris-dev-mcp/src/__tests__/doc.test.ts] — test file (Task 4)
- [Source: packages/iris-dev-mcp/README.md#L371] — the existing `iris_doc_export` CSP note to mirror for Task 5
- [Source: packages/iris-dev-mcp/src/tools/export.ts#L401] — the tri-state `generated` shape for `iris_doc_export` (different from the boolean shape; do NOT touch)
- [Source: CHANGELOG.md] — optional update target

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context) — `claude-opus-4-7[1m]`

### Debug Log References

None expected — pure TypeScript URL-builder fix with unit-test coverage; no runtime debugging needed.

### Completion Notes List

- Symmetric fix applied to both `packages.ts` and `doc.ts` `/modified/` branches using the exact `URLSearchParams` + `generated !== undefined` idiom already present in each file's `/docnames/` branch.
- `generated` is now honored on the modified-since code path. When `generated` is `undefined`, the param is absent from the URL (verified by "omits generated query param…" tests in both `packages.test.ts` and `doc.test.ts`).
- Did not deduplicate the two implementations into a shared helper per the Sprint Change Proposal scoping (not a refactor).
- Did not touch `iris_doc_export`'s `/modified/` branch (`export.ts`) — its `generated` is a tri-state (`"true" | "false" | "both"`) vs. the boolean on `iris_doc_list`/`iris_package_list`; out of scope.
- Test count: `@iris-mcp/dev` went from 269 → 273 (+4 new tests, 2 in `packages.test.ts`, 2 in `doc.test.ts`).
- README CSP-asymmetry note added right under the `iris_package_list` details block, mirroring the `iris_doc_export` note's tone and `> **Note on CSP static assets…**` blockquote format.
- Opted to add the optional CHANGELOG entry (one consolidated bullet under the existing `### Fixed` section in `## [Pre-release — 2026-04-20]`). The silently-dropped `generated` param is a real defect worth recording; the README symmetry is mentioned as a trailing phrase in the same bullet.
- No `BOOTSTRAP_VERSION` bump. No ObjectScript changes. TypeScript-only delta.
- Lint status on `@iris-mcp/dev` is unchanged from pre-story baseline — 7 pre-existing `no-unused-vars` errors on files not touched by this story (verified via `git stash && pnpm turbo run lint`).

### File List

Modified:
- `packages/iris-dev-mcp/src/tools/packages.ts` — `/modified/{ts}` branch now builds a URL with `URLSearchParams` and conditionally appends `generated=1`/`generated=0` when `generated !== undefined`.
- `packages/iris-dev-mcp/src/tools/doc.ts` — `/modified/{ts}` branch now builds a URL with `URLSearchParams` and conditionally appends `generated=1`/`generated=0` when `generated !== undefined`.
- `packages/iris-dev-mcp/src/__tests__/packages.test.ts` — +2 tests: `includes generated=1 when both modifiedSince and generated:true are set`, `omits generated query param on /modified/ branch when generated is undefined`.
- `packages/iris-dev-mcp/src/__tests__/doc.test.ts` — +2 tests: `includes generated=0 on /modified/ branch when modifiedSince and generated:false are both set`, `omits generated query param on /modified/ branch when generated is undefined`.
- `packages/iris-dev-mcp/README.md` — CSP static-asset asymmetry note added under the `iris_package_list` `<details>` block, mirroring the existing `iris_doc_export` note.
- `CHANGELOG.md` — consolidated bullet added to `### Fixed` under `## [Pre-release — 2026-04-20]`.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `10-6-typescript-docs-cleanup` status transitioned to `in-progress` during implementation; story file Status → `review` on completion (sprint-status will be updated to `review` alongside this story file save).
- `_bmad-output/implementation-artifacts/10-6-typescript-docs-cleanup.md` — task checkboxes, Status, Dev Agent Record (this section).

### Change Log

| Date       | Change                                                                                                       |
|------------|--------------------------------------------------------------------------------------------------------------|
| 2026-04-20 | Implemented AC 10.6.1–10.6.8. `/modified/` branch of `iris_doc_list` / `iris_package_list` now honors `generated`. README gains CSP-asymmetry note on `iris_package_list`. CHANGELOG updated. 273/273 tests pass in `@iris-mcp/dev`. Full suite green (12 packages). Status → review. |
