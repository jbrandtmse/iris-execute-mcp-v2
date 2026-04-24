# Story 13.2: Documentation Rollup — README Suite + Per-Package + tool_support.md + CHANGELOG + Cross-Refs

Status: done

## Story

As a user evaluating or upgrading the IRIS MCP Server Suite,
I want `iris_routine_intermediate` documented consistently across the suite and per-package READMEs, the API catalog, the changelog, and related tool descriptions,
so that I can discover, choose, and use it the same way I would any pre-existing tool — and so that existing `@iris-mcp/dev` installs know what the upgrade brings.

## Context

Story 13.1 (commit `2f24b66`) landed the `iris_routine_intermediate` tool and its unit tests. The planning artifacts (sprint-change-proposal, epics.md, prd.md FR110, sprint-status.yaml, story file) landed in the same commit. Cross-reference sentences on `iris_doc_get` and `iris_macro_info` descriptions also landed in 13.1 (they're part of the tool-file changes).

**What remains for this story: the consumer-facing documentation rollup** — suite README, per-package dev-mcp README, `tool_support.md` API catalog, and `CHANGELOG.md`. No code changes.

This story mirrors Epic 10 Story 10.3's docs rollup pattern (commit landed after the tool stories merged).

## Acceptance Criteria

1. **AC 13.2.1** — [README.md](../../README.md) (suite-level):
   - Update the `@iris-mcp/dev` row of the Servers table at [README.md:15](../../README.md#L15) so the tool count reflects the new total: `23` → `24`.
   - Update the bullet description at that same row to mention "macro-expanded routine lookup" alongside the existing capabilities. Suggested phrasing: append ", macro-expanded routine lookup" before the final period. Full expected description:
     > ObjectScript document CRUD, compilation, SQL, globals, code execution, unit tests, package browsing, bulk export, macro-expanded routine lookup
   - No other changes — the suite README stays high-level.

2. **AC 13.2.2** — [packages/iris-dev-mcp/README.md](../../packages/iris-dev-mcp/README.md):
   - Add one row to the tool catalog table (currently at lines 104-175; `iris_package_list` is at line 121). Place the new row in a location consistent with the existing file's ordering (sibling of `iris_doc_get`/`iris_doc_list` makes semantic sense, but author's discretion on exact placement).
   - Row shape to match existing rows: `| \`iris_routine_intermediate\` | Fetch the compiled-intermediate routine (.1.int) for a class by its bare name — macro-expanded form IRIS executes at runtime | \`name\`, \`namespace?\`, \`format?\` | readOnly, idempotent |`.
   - Add one `<details>` example block in the "Tool Examples" section (currently at line 176 onwards) showing a realistic happy-path call + expected structured output. Example class: `ExecuteMCPv2.REST.Command` in HSCUSTOM (matches the live-verification example from Story 13.1).
   - Update "All 23 tools in this package accept the `namespace` parameter" at [packages/iris-dev-mcp/README.md:758](../../packages/iris-dev-mcp/README.md#L758) → "All 24 tools…".
   - Check for any other tool-count callouts in the file and update them if found.

3. **AC 13.2.3** — [tool_support.md](../../tool_support.md):
   - Update section heading at [tool_support.md:15](../../tool_support.md#L15): `## \`@iris-mcp/dev\` — Development Tools (23)` → `(24)`.
   - Add one row to the `@iris-mcp/dev` table (currently #1–#23; new row becomes #24). 🟦 Atelier. Entry shape:
     `| 24 | \`iris_routine_intermediate\` | 🟦 Atelier | \`GET /doc/{name}\` (candidate fallback) |`
   - Update the per-table "**Mix:**" line at [tool_support.md:43](../../tool_support.md#L43): `17 Atelier · 6 ExecuteMCPv2 · 0 other` → `18 Atelier · 6 ExecuteMCPv2 · 0 other`.
   - Update the "Suite-wide rollup" table at [tool_support.md:254](../../tool_support.md#L254):
     - `@iris-mcp/dev` row: Atelier `17` → `18`, Total `23` → `24`.
     - **Total** row: Atelier `17` → `18`, Total `87` → `88`.
   - No field-level notes needed for `iris_routine_intermediate` — its response shape is documented in-description; this file typically captures *surprising* field notes (horolog conversions, breaking renames, etc.), none of which apply.

4. **AC 13.2.4** — [CHANGELOG.md](../../CHANGELOG.md):
   - Add an `### Added` section to the existing `## [Pre-release — 2026-04-23]` entry (currently only has `### Fixed` + `### Changed`). Place it between `## [Pre-release — 2026-04-23]` and `### Fixed`, or after `### Changed` — either works; former keeps the pattern of Added-before-Fixed-before-Changed used in other entries (e.g., the 2026-04-20 block).
   - Entry text (verbatim):
     > - **New tool `iris_routine_intermediate`** ([packages/iris-dev-mcp/src/tools/routine.ts](packages/iris-dev-mcp/src/tools/routine.ts)) — fetches the compiled-intermediate routine (`.1.int` / `.int`) corresponding to a class name. Surfaces the macro-expanded form IRIS executes at runtime — for LLMs that need to see what `$$$macros` expand to. Auto-resolves bare class names via candidate fallback; auth fail-fast on 401/403; compile-first hint on all-candidates-404. Closes capability gap vs. the external `intersystems-objectscript-routine-mcp` npm package identified in the 2026-04-23 competitive analysis. Pure TypeScript, Atelier-only — no `BOOTSTRAP_VERSION` bump. FR110 / Epic 13 / Story 13.1 (commit `2f24b66`).

5. **AC 13.2.5** — Cross-reference back-links verification (landed in Story 13.1; this AC just verifies they exist):
   - [packages/iris-dev-mcp/src/tools/doc.ts](../../packages/iris-dev-mcp/src/tools/doc.ts) — `docGetTool.description` should already contain: *"To fetch the macro-expanded compiled intermediate of a class by its bare name, see `iris_routine_intermediate`."*
   - [packages/iris-dev-mcp/src/tools/intelligence.ts](../../packages/iris-dev-mcp/src/tools/intelligence.ts) — `macroInfoTool.description` should already contain: *"For the fully-expanded routine body as IRIS compiles it, see `iris_routine_intermediate`."*
   - If either is missing, add it (but Story 13.1's CR verified both landed — this AC is a belt-and-braces grep).

6. **AC 13.2.6** — Cross-reference check: grep the repo for any other document listing tool counts per package beyond the three files in AC 13.2.1–13.2.3 and update as found. Known candidates to check:
   - [packages/iris-mcp-all/README.md](../../packages/iris-mcp-all/README.md) — meta-package README may list the dev tool count.
   - Any other `README.md` or `*.md` in the repo root or package folders that cites a suite-wide tool count (e.g., `87 tools` → `88 tools`).
   - Do NOT update [`_bmad-output/implementation-artifacts/*`](../../_bmad-output/implementation-artifacts/) — those are historical sprint logs.
   - Do NOT update [`_bmad-output/planning-artifacts/*`](../../_bmad-output/planning-artifacts/) — prd.md FR110 is already correct; sprint-change-proposals are historical.

7. **AC 13.2.7** — No code changes. No test changes. No `BOOTSTRAP_VERSION` change. Build + lint + tests stay green (unchanged from Story 13.1's `1158 passing`).

8. **AC 13.2.8** — Epic 13 close: this is the final story of Epic 13. After commit, `sprint-status.yaml` should show:
   - `epic-13: done` (was `in-progress`)
   - `13-1-iris-routine-intermediate: done` (already set)
   - `13-2-documentation-rollup: done` (was `backlog`)
   - `epic-13-retrospective: optional` (unchanged — lead's call whether to run)

## Tasks / Subtasks

- [x] **Task 1 — Suite README update** (AC 13.2.1): update the `@iris-mcp/dev` row tool count (23 → 24) and description. One or two-line change.

- [x] **Task 2 — Per-package dev-mcp README update** (AC 13.2.2): add tool-catalog row, add `<details>` example block, update "All 23 tools" → "All 24 tools" callout, grep for other callouts.

- [x] **Task 3 — tool_support.md update** (AC 13.2.3): heading count, new row, Mix line, Suite-wide rollup totals. Four edits in one file.

- [x] **Task 4 — CHANGELOG.md update** (AC 13.2.4): add `### Added` section to the existing 2026-04-23 entry with the specified text.

- [x] **Task 5 — Verify cross-refs exist** (AC 13.2.5): grep `doc.ts` and `intelligence.ts` for the expected sentences. If both present, no-op. If either missing (shouldn't happen — Story 13.1 CR verified them), add it.

- [x] **Task 6 — Grep repo for stale counts** (AC 13.2.6): check `packages/iris-mcp-all/README.md` and any other repo-level docs for `23 tools` / `87 tools` references. Update what's found.

- [x] **Task 7 — Build + test** (AC 13.2.7): run `pnpm turbo run build test lint` from root. Target: unchanged from 13.1 (1158 tests passing, no new lint errors). This validates the docs changes didn't accidentally touch code.

- [x] **Task 8 — Update sprint-status.yaml** (AC 13.2.8): set `13-2-documentation-rollup: done`, set `epic-13: done`, update `last_updated` line with Story 13.2 completion summary.

- [ ] **Task 9 — Commit** — deferred to epic-cycle lead.

## Dev Notes

- **Pure docs story**: no code, no tests, no `BOOTSTRAP_VERSION`. Single commit.
- **One-shot story**: everything lands in one PR, reviewed against the AC list in this file.
- **Count bookkeeping**: suite total went from 87 → 88 tools; `@iris-mcp/dev` went from 23 → 24; dev Atelier count went from 17 → 18. Triple-check these numbers in each file touched.
- **Tool-catalog row placement in dev-mcp README**: the existing table groups tools loosely by domain (doc CRUD, compilation, code intelligence, etc.). A sibling-of-`iris_doc_get`/`iris_macro_info` placement makes semantic sense since those are the tools we cross-reference to/from. But existing order is author's call — any consistent placement is fine.
- **Example block sketch** (for AC 13.2.2): use the live-verification example from Story 13.1's epic-cycle-log entry. Realistic input with a class known to exist in the dev instance, realistic output showing `resolvedDoc`, `candidatesTried`, and a truncated `content` to keep the example readable.
- **CHANGELOG placement within 2026-04-23 entry**: the existing 2026-04-23 block has `### Fixed` and `### Changed` for the Command.cls null-device fix. Story 13.2 adds `### Added` for the new tool. Conventional order is Added → Fixed → Changed; insert accordingly.

## Previous story intelligence

- **Story 13.1** (commit `2f24b66`): tool code + planning artifacts + sprint-change-proposal landed together. All cross-reference sentences on sibling tool descriptions (`iris_doc_get`, `iris_macro_info`) landed there. Test suite 1158 passing. Bootstrap hash `425c4448677c` (unchanged). Story 13.1 CR resolved 1 LOW (`.min(1)` on name zod validator).

- **Epic 10 Story 10.3** (commit landed after 10.1 + 10.2): identical pattern — docs rollup as the final story of a two-tool epic. Reference for file-update scope: README + per-package README + tool_support.md + CHANGELOG. Our story has the same shape with one fewer tool to document.

- **Story 12.6 docs** (commit `a373316`): single-tool addition pattern — docs were bundled with the implementation story rather than split out. Epic 13 uses the Epic 10 split instead because the sprint-change-proposal called for it explicitly.

## Out of scope

- README architectural diagrams or suite-wide conceptual updates — those belong in Epic 8 style doc stories, not Epic 13.
- `sources/intersystems-objectscript-mcp/` disposal or further analysis — the clone stays on disk as reference; no cleanup in this story.
- Publishing checklist (Epic 12 Retro A2/A3) — remains deferred to the publishing sprint.
- npm publish or version bump — out of scope; Epic 13 is a pre-publish additive.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context) via bmad-dev-story skill.

### Debug Log References

- `pnpm turbo run build test lint` — all 1158 tests pass, unchanged from Story 13.1 baseline. 7 pre-existing lint errors (same sibling-test files flagged in 13.1) + 1 unrelated `@iris-mcp/interop` lint error in `interop.integration.test.ts` (pre-existing, unchanged). Zero new lint errors introduced by this story.
- Test-count breakdown: shared 195, data 120, admin 220, ops 159, interop 171, dev 293 → **1158 total**, matching 13.1.
- Bootstrap hash unchanged at `425c4448677c` (no ObjectScript or bootstrap-classes.ts changes).

### Completion Notes List

- AC 13.2.1: Suite `README.md` updated — dev row `23`→`24` + description appended with "macro-expanded routine lookup"; `87 tools`→`88 tools` callout on line 21; ASCII architecture diagram cell `│(23)    │`→`│(24)    │` on line 191 (cross-ref fix during AC 13.2.6 grep audit).
- AC 13.2.2: `packages/iris-dev-mcp/README.md` — new `iris_routine_intermediate` catalog row added to "Code Intelligence Tools" section (sibling of `iris_macro_info`, matching cross-ref semantics from Story 13.1). New `<details>` example block added after `iris_macro_info` example, using `ExecuteMCPv2.REST.Command` in `HSCUSTOM` (live-verification example from Story 13.1). "All 23 tools…"→"All 24 tools…" updated at line 800 (shifted from 758 by added content). No other tool-count callouts found in this file.
- AC 13.2.3: `tool_support.md` — heading `(23)`→`(24)`; new row #24 `iris_routine_intermediate | 🟦 Atelier | GET /doc/{name} (candidate fallback)`; Mix line `17 Atelier`→`18 Atelier`; Suite-wide rollup dev row `17 | 6 | 0 | 23`→`18 | 6 | 0 | 24`, Total row `17 | 65 | 5 | 87`→`18 | 65 | 5 | 88`. Dependency implications prose also updated: `17 of the 23 dev tools`→`18 of the 24 dev tools`, `65 of the 87 tools (75%)`→`65 of the 88 tools (74%)`, `65 of 87 tools`→`65 of 88 tools`, `87-tool total`→`88-tool total` in the debug placeholder note.
- AC 13.2.4: `CHANGELOG.md` — new `### Added` section inserted between `## [Pre-release — 2026-04-23]` and `### Fixed`, matching the Added→Fixed→Changed convention used in prior entries. Text verbatim from story spec.
- AC 13.2.5: Cross-references verified pre-existing (landed in Story 13.1 via commit `2f24b66`). `doc.ts:57` contains "To fetch the macro-expanded compiled intermediate of a class by its bare name, see `iris_routine_intermediate`." and `intelligence.ts:193` contains "For the fully-expanded routine body as IRIS compiles it, see `iris_routine_intermediate`." No edits needed.
- AC 13.2.6: Found and updated two additional files beyond the three in AC 13.2.1–13.2.3 — `packages/iris-mcp-all/README.md` (dev row `23`→`24` + extended description + `87 tools`→`88 tools`) and `docs/migration-v1-v2.md` (`87 tools` → `88 tools` x2, and dev row `23`→`24` with extended description). Historical `_bmad-output/*` and `research/*` matches explicitly excluded by story spec.
- AC 13.2.7: Build + test + lint run clean; 1158 tests pass unchanged from 13.1 baseline; bootstrap hash stable at `425c4448677c`. No code changes; no test changes; no `BOOTSTRAP_VERSION` bump.
- AC 13.2.8: `sprint-status.yaml` updated — `epic-13: done`, `13-2-documentation-rollup: done`; `last_updated` header rewritten with Story 13.2 completion summary prepended to history chain.

### File List

- `README.md` — suite README; dev row count and description, 87→88 callout, ASCII diagram cell
- `packages/iris-dev-mcp/README.md` — catalog row, example `<details>` block, "All 23/24 tools" callout
- `packages/iris-mcp-all/README.md` — meta-package dev row count + description + 87→88 callout
- `tool_support.md` — heading count, new row #24, Mix line, Suite-wide rollup totals, dependency implications prose
- `CHANGELOG.md` — new `### Added` section in 2026-04-23 entry
- `docs/migration-v1-v2.md` — 87→88 tool count (2x) and dev row 23→24 + description extended
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `epic-13: done`, `13-2-documentation-rollup: done`, `last_updated` summary
- `_bmad-output/implementation-artifacts/13-2-documentation-rollup.md` — Dev Agent Record, task checkboxes, status

### Review Findings

Code review run 2026-04-23 by Claude Opus 4.7 (1M context) via bmad-code-review skill. Docs-only story; three review layers collapsed into a single pass given ~64-line diff size.

**Summary:** 1 MEDIUM finding (auto-resolved), 1 LOW deferred, 0 HIGH, 0 INFO-only.

- [x] [Review][Patch] **`iris_routine_intermediate` example output shape in per-package README did not match actual tool return shape** [`packages/iris-dev-mcp/README.md:519-540`] — MEDIUM. The new `<details>` example block in AC 13.2.2 showed `content` as an array of strings (`["ROUTINE...", "%File ;...", ...]`) and included non-existent `format: "udl"` and `ts: "2026-04-23T12:00:00.000Z"` fields. Cross-checked against `packages/iris-dev-mcp/src/tools/routine.ts:104-110` (actual structured output = `{name, resolvedDoc, namespace, content, candidatesTried}`) and against `packages/iris-dev-mcp/src/__tests__/routine.test.ts:44-49` (test expects `content: docContent.content.join("\n")` — i.e., a joined string, not array). Auto-resolved: updated the example to show `content` as a newline-joined string matching the actual tool return; removed the non-existent `format` and `ts` fields; added the `name` field that IS returned. Example now matches the `TestRoutineIntermediate` test expectation.

- [x] [Review][Defer] **Pre-existing `@iris-mcp/ops` tool-count drift (17 in per-table headings, 16 in Suite-wide rollup + suite READMEs)** [`tool_support.md:145,167,253` + `README.md:16` + `packages/iris-mcp-all/README.md:26` + `docs/migration-v1-v2.md:30`] — LOW, deferred. Pre-existing from Epic 12 Story 12.6 (`iris_alerts_manage` addition, commit `a373316`). Dev explicitly flagged in review context as out-of-scope for Story 13.2. Story 13.2 followed the AC literally (87 → 88 based on +1 dev tool). A follow-up docs pass should increment ops from 16 → 17 (total 88 → 89). See `deferred-work.md` for full detail.

**Verified clean (no findings):**
- Count consistency across all 5 edited files: 87→88 suite, 23→24 dev, 17→18 dev Atelier — all correct; grep confirmed zero stale references.
- CHANGELOG `### Added` entry placed correctly in 2026-04-23 block, between `## [Pre-release — 2026-04-23]` and `### Fixed`. Text verbatim from AC spec.
- New tool-catalog row shape matches existing row conventions (`| n | \`tool\` | API | Endpoint |` in `tool_support.md`; `| tool | description | params | annotations |` in per-package README).
- Cross-refs verified present: `doc.ts:57` and `intelligence.ts:193`.
- Zero accidental code changes: `git status` shows only the 6 documented files + `sprint-status.yaml` + the story file. No TypeScript/ObjectScript files touched.
- Bootstrap hash unchanged at `425c4448677c` (verified via `packages/shared/src/bootstrap-classes.ts:25`).
- Sprint-status.yaml correctly reflects Epic 13 close: `epic-13: done`, `13-2-documentation-rollup: done`, `13-1-iris-routine-intermediate: done` (already), `epic-13-retrospective: optional`.

### Change Log

| Date | Author | Description |
|---|---|---|
| 2026-04-23 | Dev Agent (Claude Opus 4.7) | Documentation rollup for `iris_routine_intermediate` across suite README, per-package dev-mcp README, tool_support.md API catalog, CHANGELOG 2026-04-23 entry, meta-package README, migration guide, and suite ASCII diagram. 5 core files + 2 cross-ref files touched. No code, no tests, no bootstrap bump. 1158 tests pass unchanged. Epic 13 close. |
