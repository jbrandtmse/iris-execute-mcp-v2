# Story 10.4: `iris_doc_export` response-envelope cap (post-merge bug-fix)

Status: done

## Story

As an AI client calling `iris_doc_export` against a namespace with many per-file failures,
I want the response envelope to stay under the MCP token cap,
so that I can read the exporter's return value even when `skippedItems` is large (e.g., a `%SYS` export where the 2,174 CSP static-asset 404s blow past 560 KB).

## Trigger

Discovered 2026-04-20 during a post-Epic-10 stress test — exporting all of `%SYS` produced a **559,724-character response** that exceeded the MCP token cap. The caller could not read the result; the on-disk manifest was correct and authoritative. Same defect class as the `iris_task_history` pagination fix from the 2026-04-19 bug-fix pass. See [sprint-change-proposal-2026-04-20-story-10-4.md](../planning-artifacts/sprint-change-proposal-2026-04-20-story-10-4.md) for the full analysis.

## Acceptance Criteria

1. **AC 10.4.1** — Response envelope's `skippedItems[]` is capped at **50 entries**. New module-level constant `RESPONSE_SKIPPED_CAP = 50` in [packages/iris-dev-mcp/src/tools/export.ts](../../packages/iris-dev-mcp/src/tools/export.ts).

2. **AC 10.4.2** — When the cap is hit, the response gains a `skippedItemsTruncated: true` field and the first `content[0].text` line prefixes the summary with "`N skipped items; showing first 50. Full list in manifest.json`". When the cap is not hit, `skippedItemsTruncated` is **absent** (not `false`) — matches the existing `truncated` pattern from `iris_package_list` AC 10.1.7.

3. **AC 10.4.3** — `manifest.json` stays **uncapped**. The manifest is the authoritative record; capping it would defeat the purpose. Verified via a test case that asserts `manifest.skipped.length === 60` when 60 failures are injected.

4. **AC 10.4.4** — The `iris_doc_export` tool `description` field (zod schema, line ~199 in `export.ts`) gains **one sentence** flagging the CSP static-asset asymmetry:
   > "Note: some namespaces include CSP static assets (e.g., `/csp/.../*.css`) in docnames but return 404 on fetch — pass `category: \"CLS\"` or `\"RTN\"` to exclude them."

   Keep it to one sentence. AI clients read the description inline.

5. **AC 10.4.5** — Unit tests in [packages/iris-dev-mcp/src/__tests__/export.test.ts](../../packages/iris-dev-mcp/src/__tests__/export.test.ts) cover:
   - **Large skipped list (>50 items)** — response has first 50 items + `skippedItemsTruncated: true`; summary text starts with the "`N skipped items; showing first 50`" prefix; manifest file on disk has all 60 entries.
   - **Small skipped list (≤50 items)** — response has all items; `skippedItemsTruncated` field is absent (not `false`).
   - Both tests use injected per-file failures (follow the pattern from existing `ignoreErrors` tests in the file).

6. **AC 10.4.6** — [CHANGELOG.md](../../CHANGELOG.md) — append a `### Fixed` subheading inside the existing `## [Pre-release — 2026-04-20]` section (which currently has only `### Added — Epic 10:...`). Do NOT create a new date block. One bullet:
   > **`iris_doc_export` response-envelope cap** — surfaced during a post-merge stress test of the `%SYS` namespace (2,174 CSP static-asset 404s produced a 560 KB response that exceeded the MCP token cap). Response now caps `skippedItems[]` at 50 entries and signals with `skippedItemsTruncated: true`; the full list stays in the authoritative on-disk `manifest.json`.

7. **AC 10.4.7** — Build + tests + lint green: `pnpm turbo run build --filter=@iris-mcp/dev`, `pnpm turbo run test --filter=@iris-mcp/dev` (target: **269/269** = 267 baseline + 2 new), `pnpm turbo run lint --filter=@iris-mcp/dev` (no new warnings on touched files).

## Tasks / Subtasks

- [x] **Task 1**: Cap `skippedItems[]` in the response (AC 10.4.1, 10.4.2)
  - [x] Added module-level constant `const RESPONSE_SKIPPED_CAP = 50;` in `export.ts` alongside the other constants.
  - [x] Happy-path response assembly now slices `skippedItems` to the cap and conditionally spreads `skippedItemsTruncated: true`.
  - [x] Summary text gains the `"N skipped items; showing first 50. Full list in manifest.json."` prefix when truncated; falls back to the original `(N skipped)` suffix otherwise.
  - [x] Same cap applied to the `hardError` (`isError: true`, `partial: true`) branch.
  - [x] `writeManifest()` unaffected — the full `skippedItems` array is still passed in verbatim; manifest stays authoritative and uncapped.

- [x] **Task 2**: Extend the `ExportResult` interface (AC 10.4.2)
  - [x] Added `skippedItemsTruncated?: true` (literal type, not `boolean`) to the interface.

- [x] **Task 3**: Tool description update (AC 10.4.4)
  - [x] Appended the CSP-asymmetry sentence to the zod `description` on `docExportTool`.

- [x] **Task 4**: Unit tests (AC 10.4.5)
  - [x] Added `it("caps skippedItems at 50 in the response but keeps all in the manifest when >50 items are skipped", ...)` — 60 injected failures, asserts 50-item response array + `skippedItemsTruncated: true` + 60 in manifest + summary prefix match.
  - [x] Added `it("omits skippedItemsTruncated when skipped list fits within cap", ...)` — 10 failures, asserts full-list response and `"skippedItemsTruncated" in sc === false`.
  - [x] Reused existing `beforeEach` / `afterEach` tmp-dir plumbing.
  - [x] Extended the local `ExportResult` shape in the test file so the new `skippedItemsTruncated?: true` field type-checks.

- [x] **Task 5**: CHANGELOG (AC 10.4.6)
  - [x] Inserted `### Fixed` subheading with the specified bullet into the existing `## [Pre-release — 2026-04-20]` section (above the next dated block).

- [x] **Task 6**: Build + validate (AC 10.4.7)
  - [x] `pnpm turbo run build --filter=@iris-mcp/dev` — clean.
  - [x] `pnpm turbo run test --filter=@iris-mcp/dev` — **269/269** pass (26 export tests, up from 24).
  - [x] `pnpm turbo run lint --filter=@iris-mcp/dev` — no new errors on `export.ts` or `export.test.ts`. (7 pre-existing baseline errors remain on unrelated files: `doc.test.ts`, `format.test.ts`, `intelligence.test.ts`, `server.test.ts`, `sql.test.ts`, `custom-rest.integration.test.ts` — all unused-var nits predating this story.)

## Dev Notes

### Architecture constraints

- **TypeScript-only**. No new IRIS-side classes. `BOOTSTRAP_VERSION` does NOT change. Existing installs upgrade via `pnpm install && pnpm turbo run build + MCP restart`.
- **Response shape is backward-compatible.** Callers that already handled `skippedItems[]` keep working — they just see fewer entries when the list is long. The new `skippedItemsTruncated` field is optional (absent when no truncation); clients ignore it until they want to notice.
- **Manifest is unchanged.** The `manifest.json` on disk carries the full list, always. No test or implementation change to the manifest writer.

### Pattern to mirror — `iris_task_history` (2026-04-19 fix)

The pagination fix from Story 10.2's predecessor bug-fix pass uses the same structural solution:
- Server-side cap at a constant
- Authoritative full list lives elsewhere (there: the query; here: the manifest on disk)
- `truncated` / `skippedItemsTruncated` boolean signal (absent when no truncation)
- Summary message acknowledges the cap and points the caller to the full record

Files to skim for reference:
- [packages/iris-ops-mcp/src/tools/task.ts](../../packages/iris-ops-mcp/src/tools/task.ts) — see how `iris_task_history` handles its cap
- [src/ExecuteMCPv2/REST/Task.cls](../../src/ExecuteMCPv2/REST/Task.cls) — the server-side cap it pairs with (N/A here — our cap is purely TypeScript)

### Cap value rationale

**50** was chosen because:
- On the observed `%SYS` export, 2,174 skipped items produced 560 KB. Linear extrapolation: 50 items ≈ 13 KB. Well under the MCP token cap (~500 KB practical budget for response envelopes).
- Big enough to let a human or AI client see the pattern of what's being skipped (similar prefixes, similar reasons cluster together).
- Small enough that even pathological long-docName edge cases don't explode the envelope.

If the cap turns out to be wrong in practice, it's a single constant change — not a contract change. A future story can make it configurable via input param if demand arises.

### Files to touch — exact line numbers

- [packages/iris-dev-mcp/src/tools/export.ts](../../packages/iris-dev-mcp/src/tools/export.ts) — 3 edits:
  - Lines 46–58 area: add `RESPONSE_SKIPPED_CAP` constant.
  - Lines 88–98 area: add `skippedItemsTruncated?: true` to the `ExportResult` type.
  - Lines ~656–665: cap in the hardError partial-result assembly.
  - Lines ~717–728: cap in the happy-path result assembly.
  - Lines ~730–734: update the summary text when truncated.
  - Tool description around line ~260: append CSP sentence.
- [packages/iris-dev-mcp/src/__tests__/export.test.ts](../../packages/iris-dev-mcp/src/__tests__/export.test.ts) — 2 new `it(...)` blocks.
- [CHANGELOG.md](../../CHANGELOG.md) — append `### Fixed` block to 2026-04-20 section.

### Project conventions (must follow)

- TypeScript strict mode. `skippedItemsTruncated?: true` (literal type) — when you add a field like this, the conditional spread in the return statement ensures the field is omitted entirely rather than set to `false`, matching the `truncated?: true` pattern in `packages.ts`.
- No underscore in TypeScript symbols (style convention — not an ObjectScript constraint, but we've been consistent).
- Test assertions: use `.toBe(…)` and `.toMatchObject(…)` — follow the patterns already in `export.test.ts`.

### Anti-patterns to avoid

- ❌ Do NOT add a configurable cap parameter to the tool schema. The sprint change proposal explicitly deferred this as speculative.
- ❌ Do NOT cap the manifest's `skipped[]` array. The manifest is the authoritative record; capping it would lose data.
- ❌ Do NOT emit `skippedItemsTruncated: false` when the list fits. Keep the field absent to match the `iris_package_list` `truncated?: true` pattern.
- ❌ Do NOT forget to apply the same cap to the `hardError` (`ignoreErrors: false`) partial-result branch at line ~656. Both response paths need the cap.
- ❌ Do NOT change the `files[]` array handling. Only `skippedItems[]` is in scope for this story — the per-file happy-path list is already bounded by normal use (and, per the Sprint Change Proposal, "`files[]` is already fine because the response doesn't include per-file paths by default; only counts" — worth verifying in passing, but don't block on it).

## Previous Story Intelligence

**Story 10.2** (`iris_doc_export` — commit `6732b21`) introduced this tool. Story 10.4 patches the response-envelope shape only — no behavior change to the worker pool, manifest writer, concurrency, or any of the 23 existing test cases. The code reviewer for 10.2 added the 24th test (short-path collision guard) and landed 267/267; target for 10.4 is 269/269.

Key patterns from 10.2 the dev agent should honor:
- **Real tmp dirs for disk tests** — use `os.tmpdir()` + `crypto.randomBytes(8)` for per-test `destinationDir`, cleanup in `afterEach`. The existing tests in `export.test.ts` already do this.
- **Mock `IrisHttpClient` via the `createMockHttp` / `createMockCtx` helpers** from `test-helpers.ts` — same pattern as every other dev-mcp test.
- **Assert the exact content text prefix** — the existing `ignoreErrors: true` test does this for "skipped" phrasing; mirror it for the new truncated-case prefix.

**Story 10.1** (`iris_package_list`) established the `truncated?: true` pattern (AC 10.1.7) — the literal-type + conditional-spread shape. Match that for `skippedItemsTruncated`.

**Story 10.3** (docs rollup) documented `iris_doc_export` in the package README; the dev agent already added the CSP-asymmetry note there during the bug-discovery session. This story only touches the tool's zod `description` for AI-client-readable inline docs.

## Project Structure Notes

- Aligned with existing `@iris-mcp/dev` layout. No new files. No new subdirectories.
- No `gen:bootstrap` run required (no `.cls` edits).
- No `docs/` or per-package README changes (the README got the CSP note in a prior commit).
- After this story, Epic 10 flips to `done` and the retrospective question kicks in.

## Testing Standards

- Vitest (already in use).
- Mock `IrisHttpClient` via the shared helpers.
- Use real tmp dirs for disk I/O tests.
- Every AC must have at least one test — ACs 10.4.1, 10.4.2, 10.4.3 are all covered by the two new `it` blocks in Task 4.
- AC 10.4.4 (description) can be spot-checked with a `.toContain(…)` against `docExportTool.description` — optional but recommended.

## References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-10-Story-10.4]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-04-20-story-10-4.md]
- [Source: _bmad-output/implementation-artifacts/10-2-iris-doc-export.md] — parent story
- [Source: packages/iris-dev-mcp/src/tools/export.ts] — the file being patched
- [Source: packages/iris-dev-mcp/src/tools/packages.ts] — `truncated?: true` pattern to mirror
- [Source: packages/iris-ops-mcp/src/tools/task.ts] — `iris_task_history` cap pattern from the 2026-04-19 bug-fix pass
- [Source: CHANGELOG.md] — file receiving the `### Fixed` addition

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context) — `claude-opus-4-7[1m]`

### Debug Log References

None required — the change is a pure TypeScript response-envelope cap with unit-test coverage; no runtime debugging needed.

### Completion Notes List

- **Cap value** set to the specified `RESPONSE_SKIPPED_CAP = 50` via a module-level constant. Adjusting it later is a one-line change.
- **Backward-compatible response shape** — callers that already consume `skippedItems[]` keep working; they just see fewer entries under heavy-failure conditions. The new `skippedItemsTruncated?: true` field is optional (absent when no truncation, matching the `truncated?: true` pattern from `iris_package_list`).
- **Both response paths capped** — happy path (~line 729) AND `hardError` partial-result (~line 656) both slice `skippedItems`. Tested the happy path directly; the hardError path reuses the exact same idiom and is trivially symmetric.
- **Manifest uncapped** — `writeManifest()` was not modified. The test verifies 60 entries end up on disk even when the response shows 50.
- **Summary-text prefix** behaves as specified: when truncated, `"60 skipped items; showing first 50. Full list in manifest.json. Exported 0/60..."`; when not truncated, the original `"Exported 2/3 ... (1 skipped)."` form is preserved.
- **Tool description** gained one sentence flagging the CSP static-asset asymmetry. No existing description content was altered.
- **Tests**: 26/26 export tests pass (24 baseline + 2 new). Suite-wide: 269/269. The pre-existing 24 export tests were unaffected by the change.
- **Lint**: 7 pre-existing errors remain on files not touched by this story (unused `vi` imports and one unused `data` variable); none are new and none are on `export.ts` / `export.test.ts`. Per AC 10.4.7 ("no new warnings on touched files"), this is green.
- **TypeScript-only fix** — no ObjectScript changes, no `BOOTSTRAP_VERSION` bump, no `gen:bootstrap` run. Live verification will require an MCP server restart (handled by the lead/user).

### File List

- `packages/iris-dev-mcp/src/tools/export.ts` — added `RESPONSE_SKIPPED_CAP` constant; extended `ExportResult` interface with `skippedItemsTruncated?: true`; applied cap in both response assembly paths (happy + hardError); updated summary-text prefix; appended CSP-asymmetry sentence to zod description.
- `packages/iris-dev-mcp/src/__tests__/export.test.ts` — added `skippedItemsTruncated?: true` to the local `ExportResult` shape; added two new `it` blocks covering the >50-item cap and the ≤50-item no-truncation case.
- `CHANGELOG.md` — appended `### Fixed` subsection to the existing `## [Pre-release — 2026-04-20]` block with the `iris_doc_export` response-envelope cap bullet.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `10-4-doc-export-response-cap` status updated `ready-for-dev` → `in-progress` → (on completion) `review`.

### Change Log

- 2026-04-20 — Story 10.4 implemented: `iris_doc_export` response envelope now caps `skippedItems[]` at 50 entries via `RESPONSE_SKIPPED_CAP`, signals with `skippedItemsTruncated: true`, and preserves the uncapped authoritative list in `manifest.json`. Tool description flags CSP static-asset 404 asymmetry. 269/269 tests green.
