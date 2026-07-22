# Story 30.1: Preset Rosters (all 5 packages)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **suite operator choosing a preset for my client**,
I want **each server package to declare explicit, approved `core`/`developer` tool rosters wired into the visibility engine, guarded so no tool can silently fall out of a preset**,
so that **`IRIS_TOOLS_PRESET=core` trims every server to its research-backed ~10-tool loop and `IRIS_TOOLS_PRESET=developer` hides security/enterprise admin — with counts that exactly match the product-owner-approved tables and package `tools[]` arrays untouched**.

## Acceptance Criteria

- **AC 30.1.1 — Rosters × 5 packages, exactly per spec §2.5.** New `packages/<pkg>/src/tools/presets.ts` in each of the 5 packages, exporting `toolPresets: ToolPresetRosters` with `core` and `developer` dispositions transcribed **exactly** from the approved spec §2.5 tables (the ✓/— columns). Each roster's `include` = the ✓ tools for that preset, `exclude` = the — tools; `include ∪ exclude` must equal the package's full tool-name set. `data-mcp` declares full-inclusion rosters explicitly (`include` = all 7, `exclude: []`) for both presets — the coverage assert applies uniformly. Each `presets.ts` is wired into the package's `new McpServerBase({...})` call ([e.g. iris-dev-mcp/src/index.ts:20-26](../../packages/iris-dev-mcp/src/index.ts#L20-L26)) via the new `toolPresets` option field.
- **AC 30.1.2 — Coverage + pairs guards.**
  - Per-package unit test (one per package) asserting the same set-equality `assertPresetCoverage` enforces, failing with the offending tool name (`include ∪ exclude === toolNames` and `include ∩ exclude === ∅`, for both `core` and `developer`).
  - A shared `TOOL_PAIRS` constant (`[["iris_env_diff", "iris_env_promote"]]`) added to `packages/shared/src/tool-visibility.ts` (extensible), plus a co-visibility test asserting each pair is together-in or together-out of every preset in every package that owns both members (dev-mcp owns this pair). In `core` both are excluded; in `developer` both are included.
- **AC 30.1.3 — Counts locked; nothing else moves.**
  - Package `tools[]` arrays and **every existing count assertion** (e.g. each package's `index.test.ts` `toHaveLength(...)` / literal `getToolNames()` array / `toolCount===N`) are **byte-for-byte unchanged** (Rule #31 — no tool count moves anywhere; presets are a filter, not a tool-set change).
  - A test asserts each `core` server is **≤13 runtime tools** (roster `core.include.length` + 1 for the framework `iris_server_profiles`).
  - The roster sizes match the approved oracle exactly: **core** package-tool counts `dev 12 / admin 12 / interop 9 / ops 9 / data 7`; **developer** `dev 28 / admin 10 / interop 22 / ops 9 / data 7` (spec §2.5 "Roster summary" table). A test pins these numbers per package (so a transcription slip fails mechanically, Rule #36 oracle discipline).

### Integration ACs

Story 30.0 introduced the `toolPresets` option and the `resolveVisibleTools`/`assertPresetCoverage` engine. This story is the **first consumer** — it wires real rosters into all 5 packages' `McpServerBase` construction. The integration is proven end-to-end: with `IRIS_TOOLS_PRESET=core` a constructed server's registered tool set equals its `core.include` + `iris_server_profiles` (exercised by the AC 30.1.2 coverage tests and, live, by the Story 30.3 smokes). No further consumer in this story; `toolVisibility` surfacing is Story 30.2, docs are Story 30.3.

## Tasks / Subtasks

- [x] **Task 1 — Add the `TOOL_PAIRS` constant to shared** (AC: 30.1.2)
  - [x] In `packages/shared/src/tool-visibility.ts`, export `TOOL_PAIRS: readonly (readonly [string, string])[] = [["iris_env_diff", "iris_env_promote"]] as const` with a JSDoc banner (tools designed as a unit must be co-visible; hiding one strands the agent mid-workflow). Re-export from `index.ts`. Export a small helper the tests can share, e.g. `assertToolPairsCovisible(rosters, toolNames)` OR leave the assertion to the tests — dev's choice, but keep ONE source of truth for the pair list.
- [x] **Task 2 — Author the 5 `presets.ts` files, transcribed from spec §2.5** (AC: 30.1.1)
  - [x] `packages/iris-dev-mcp/src/tools/presets.ts` — `core.include` = the 12 dev core-column ✓ tools; `developer.include` = all 28. Verify `include ∪ exclude` = the 28-tool dev set.
  - [x] `packages/iris-admin-mcp/src/tools/presets.ts` — `core` 12 include / 14 exclude; `developer` 10 include / 16 exclude, per §2.5 admin table.
  - [x] `packages/iris-interop-mcp/src/tools/presets.ts` — `core` 9 include / 13 exclude; `developer` all 22 include.
  - [x] `packages/iris-ops-mcp/src/tools/presets.ts` — `core` 9 include / 12 exclude; `developer` 9 include / 12 exclude, per §2.5 ops table.
  - [x] `packages/iris-data-mcp/src/tools/presets.ts` — both presets `include` all 7, `exclude: []`.
  - [x] **Transcribe from the spec §2.5 tables, not from memory.** After writing each, cross-check `include ∪ exclude` against the package's actual registered tool-name set (the lead verified the live sets: dev 28, admin 26, interop 22, ops 21, data 7). The `assertPresetCoverage` at construction + the coverage test will fail on any slip.
- [x] **Task 3 — Wire `toolPresets` into each package's `index.ts`** (AC: 30.1.1)
  - [x] In each of the 5 `packages/<pkg>/src/index.ts`, `import { toolPresets } from "./tools/presets.js"` and add `toolPresets,` to the `new McpServerBase({ ... })` options object (alongside `tools,`). This activates `assertPresetCoverage` at construction (Story 30.0's engine).
- [x] **Task 4 — Per-package coverage + pairs + count tests** (AC: 30.1.2, 30.1.3)
  - [x] One coverage test per package (`packages/<pkg>/src/__tests__/presets.test.ts`, matching the package's EXISTING test-location convention — `src/__tests__/`, not `src/tools/__tests__/`): assert `assertPresetCoverage(toolPresets, <package tool names>)` does not throw; assert exact `include`/`exclude` counts per the AC 30.1.3 oracle; assert each `core` server ≤13 runtime tools.
  - [x] A dev-mcp `TOOL_PAIRS` co-visibility test (dev-mcp owns both `iris_env_diff` and `iris_env_promote`, the only pair in `TOOL_PAIRS`): for every pair and every preset, both members are on the same side (both in `include` or both in `exclude`). Also added a small `TOOL_PAIRS` shape/content test in `packages/shared/src/__tests__/tool-visibility.test.ts`.
  - [x] Did NOT modify any existing `index.test.ts` count assertion. Confirmed they still pass unchanged (re-read every file pre-edit; `git diff` on all 5 shows zero changes to `index.test.ts`).
- [x] **Task 5 — Verify & self-check**
  - [x] `pnpm turbo run build test lint type-check` green across all packages (each package's suite + shared) — 18/18 turbo tasks green (7 build + test 13 across the two runs + 18 lint/type-check).
  - [x] `pnpm gen:governance-baseline:check` exits 0 (frozen `1e62c5ad5bf7`, 141 keys, unchanged — rosters do not touch governance). Confirmed: "OK — every frozen foundation key still exists in the live surface." (141 frozen / 201 live / 60 post-foundation, unchanged from post-30.0).
  - [x] No package `tools[]` array changed; no `index.test.ts` count assertion moved (Rule #31) — verified via `git diff` (zero hunks in any `tools/index.ts` or `index.test.ts`). No new tool, no governance key, no `BOOTSTRAP_VERSION` bump, no ObjectScript. `git diff`/`git status` touches only the new `presets.ts` × 5, the 5 `index.ts` wirings, `tool-visibility.ts` (+ `index.ts` re-export) for `TOOL_PAIRS`, the new `presets.test.ts` × 5, and the extended `tool-visibility.test.ts`.

## Dev Notes

- **The spec §2.5 tables are the binding, product-owner-approved roster source (approved 2026-07-12 — "implement as written").** Transcribe the ✓/— columns exactly. The lead confirmed live (2026-07-20) that the current registered tool-name sets match the spec tables byte-for-byte: **dev 28, admin 26, interop 22, ops 21, data 7 = 104**. [Source: research/feature-specs/11-tool-visibility-presets.md#2.5]
- **Roster intents (state nothing new — this is context):** `core` attacks the count cliff (≤13 runtime tools/server, the everyday ~80% loop); `developer` attacks persona relevance (hides users/roles/resources/SSL/OAuth/LDAP/X509/audit + backup/mirror/ECP; dev/interop stay above the cliff — accepted, `core` is the count answer). [Source: architecture.md#I2]
- **`assertPresetCoverage` is already built (Story 30.0).** Wiring `toolPresets` into a package's `McpServerBase` construction activates it — a roster that doesn't exactly cover the package tool set throws at construction, naming the offending tool + preset. That is the Rule #53 contract: every tool carries an explicit include/exclude disposition in every named preset.
- **`full` is reserved** (= all tools, spec §2.4) and must NOT appear in any `presets.ts` — only `core` and `developer` are declared.
- **Rule #31 is a hard gate.** Presets are a registration-time FILTER; they do not change any `tools[]` array. Every existing count assertion (`toHaveLength(28)` in dev's index.test.ts, etc.) MUST stay byte-for-byte. If you find yourself editing a count assertion, STOP — that is a regression, not the task.
- **Out of scope here:** the `toolVisibility` output block on `iris_server_profiles` and the governance-report hidden-key omission (Story 30.2); docs + live smokes + payload measurement (Story 30.3). This story is rosters + wiring + coverage/pairs/count tests only.
- **Cross-package test-location note (Rule #45):** `@iris-mcp/shared` cannot import leaf packages. The `TOOL_PAIRS` constant lives in shared; the per-package coverage tests live in each leaf package (they have the package's own `toolPresets` + tool set locally). If a genuinely cross-package roster check is wanted (e.g. "every package declares both presets"), it belongs in `packages/iris-mcp-all` per Rule #45 — but the per-package coverage tests already give complete protection, so a cross-package check is optional here.
- **Testing standards.** Vitest; follow each package's existing `__tests__` convention. Count-pinning tests are the Rule #36 oracle against a transcription slip — pin the exact numbers from the §2.5 "Roster summary" table.

### Project Structure Notes

- New files: `packages/{iris-dev-mcp,iris-admin-mcp,iris-interop-mcp,iris-ops-mcp,iris-data-mcp}/src/tools/presets.ts` (5) + one coverage test per package + one `TOOL_PAIRS` co-visibility test.
- Edited: 5 × `packages/<pkg>/src/index.ts` (add `toolPresets` to construction); `packages/shared/src/tool-visibility.ts` + `index.ts` (add/re-export `TOOL_PAIRS`).
- Untouched: every package `tools/index.ts` `tools[]` array; every existing `index.test.ts` count assertion (Rule #31).
- Naming: `presets.ts` under each package's `src/tools/` per spec §2.4 ownership model.

### References

- [Source: research/feature-specs/11-tool-visibility-presets.md#2.5] — the approved core/developer rosters per package (the ✓/— tables) + the Roster summary counts (core 12/12/9/9/7; developer 28/10/22/9/7).
- [Source: research/feature-specs/11-tool-visibility-presets.md#2.4] — ownership (`packages/<pkg>/src/tools/presets.ts` + `toolPresets` field), `assertPresetCoverage`, `TOOL_PAIRS`.
- [Source: research/feature-specs/11-tool-visibility-presets.md#3] — Story 2 scope; [#4] — ACs 6-7 & 9.
- [Source: epics.md#Story-30.1] — AC 30.1.1-30.1.3.
- [Source: architecture.md#I2] — package-owned rosters + registration-time coverage enforcement + roster intents.
- [Source: packages/iris-dev-mcp/src/index.ts#L20-L26] — the `new McpServerBase({...})` wiring site (same shape in all 5 packages).
- [Source: packages/shared/src/tool-visibility.ts] — Story 30.0 engine: `ToolPresetRosters`, `assertPresetCoverage`, `TOOL_PRESET_NAMES` (add `TOOL_PAIRS` here).
- [Source: .claude/rules/project-rules.md#53] — explicit per-preset disposition per tool; [#31] no tool counts move; [#36] pin expected values from the reference (spec table).

## Review Findings

Code review 2026-07-19 (bmad-code-review, Opus 4.8). Oracle-discipline pass (Rule #36): all 5 `presets.ts` rosters independently re-derived tool-by-tool from spec §2.5's ✓/— columns and diffed against the code — **exact match on every cell**, including the ops-mcp trap where `core` and `developer` both total 9 but differ in membership (`iris_metrics_alerts`+`iris_license_info` core-only; `iris_metrics_interop`+`iris_task_history` developer-only). Count pins match the approved oracle (core 12/12/9/9/7, developer 28/10/22/9/7); every `core` runtime ≤13. TOOL_PAIRS co-visible in every preset. Rule #31 verified — no `tools[]` array or `index.test.ts` count assertion moved (git status shows only entry-point `src/index.ts` changes). e2e evidence is genuine (real `McpServerBase` construction + wire `tools/list`, would fail on a wrong roster). `gen:governance-baseline:check` exits 0, frozen `1e62c5ad5bf7` (141 keys) untouched; build 6/6 + test 13/13 green.

- [x] [Review][Patch] `TOOL_PAIRS` insertion orphaned `assertPresetCoverage`'s JSDoc [packages/shared/src/tool-visibility.ts:303] — LOW. The new `TOOL_PAIRS` const + its doc comment were inserted *between* `assertPresetCoverage`'s JSDoc block and the function, detaching the doc from its function. Fixed: moved `TOOL_PAIRS` (+ its doc) above the `assertPresetCoverage` JSDoc so the doc reattaches. Shared rebuild + 36 tool-visibility tests re-run green. Applied during review.

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

None — no debugging required; build/test/lint/type-check green on first full run after implementation.

### Completion Notes List

- Transcribed all 5 rosters directly from spec §2.5's ✓/— tables (not from memory), cross-checked cell-by-cell against the lead-verified live tool-name sets given in the assignment (dev 28, admin 26, interop 22, ops 21, data 7) before writing each `presets.ts`.
- `TOOL_PAIRS` added to `packages/shared/src/tool-visibility.ts` with the single `["iris_env_diff", "iris_env_promote"]` pair, re-exported from `packages/shared/src/index.ts`. No shared `assertToolPairsCovisible` helper was added — the co-visibility assertion lives inline in dev-mcp's `presets.test.ts` (the only package that owns both pair members), per the task's "dev's choice" note.
- Wired `toolPresets` into all 5 `packages/<pkg>/src/index.ts` files alongside the existing `tools,` option — this activates `assertPresetCoverage` at `McpServerBase` construction time (Story 30.0's engine); confirmed no construction-time throw via the full `pnpm turbo run test` pass (every server instantiated multiple times across `index.test.ts` + the new `presets.test.ts`).
- Followed the packages' EXISTING test-location convention (`src/__tests__/*.test.ts`) rather than the story's alternative `src/tools/__tests__/` suggestion — every one of the ~170 existing test files across all 5 packages lives under `src/__tests__/`, so `presets.test.ts` was placed there for consistency (removed the empty `src/tools/__tests__/` scratch dirs created during initial exploration before any file was written into them).
- Each `presets.test.ts` independently re-derives set equality/overlap (not just "assertPresetCoverage does not throw") so a future transcription slip fails naming the specific tool via a `toEqual([])` diff, per AC 30.1.2's "failing with the offending tool name" requirement — this is a mechanical, human-readable check layered on top of (not a replacement for) the `assertPresetCoverage` call.
- Roster sizes pinned exactly per package in each `presets.test.ts` (Rule #36 oracle discipline) AND cross-checked against the spec §2.5 "Roster summary" table: core 12/12/9/9/7 (dev/admin/interop/ops/data), developer 28/10/22/9/7 — all match.
- Verified Rule #31 by diffing every package's `tools/index.ts` and `index.test.ts` before vs. after — zero changes; `git diff` confirms no hunks in those 10 files.
- `pnpm turbo run build` (6/6), `pnpm turbo run test` (13/13 tasks, all pre-existing tests green + new `presets.test.ts`/extended `tool-visibility.test.ts` green), `pnpm turbo run lint type-check` (18/18) all green. `pnpm gen:governance-baseline:check` exits 0, frozen baseline `1e62c5ad5bf7` (141 frozen / 201 live / 60 post-foundation) unchanged from post-Story-30.0. No ObjectScript/bootstrap touched; `BOOTSTRAP_VERSION` unaffected (TS-only story).
- Story 30.2 (`toolVisibility` surfacing on `iris_server_profiles` + governance-report hidden-key omission) and Story 30.3 (docs + live smokes + payload measurement) are explicitly out of scope here and untouched.

### File List

- packages/shared/src/tool-visibility.ts (modified — added `TOOL_PAIRS` export)
- packages/shared/src/index.ts (modified — re-exported `TOOL_PAIRS`)
- packages/shared/src/__tests__/tool-visibility.test.ts (modified — added `TOOL_PAIRS` import + a small shape/content `describe` block)
- packages/iris-dev-mcp/src/tools/presets.ts (new)
- packages/iris-dev-mcp/src/index.ts (modified — wired `toolPresets`)
- packages/iris-dev-mcp/src/__tests__/presets.test.ts (new)
- packages/iris-admin-mcp/src/tools/presets.ts (new)
- packages/iris-admin-mcp/src/index.ts (modified — wired `toolPresets`)
- packages/iris-admin-mcp/src/__tests__/presets.test.ts (new)
- packages/iris-interop-mcp/src/tools/presets.ts (new)
- packages/iris-interop-mcp/src/index.ts (modified — wired `toolPresets`)
- packages/iris-interop-mcp/src/__tests__/presets.test.ts (new)
- packages/iris-ops-mcp/src/tools/presets.ts (new)
- packages/iris-ops-mcp/src/index.ts (modified — wired `toolPresets`)
- packages/iris-ops-mcp/src/__tests__/presets.test.ts (new)
- packages/iris-data-mcp/src/tools/presets.ts (new)
- packages/iris-data-mcp/src/index.ts (modified — wired `toolPresets`)
- packages/iris-data-mcp/src/__tests__/presets.test.ts (new)

## Change Log

- 2026-07-20 — Story created (lead, /epic-cycle 30). Rosters × 5 (spec §2.5) + toolPresets wiring + coverage/pairs/count guards. Ready for dev.
- 2026-07-20 — Dev complete (claude-sonnet-5). All 5 `presets.ts` transcribed from spec §2.5, wired into each package's `McpServerBase` construction via `toolPresets`; `TOOL_PAIRS` added to shared; per-package coverage/count tests + a dev-mcp `TOOL_PAIRS` co-visibility test added. `pnpm turbo run build test lint type-check` green (18/18 tasks); `gen:governance-baseline:check` exit 0, frozen baseline unchanged. Rule #31 verified — zero changes to any package `tools[]` array or `index.test.ts` count assertion. Status → review.
