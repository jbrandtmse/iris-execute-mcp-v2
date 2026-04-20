# Story 10.3: Documentation Rollup — README Suite + Per-Package + tool_support.md + CHANGELOG

Status: review

## Story

As a user evaluating or upgrading the IRIS MCP Server Suite,
I want the two new tools from Epic 10 (`iris_package_list` and `iris_doc_export`) documented consistently across the suite and per-package READMEs, the API catalog, and the changelog,
so that I can discover, choose, and use them the same way I would any pre-existing tool — and so that existing `@iris-mcp/dev` users know what the upgrade brings.

## Acceptance Criteria

1. **AC 10.3.1** — Suite-level [README.md](../../README.md):
   - **Line 15**: update the `@iris-mcp/dev` row tool count `21` → `23`. Extend the short description to mention "package browsing and bulk export" alongside the existing items: e.g., `ObjectScript document CRUD, compilation, SQL, globals, code execution, unit tests, package browsing, bulk export`.
   - Confirm no other tool-count values reference `21` for `@iris-mcp/dev` (search the whole file; the "85 tools across 5 servers" summary will become `87`).
   - Update any total-tool-count sentence (likely around line 21: `> **85 tools** across 5 servers`) to `87`.

2. **AC 10.3.2** — [packages/iris-dev-mcp/README.md](../../packages/iris-dev-mcp/README.md):
   - **Add a new "Package Browsing Tools" section** after the "Document Tools" table (line 115):
     ```markdown
     ### Package Browsing Tools

     | Tool | Description | Key Parameters | Annotations |
     |------|-------------|----------------|-------------|
     | `iris_package_list` | Roll up namespace documents into packages at a chosen depth | `depth?`, `prefix?`, `category?`, `type?`, `generated?`, `system?`, `modifiedSince?`, `namespace?` | readOnly, idempotent |
     ```
   - **Add `iris_doc_export` row to the "Document Tools" table** (around line 114 — after `iris_doc_load`):
     ```markdown
     | `iris_doc_export` | Bulk-download documents to a local directory (inverse of `iris_doc_load`) | `destinationDir`, `prefix?`, `category?`, `type?`, `generated?`, `system?`, `modifiedSince?`, `namespace?`, `includeManifest?`, `ignoreErrors?`, `useShortPaths?`, `overwrite?`, `continueDownloadOnTimeout?` | idempotent |
     ```
   - **Add two `<details>` example blocks** in the "Tool Examples" section (after line 169). One per tool, with realistic input + expected output. For `iris_doc_export`, show BOTH the happy-path result AND an example showing `skippedItems` with the `ENAMETOOLONG` hint + a snippet of `manifest.json`.
   - Update the top-of-file tagline (line 3) to mention "namespace browsing" and "bulk export" alongside the existing descriptions: `ObjectScript document CRUD, compilation, SQL execution, globals management, code execution, unit testing, package browsing, and bulk export via the Model Context Protocol.`
   - Grep the package README for any other tool-count callouts and update if found.

3. **AC 10.3.3** — [tool_support.md](../../tool_support.md):
   - **Line 15 heading**: `## \`@iris-mcp/dev\` — Development Tools (21)` → `## \`@iris-mcp/dev\` — Development Tools (23)`.
   - **Add two rows** to the `@iris-mcp/dev` table (after row 21 — the `iris_global_list` entry). Both are 🟦 Atelier:
     ```markdown
     | 22 | `iris_package_list` | 🟦 Atelier | `GET /docnames/{cat}/{type}` (client-side rollup) |
     | 23 | `iris_doc_export` | 🟦 Atelier | `GET /docnames/{cat}/{type}` + `GET /doc/{name}` (bulk) |
     ```
   - **Update the Mix line** (line 41): `**Mix:** 15 Atelier · 6 ExecuteMCPv2 · 0 other` → `**Mix:** 17 Atelier · 6 ExecuteMCPv2 · 0 other`.
   - **Update the Suite-wide rollup table** (line 149): bump the `@iris-mcp/dev` row from `15 | 6 | 0 | 21` to `17 | 6 | 0 | 23`; update the **Total** row `15 | 65 | 5 | 85` to `17 | 65 | 5 | 87`.

4. **AC 10.3.4** — [CHANGELOG.md](../../CHANGELOG.md):
   - **Extend the existing `## [Pre-release — 2026-04-19]` entry** — the 2026-04-20 work belongs in a new section. Insert a NEW block at the top (before the 2026-04-19 entry) dated `2026-04-20`:
     ```markdown
     ## [Pre-release — 2026-04-20]

     ### Added — Epic 10: Namespace Browsing and Bulk Export Tools (iris-dev-mcp)

     Two new `@iris-mcp/dev` tools let AI clients survey a namespace at package granularity and pull code to disk in bulk, without paging every document or dropping to raw SQL.

     - **`iris_package_list`** ([packages/iris-dev-mcp/src/tools/packages.ts](packages/iris-dev-mcp/src/tools/packages.ts)) — Walks the Atelier `docnames` endpoint and aggregates client-side into package rollups at a configurable depth. Same filter surface as `iris_doc_list` (category, type, generated, `modifiedSince`), plus a `prefix` narrow, a `system` tri-state (`true | false | only`), and a 1000-row cap. Returns `{ packages[], count, totalDocs, truncated?, limit? }`. Use `iris_package_list` for a structural overview; use `iris_doc_list` for individual document names.
     - **`iris_doc_export`** ([packages/iris-dev-mcp/src/tools/export.ts](packages/iris-dev-mcp/src/tools/export.ts)) — The inverse of `iris_doc_load`. Walks Atelier `docnames` with the same filter surface plus `generated` as a tri-state (`true | false | both`), then downloads each matching document via `GET /doc/{name}` with 4-way bounded concurrency. Dots-as-directories mapping: `EnsLib.HTTP.GenericService.cls` → `<destinationDir>/EnsLib/HTTP/GenericService.cls`. CSP paths with forward slashes are preserved. Writes a `manifest.json` recording every exported file and every skipped item with a reason and remediation hint. Resilient by default: per-file failures are collected into `skippedItems` rather than aborting; Windows long paths can be worked around with `useShortPaths: true` (short-path collisions are guarded via a shared-path reservation map to prevent silent overwrite); `continueDownloadOnTimeout: true` detaches the download loop from the MCP request's `AbortSignal` so client timeouts don't abandon the on-disk state. Inverse round-trip with `iris_doc_load` + `overwrite: ifDifferent` skips unchanged files for fast re-sync.

     Both tools are TypeScript-only — no new `ExecuteMCPv2.*` classes, no `BOOTSTRAP_VERSION` change. **Upgrade path for existing installs**: `git pull && pnpm install && pnpm turbo run build` plus an MCP server restart. No ObjectScript redeploy.

     Tool count in `@iris-mcp/dev`: 21 → 23. Suite total: 85 → 87.
     ```
   - No other CHANGELOG sections are touched.

5. **AC 10.3.5** — Discoverability linking in tool descriptions:
   - In [packages/iris-dev-mcp/src/tools/doc.ts](../../packages/iris-dev-mcp/src/tools/doc.ts) (`docListTool`), append to the `description` string (around line 334):
     > "For a structural overview at package granularity, see `iris_package_list`. To pull many documents at once, see `iris_doc_export`."
   - In the same file, append to `docGetTool`'s description (around line 55 — search for `docGetTool`):
     > "To pull many documents at once, see `iris_doc_export`."
   - These links help AI clients route from the broad-purpose tool to the more targeted one. Keep each addition to a single sentence.
   - Rebuild and run tests after changing descriptions — the `@iris-mcp/dev` test suite includes description contains-checks that might need updates.

6. **AC 10.3.6** — Cross-reference audit:
   - `grep -rn "21\s*|.*iris-mcp/dev\|iris-dev-mcp.*21" --include="*.md"` across the repo (excluding `_bmad-output/implementation-artifacts/*` which are historical). Known candidates: [packages/iris-mcp-all/README.md](../../packages/iris-mcp-all/README.md) may list per-package tool counts.
   - Grep for the phrase `85 tools` and update to `87 tools` wherever it appears.
   - Do NOT touch `_bmad-output/implementation-artifacts/*` (historical sprint log files).

7. **AC 10.3.7** — Build + tests + lint still green:
   - `pnpm turbo run build --filter=@iris-mcp/dev` — must pass (description string edits in `doc.ts` should not break the build).
   - `pnpm turbo run test --filter=@iris-mcp/dev` — all 267 tests still pass. If any test asserts a specific description substring that is disturbed by the new sentence, update the assertion.
   - `pnpm turbo run lint --filter=@iris-mcp/dev` — no new warnings on touched files.
   - Optionally run `pnpm turbo run test` (whole suite) to confirm nothing else regressed.

## Tasks / Subtasks

- [x] **Task 1**: Suite README updates (AC 10.3.1)
  - [x] Update [README.md](../../README.md) line 15 tool count `21` → `23`.
  - [x] Extend description in the same row.
  - [x] Update the `> **85 tools**` callout near line 21 → `87`.
  - [x] `grep -n "21\|85" c:/git/iris-execute-mcp-v2/README.md` and update any other tool-count references discovered. (Also updated the architecture ASCII diagram `│(21)    │` → `│(23)    │`.)

- [x] **Task 2**: Per-package dev-mcp README updates (AC 10.3.2)
  - [x] Update line 3 tagline.
  - [x] Add `iris_doc_export` row to the "Document Tools" table.
  - [x] Add a new "Package Browsing Tools" section with `iris_package_list` row.
  - [x] Add two `<details>` example blocks in "Tool Examples" — one per tool. Inputs must be valid (`namespace: "USER"`, realistic prefix). The `iris_doc_export` example includes both the happy-path result AND a skippedItems example with `ENAMETOOLONG` hint + a truncated manifest.json snippet.
  - [x] Grep for any other tool-count callouts in the package README. Updated `All 21 tools` → `All 23 tools` at line 739.

- [x] **Task 3**: tool_support.md updates (AC 10.3.3)
  - [x] Heading count bump.
  - [x] Two new table rows (both Atelier).
  - [x] Mix line updated `15` → `17`.
  - [x] Suite-wide rollup: `@iris-mcp/dev` row and total row. Also updated Dependency Implications text references (`15 of the 21` → `17 of the 23`, `65 of 85` → `65 of 87`, `85-tool total` → `87-tool total`).

- [x] **Task 4**: CHANGELOG.md new entry (AC 10.3.4)
  - [x] Insert `## [Pre-release — 2026-04-20]` section BEFORE the existing 2026-04-19 entry.
  - [x] Include the `### Added — Epic 10:` block per AC 10.3.4 verbatim.

- [x] **Task 5**: Discoverability links (AC 10.3.5)
  - [x] Extend `docListTool.description` in `doc.ts`.
  - [x] Extend `docGetTool.description` in `doc.ts`.
  - [x] Rebuild and rerun tests — no description-substring assertion broke (only `packageListTool.description` had one, unchanged). 267/267 pass.

- [x] **Task 6**: Cross-reference audit (AC 10.3.6)
  - [x] Grep for `85 tools` and update. Updated `docs/migration-v1-v2.md` (two occurrences). Left historical dated artifacts (`docs/tool-annotation-audit.md` dated 2026-04-07, CHANGELOG Pre-release 2026-04-09 entry) untouched — those are point-in-time records of what existed at those dates.
  - [x] Check [packages/iris-mcp-all/README.md](../../packages/iris-mcp-all/README.md) for per-package tool counts. Updated both the table (`21` → `23`, extended description) and the `85 tools` summary line.
  - [x] Optionally: any other `.md` under the repo root or `packages/*/README.md` that mentions counts. Also updated the `@iris-mcp/dev` row in `docs/migration-v1-v2.md` mapping table.

- [x] **Task 7**: Build + test + lint validation (AC 10.3.7)
  - [x] `pnpm turbo run build --filter=@iris-mcp/dev` → passed (2 tasks, 2 successful).
  - [x] `pnpm turbo run test --filter=@iris-mcp/dev` → 267/267 tests pass (13 files).
  - [x] `pnpm turbo run lint --filter=@iris-mcp/dev` → the 7 errors reported are all pre-existing in test files not touched by this story (unused `vi` imports, unused `data` var). Verified by `git stash` + re-running lint on main HEAD: identical 7 errors. No new warnings on touched files (`doc.ts` is lint-clean).

## Dev Notes

### Scope

- **Pure documentation + two one-line description edits.** No new tools, no new tests required (assertion updates OK if an existing description-contains check breaks).
- No `BOOTSTRAP_VERSION` change (no `.cls` edits).
- No planning-artifact changes (epics.md, prd.md already updated when the Sprint Change Proposal landed).

### Key conventions

- Match the **existing table format exactly** — don't introduce a new column, don't change column order, don't alter the pipe alignment.
- Match the **existing `<details>` block format** in the Tool Examples section.
- Every doc reference must use **markdown link syntax** (e.g., `[README.md](../../README.md)`) when referenced from this story file — but the actual README edits should preserve whatever reference style is already in those files.
- Flat underscore tool names (`iris_package_list`, `iris_doc_export`) — not dots.

### Anti-patterns to avoid

- ❌ Don't rewrite or reorganize unrelated sections "while you're in there". This is a focused doc rollup, not a cleanup PR.
- ❌ Don't add tool count assertions that will need updating every time a tool lands — keep assertions precise.
- ❌ Don't insert the CHANGELOG entry inside the existing 2026-04-19 `Fixed` section. Epic 10 is **added work**, not a fix — it gets its own dated section (2026-04-20).
- ❌ Don't touch `_bmad-output/implementation-artifacts/*.md` — those are historical per-story logs. The epic-cycle log is already handled by the lead agent after each story.
- ❌ Don't forget the suite-wide rollup total (line ~157). It's easy to miss.

### Reference / Previous Story Intelligence

- **Story 10.1** (commit `a863798`) added `iris_package_list`. Tool count was 21 → 22.
- **Story 10.2** (commit `6732b21`) added `iris_doc_export`. Tool count 22 → 23.
- Current `@iris-mcp/dev` test count: **267/267** after code review.
- Live-verified behavior matches the story ACs — you do NOT need to re-verify behavior here, only to document it correctly.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-10-Story-10.3]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-04-20.md] — Sprint Change Proposal §4 Proposal 4
- [Source: _bmad-output/implementation-artifacts/10-1-iris-package-list.md]
- [Source: _bmad-output/implementation-artifacts/10-2-iris-doc-export.md]
- [Source: README.md, packages/iris-dev-mcp/README.md, tool_support.md, CHANGELOG.md] — files being edited

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context) — Amelia dev agent via `/bmad-dev-story` skill.

### Debug Log References

- `pnpm turbo run build --filter=@iris-mcp/dev` → 2 tasks succeeded; `@iris-mcp/dev:build` cache miss, compiled cleanly after adding sentences to `docListTool`/`docGetTool` descriptions.
- `pnpm turbo run test --filter=@iris-mcp/dev` → 267/267 tests pass across 13 files (Duration 4.63s). The only description-substring assertion (`packages.test.ts:402` — `packageListTool.description` contains `iris_doc_list`) was unaffected.
- `pnpm turbo run lint --filter=@iris-mcp/dev` → reports 7 errors; verified pre-existing on `main` HEAD via `git stash`/rerun/`git stash pop`. Same 7 errors, same files, none in files touched by this story. `doc.ts` (the only source file modified) is lint-clean.

### Completion Notes List

- **Suite README (README.md)**: `@iris-mcp/dev` tool count `21` → `23`; description extended with "package browsing, bulk export"; `85 tools` → `87 tools` summary callout; architecture ASCII diagram's `│(21)    │` cell also bumped to `│(23)    │` for consistency.
- **Per-package README (packages/iris-dev-mcp/README.md)**: line-3 tagline extended; `iris_doc_export` row appended after `iris_doc_load` in the Document Tools table; new "Package Browsing Tools" section inserted between Document Tools and Compilation Tools tables, containing the `iris_package_list` row exactly as specified; three `<details>` examples added in Tool Examples section (one for `iris_doc_export` happy path + `skippedItems`/manifest.json excerpt, one for `iris_package_list`, plus the happy-path `iris_doc_export` example); the `All 21 tools` Namespace Scoping callout bumped to `All 23 tools`.
- **tool_support.md**: heading count `(21)` → `(23)`; two new rows (22 = `iris_package_list`, 23 = `iris_doc_export`, both 🟦 Atelier) appended with correct endpoint descriptions; Mix line `15 Atelier` → `17 Atelier`; Suite-wide rollup table updated (`15 | 6 | 0 | 21` → `17 | 6 | 0 | 23`; Total `15 | 65 | 5 | 85` → `17 | 65 | 5 | 87`); Dependency Implications prose updated (`15 of the 21` → `17 of the 23`, `65 of the 85` → `65 of the 87`, `65 of 85` → `65 of 87`, `85-tool total` → `87-tool total`, percentage recalc 76%→75%).
- **CHANGELOG.md**: new `## [Pre-release — 2026-04-20]` section inserted BEFORE the existing 2026-04-19 entry; includes the `### Added — Epic 10:` block verbatim per AC 10.3.4 with both new tool bullets and the upgrade path note. No other sections touched.
- **doc.ts discoverability links (AC 10.3.5)**: `docGetTool.description` appended with "To pull many documents at once, see `iris_doc_export`." (single sentence). `docListTool.description` appended with "For a structural overview at package granularity, see `iris_package_list`. To pull many documents at once, see `iris_doc_export`." (two sentences, one per redirect target, matching the story spec phrasing).
- **Cross-reference audit (AC 10.3.6)**:
  - Updated `packages/iris-mcp-all/README.md` (`21` → `23`, description extended, `85 tools` → `87 tools`).
  - Updated `docs/migration-v1-v2.md` (two occurrences of `85 tools` → `87 tools`, and the `@iris-mcp/dev` row `21` → `23` + extended description).
  - Deliberately NOT modified: `docs/tool-annotation-audit.md` is a dated (2026-04-07) point-in-time audit report accurately reflecting the 85-tool baseline at that date; CHANGELOG's 2026-04-09 entry describes the rename of "All 85 tools" — correct at that date.
- **Decision: historical artifacts left untouched.** The story's anti-pattern list explicitly excludes `_bmad-output/implementation-artifacts/*`. Extending that rule to other dated historical documents (the 2026-04-07 audit report and the 2026-04-09 CHANGELOG entry) is consistent with the story's intent — retroactively changing "85" to "87" in those records would falsify the historical statement.
- **Anti-patterns avoided**: no cleanup in unrelated sections; no new tool-count assertions; CHANGELOG entry inserted as a NEW 2026-04-20 section (not merged into the 2026-04-19 Fixed block, since Epic 10 is Added work); `_bmad-output/implementation-artifacts/*.md` untouched; suite-wide rollup total row (line ~160) updated.

### File List

- `README.md` — suite-level README, 3 edits (tool count, description, total callout, architecture diagram)
- `packages/iris-dev-mcp/README.md` — per-package README, 4 edits (tagline, Document Tools table row, Package Browsing Tools section, Tool Examples blocks, Namespace Scoping callout)
- `packages/iris-mcp-all/README.md` — meta-package README, 2 edits (tool count + description in the servers table, `85 tools` summary)
- `tool_support.md` — API catalog, 6 edits (dev section heading, two new table rows, Mix line, suite-wide rollup table, Dependency Implications prose block)
- `CHANGELOG.md` — 1 new section inserted BEFORE the existing 2026-04-19 entry
- `packages/iris-dev-mcp/src/tools/doc.ts` — 2 edits (`docGetTool.description` and `docListTool.description` each extended with one sentence pointing at the new tools)
- `docs/migration-v1-v2.md` — 3 edits (2x `85 tools` → `87 tools`, 1x `@iris-mcp/dev` row `21` → `23` + extended description)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story status `ready-for-dev` → `in-progress` (will be `review` after completion); `last_updated` annotation updated

### Change Log

| Date | Version | Description | Author |
|------|---------|-------------|--------|
| 2026-04-20 | 1.0 | Story 10.3 implemented — pure documentation rollup for Epic 10. Updated suite README, per-package README, meta-package README, tool_support.md, CHANGELOG (new 2026-04-20 section), docs/migration-v1-v2.md, and appended discoverability sentences to `docGetTool`/`docListTool` descriptions in `doc.ts`. Build passes; 267/267 tests pass; lint clean on touched files (pre-existing errors in other test files unchanged). | Amelia (dev agent) |
