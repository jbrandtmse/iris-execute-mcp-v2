# Story 30.2: Surfacing + Payload Measurement

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **suite operator debugging "why is tool X missing?" and an owner validating the small-model win**,
I want **`iris_server_profiles` to report the active preset + visible/hidden tool COUNTS, the governance report/resource to stay self-consistent by omitting hidden tools' keys, and a script that measures the `tools/list` payload per server × preset**,
so that **a support question resolves in one discovery call, the agent's governance view never references tools it cannot see, and the "helps small models" claim becomes recorded bytes/tokens rather than a vibe**.

## Acceptance Criteria

- **AC 30.2.1 — `toolVisibility` block on `iris_server_profiles` output.** The discovery result (`ServerDiscoveryResult`, [server-discovery.ts:99-111](../../packages/shared/src/server-discovery.ts#L99-L111)) gains `toolVisibility: { preset: "full" | "core" | "developer", visibleTools: number, hiddenTools: number }`. **Counts only — hidden tool NAMES are deliberately NOT disclosed** (invisible means invisible; the operator diagnoses via env vars + README roster tables). Present under **every** configuration, including default `full` (where `hiddenTools` is 0). Sourced from the already-stored `this.toolVisibility` state ([server-base.ts:470,536](../../packages/shared/src/server-base.ts#L470)); threaded into `computeServerDiscovery`. `iris_server_profiles` itself (the reserved framework tool) is counted as visible.
- **AC 30.2.2 — Governance report + resource omit hidden tools' keys.** The effective-governance policy map reported by `iris_server_profiles` (`governance.policy` / `governance.policies`) AND the `iris-governance://{profile}` resource (`buildGovernancePolicyResult`) **omit every governance key belonging to a hidden tool** — including baseline (frozen) keys, since a hidden tool's baseline keys still live in `this.governedKeys` (`rebuildGovernedKeys` unions `GOVERNANCE_BASELINE`). One assertion each (tool + resource). An `IRIS_GOVERNANCE` key naming a hidden tool remains **legal and inert** (parsing/validation unchanged — governance already tolerates keys for tools a server doesn't host); only the *reported* view is filtered so the agent's picture stays self-consistent. The filter is a single shared helper used by BOTH surfaces so they cannot drift (mirror the existing "same `getEffectivePolicy` call" non-drift discipline).
- **AC 30.2.3 — Payload measurement script.** New `scripts/measure-tools-payload.mjs` (+ a `measure:tools-payload` root `package.json` script). For each of the 5 servers × each preset (`full`, `core`, `developer`): construct the real server (or drive the real `tools/list` handler), serialize the `tools/list` result, and report **tool count, `tools/list` JSON bytes, and ~tokens (`bytes / 4` heuristic — NO new tokenizer dependency)**. Output a markdown table. The measured table is recorded in (a) the story's Completion Notes (source of truth) AND (b) a minimal "Tool Visibility Presets" section in the root `README.md` housing the measurement table (Rule #43 — the capability ships minimal docs itself; Story 30.3's docs rollup ENRICHES this section with roster tables + layering rules, it does not first-create it). Requires a prior `pnpm turbo run build` (mirror `scripts/lib/tool-catalog.mjs`'s built-dist loading).

### Integration ACs

This story consumes the Story 30.0 engine (`this.toolVisibility` state, the visible/hidden resolution) and the Story 30.1 rosters (the measurement table needs real per-preset tool sets). No new consumer is introduced downstream; Story 30.3 (docs + live smokes) enriches the README section this story stubs and drives the live smokes. The surfacing is proven end-to-end via the real `iris_server_profiles` discovery call + the real resource read (unit/e2e assertions in this story).

## Tasks / Subtasks

- [x] **Task 1 — `toolVisibility` on the discovery result** (AC: 30.2.1)
  - [x] Add `toolVisibility: { preset: ToolPresetName; visibleTools: number; hiddenTools: number }` to `ServerDiscoveryResult` in `packages/shared/src/server-discovery.ts`, with a JSDoc banner stating counts-only / no names (deliberate).
  - [x] Add a parameter to `computeServerDiscovery` carrying the resolved visibility state (`{ preset, visibleCount, hiddenCount }`), and include it in the returned result. Default it so existing direct callers/tests don't break, but the real server always passes `this.toolVisibility`.
  - [x] At the discovery-call site in `handleToolCall` ([server-base.ts:1339-1345](../../packages/shared/src/server-base.ts#L1339)), pass `this.toolVisibility` into `computeServerDiscovery`. Confirm `visibleTools` counts the reserved `iris_server_profiles` (i.e. the registered tool count) and the two counts sum to the package tool total + 1.
- [x] **Task 2 — Hidden-key omission (report + resource)** (AC: 30.2.2)
  - [x] Store the hidden-tool NAME set internally at construction (extend the Story 30.0 resolution — you already compute `visible`; the hidden set is `options.tools.map(t=>t.name)` minus `visible`). Private field only; NEVER surfaced.
  - [x] Add a private helper e.g. `visibleGovernedKeys(): Set<string>` = `this.governedKeys` filtered to drop any key whose tool component (the substring before the first `:`, since tool names never contain `:`) is a hidden tool. Use it in BOTH: the `governedKeys` passed to `computeServerDiscovery` (Task 1 site) AND `buildGovernancePolicyResult` (the resource read, ~[server-base.ts:704-731](../../packages/shared/src/server-base.ts#L704)). ONE helper, both surfaces — no drift.
  - [x] Verify parsing/validation of `IRIS_GOVERNANCE` is UNCHANGED — a key naming a hidden tool must still be legal and inert (it simply never appears in the filtered report). Do not touch `parseGovernanceConfig`.
- [x] **Task 3 — Measurement script** (AC: 30.2.3)
  - [x] New `scripts/measure-tools-payload.mjs`. Load each package's `tools` + `toolPresets` from built dist (reuse/mirror `scripts/lib/tool-catalog.mjs`'s `loadAllTools`/`SERVER_PACKAGES` + `pathToFileURL` pattern; import `resolveVisibleTools`/`parseToolVisibilityConfig` OR construct the real `McpServerBase` from `@iris-mcp/shared` dist). For each server × {full, core, developer}: produce the `tools/list` payload (prefer driving the REAL `tools/list` handler so the measured bytes match the wire; the SDK's Zod→JSON-schema conversion is what a client actually receives), then report count / JSON bytes / `Math.round(bytes/4)` tokens.
  - [x] Emit a markdown table (rows = server, columns grouped by preset). Add `"measure:tools-payload": "node scripts/measure-tools-payload.mjs"` to root `package.json`.
  - [x] Run it; paste the table into the story's Completion Notes AND into a new minimal `## Tool Visibility Presets` (or subsection) block in the root `README.md` containing at least the measurement table + a one-line pointer that Story 30.3 completes the section. Keep the README edit MINIMAL and additive — 30.3 owns the full section content.
- [x] **Task 4 — Tests** (AC: 30.2.1, 30.2.2)
  - [x] `toolVisibility` present + correct under `full` (hidden 0), `core`, and a `DISABLE`-driven config — via the real discovery call (new `packages/shared/src/__tests__/tool-visibility-surfacing.test.ts`, using the mocked-bootstrap+fetchMock harness so `server.start()` completes without live IRIS); assert hidden tool NAMES never appear anywhere in the output.
  - [x] AC 30.2.2 report assertion: under `core`, a hidden tool's governance key (`iris_alerts_manage:reset`, a real frozen baseline key) is ABSENT from the discovery `governance.policy` map; and present under `full`.
  - [x] AC 30.2.2 resource assertion: the `iris-governance://{profile}` resource read omits the same hidden tool's key under `core`.
  - [x] Inertness: an `IRIS_GOVERNANCE` config disabling a hidden tool's action parses without error and does not throw / does not resurrect the key in the filtered report.
- [x] **Task 5 — Verify & self-check**
  - [x] `pnpm turbo run build test lint type-check` green; `pnpm gen:governance-baseline:check` exit 0 (frozen `1e62c5ad5bf7` untouched — the FILTER is report-only, the key universe/baseline are unchanged).
  - [x] `pnpm measure:tools-payload` runs and prints the table. Rule #31: no tool `tools[]` array / count assertion moved. No new tool, no governance key, no bootstrap. `git diff` touches only `server-discovery.ts`, `server-base.ts`, the new script(s) + `package.json` script entry, `README.md` (minimal), and test files.

## Dev Notes

- **The scope seam vs Story 30.0/30.1 is already prepared.** Story 30.0 stored `this.toolVisibility = { preset, visibleCount, hiddenCount }` ([server-base.ts:470](../../packages/shared/src/server-base.ts#L470)) explicitly "for Story 30.2's surfacing" — reuse it, don't recompute. You additionally need the hidden-tool NAME set for the key filter (compute it at construction alongside the resolution).
- **Counts, never names (AC 30.2.1).** This is a deliberate product decision (spec §2.6): "invisible means invisible to the agent; the operator diagnoses via env vars + README roster tables." A test must assert hidden names never leak into the discovery output.
- **Why baseline keys must be filtered (AC 30.2.2).** `rebuildGovernedKeys` seeds `governedKeys` with all 141 `GOVERNANCE_BASELINE` keys THEN adds registered-tool keys. Hidden tools aren't in `this.tools`, so their *non-baseline* keys are already gone — but their *baseline* keys survive via the union. The report/resource must drop those too, else the agent sees governance keys for tools it can't call (self-inconsistent). Filter by tool component of each key.
- **One filter helper, both surfaces (non-drift).** The discovery tool and the `iris-governance://` resource already share `getEffectivePolicy` so they never drift; keep that property — a SINGLE `visibleGovernedKeys()` feeds both. A test-worthy invariant: the key set the tool reports == the key set the resource reports, for the same profile+config.
- **Measurement faithfulness (AC 30.2.3).** The honest number is the real wire `tools/list` payload (the SDK's JSON-schema-converted tool list a client receives), not a hand-rolled serialization. Prefer constructing the real `McpServerBase` per preset and driving its `tools/list` handler (the `callRequest`-over-`_requestHandlers` pattern used by `tool-visibility.e2e.test.ts` / `server-discovery.e2e.test.ts`). `~tokens = bytes/4` — no tokenizer dependency (spec §2.7). This turns "should help small models" into recorded numbers.
- **README seam (Rule #43 + #52).** This story ships a MINIMAL README "Tool Visibility Presets" section housing just the measurement table + a pointer; **Story 30.3's docs rollup ENRICHES it** (roster tables, the visibility-vs-governance layering rules, env-var rows across all doc surfaces, per-server READMEs, CHANGELOG, prompt-pack sweep). Do NOT first-document the full section here; do NOT let 30.3 re-measure.
- **Out of scope here:** the full docs rollup + all client-config/*.md + per-server READMEs + CHANGELOG + prompt-pack sweep + the four live smokes (all Story 30.3). Runtime toggling / per-action / per-profile visibility (spec §5).
- **Testing standards.** Vitest; the discovery + resource tests belong in `packages/shared/src/__tests__/` (shared owns both surfaces). The measurement script is a `.mjs` utility, not a vitest test — but a tiny sanity test that it produces a non-empty table for at least one server×preset is welcome if cheap.

### Project Structure Notes

- Edited: `packages/shared/src/server-discovery.ts` (`ServerDiscoveryResult` + `computeServerDiscovery` param), `packages/shared/src/server-base.ts` (thread `this.toolVisibility`; store hidden-name set; `visibleGovernedKeys()` helper used by discovery-call site + `buildGovernancePolicyResult`), possibly `index.ts` (only if a new type is exported), root `README.md` (minimal measurement section), root `package.json` (script entry).
- New: `scripts/measure-tools-payload.mjs`; test additions in `packages/shared/src/__tests__/`.
- Untouched: package `tools[]` arrays, `presets.ts` rosters (30.1), every count assertion (Rule #31), the frozen baseline + `BOOTSTRAP_VERSION`.

### References

- [Source: research/feature-specs/11-tool-visibility-presets.md#2.6] — surfacing & diagnosability (`toolVisibility` block counts-only; report/resource omit hidden keys; startup log).
- [Source: research/feature-specs/11-tool-visibility-presets.md#2.7] — payload measurement (script; count/bytes/~tokens; bytes/4 heuristic; README table).
- [Source: research/feature-specs/11-tool-visibility-presets.md#3] — Story 3 scope; [#4] — ACs 8 & 10.
- [Source: epics.md#Story-30.2] — AC 30.2.1-30.2.3.
- [Source: architecture.md#I1] — the E1 governance report + D6 resource omit hidden tools' keys; `iris_server_profiles` reports `toolVisibility` (counts, never names).
- [Source: packages/shared/src/server-discovery.ts#L99-L232] — `ServerDiscoveryResult` + `computeServerDiscovery` (add `toolVisibility`; filter governedKeys).
- [Source: packages/shared/src/server-base.ts#L470,L536] — the stored `this.toolVisibility` state (Story 30.0 seam); [#L650-L668] `rebuildGovernedKeys` (baseline union — why baseline keys need filtering); [#L704-L731] `buildGovernancePolicyResult` (resource read to filter); [#L1339-L1345] discovery-call site.
- [Source: scripts/lib/tool-catalog.mjs] — built-dist tool-loading pattern for the measurement script.
- [Source: .claude/rules/project-rules.md#43] — capability ships minimal docs; rollup enriches. [#52] documented scope seam. [#31] counts don't move. [#30] default-state at point of use (governed surfaces).

## Review Findings

**Code review 2026-07-20 (bmad-code-review, 3-layer adversarial: Blind Hunter + Edge Case Hunter + Acceptance Auditor; Opus). Final status: DONE — 0 HIGH / 0 MEDIUM remaining (the 1 MEDIUM was fixed in-review). Resolved/patched: 2 · Deferred: 1 (LOW) · Dismissed: 0.**

Independent live verification at review: `pnpm gen:governance-baseline:check` exit 0 (frozen `1e62c5ad5bf7` / 141 keys, 201 live / 60 post-foundation — unchanged; the AC 30.2.2 filter is report-only); measured `tools/list` table reproduced byte-for-byte via `pnpm measure:tools-payload`; no baseline/bootstrap/`tools[]`-array/count-assertion file touched (Rule #31); README edit confirmed minimal + seam-respecting (Rule #43/#52); Acceptance Auditor found 0 AC violations. Confirmed the load-bearing AC 30.2.2 mechanism directly in source: `getEffectivePolicy` iterates ONLY over the passed `allKeys` (uses `GOVERNANCE_BASELINE` solely for the enablement VALUE via `defaultSeed`, never to re-add keys), so feeding the filtered `visibleGovernedKeys()` correctly drops a hidden tool's surviving baseline key from BOTH surfaces; and the reserved `iris_server_profiles` is always-visible (literal disable fails fast), so `+1` is invariant.

- **CR 30.2-1 (Edge Case Hunter) — MEDIUM — RESOLVED in-review.** `toolVisibility` visible/hidden COUNTS were computed once at construction and never refreshed by the dynamic `addTools`/`removeTools` paths — which otherwise carefully keep governance sibling-state (`rebuildMutatesLookup`/`rebuildGovernedKeys`/`assertGovernanceClassified`) in sync. After any dynamic add/remove, `iris_server_profiles` reported stale counts, breaking the story's own `visible + hidden == advertised` invariant. Advisory-only (enforcement reads the live registry) and no production caller today — latent, hence MEDIUM. **Fix**: private `recomputeToolVisibilityCounts()` (live `this.tools.size` visible, tracked `hiddenToolNames.size` hidden — identical to the construction formula at t=0) wired into both paths, plus hidden-name tracking on add and removal; `packages/shared/src/server-base.ts`. +2 regression tests. Full shared suite 825/825 green.
- **CR 30.2-2 (Blind Hunter) — LOW — PATCHED in-review.** The counts-correctness QA test asserted only the algebraically-tautological `visibleTools + hiddenTools === pkg.tools.length + 1` (guaranteed by construction; blind to a wrong split). **Fix**: cross-check `visibleTools` against the REAL `tools/list` wire length (independent SDK-registry path — Rule #36 oracle) and `hiddenTools` against the package roster's `exclude.length`; `packages/iris-mcp-all/src/__tests__/tool-visibility-non-drift.test.ts`.
- **CR 30.2-3 (Edge Case Hunter) — LOW — DEFERRED** → `deferred-work.md` (§ 30-2, item 30-2-1). The "no hidden name leaks" test guards use raw substring scans; production filter is exact and correct, but the test guard could false-FAIL for a future hidden name that is a substring of a visible name/key. Test-robustness only; no current fixture collision. Suggested: token/field-precise leak assertions in a future test-hardening pass.
- **Acceptance Auditor — 0 findings.** All three ACs satisfied; frozen baseline + BOOTSTRAP untouched; Rule #31/#43/#52 held.

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

None — no interactive debugging needed; build/test failures were resolved directly (see Completion Notes for the two real defects hit and fixed).

### Completion Notes List

- **AC 30.2.1 — `toolVisibility` on the discovery result.** `ServerDiscoveryResult` (`server-discovery.ts`) gained `toolVisibility: { preset: ToolPresetName; visibleTools: number; hiddenTools: number }` with a JSDoc banner stating the counts-only/no-names contract. `computeServerDiscovery` gained a `toolVisibility` parameter (defaulted to `{preset:"full", visibleCount:0, hiddenCount:0}` for back-compat with any direct caller that omits it), threaded verbatim into the returned result. The real discovery-call site in `handleToolCall` (server-base.ts) now passes `this.toolVisibility`.
  - **Defect found + fixed during dev (not part of the original diff, corrected here):** the Story-30.0 `this.toolVisibility.visibleCount` counted only VISIBLE `options.tools` members, excluding the reserved `iris_server_profiles` tool itself — so `visibleCount + hiddenCount` summed to `options.tools.length`, not `options.tools.length + 1` as this story's own Task 1 explicitly requires ("iris_server_profiles itself... is counted as visible"; "the two counts sum to the package tool total + 1"). Fixed at the single source in the constructor (`visibleCount: visiblePackageToolCount + 1`) so both the `toolVisibility` block AND the pre-existing startup log line now correctly count the discovery tool. No test previously pinned the old (wrong) exact count, so this is a pure fix, not a behavior break — confirmed via `pnpm --filter @iris-mcp/shared test` (0 regressions, 823/823 green after the fix) and the new AC 30.2.1 test asserting `visibleTools: 3` for a 2-tool package (2 + discovery).
- **AC 30.2.2 — governance report + resource omit hidden tools' keys.** Added a private `hiddenToolNames: Set<string>` (computed once at construction, alongside `toolVisibility`, from `options.tools` minus the resolved visible set — never surfaced) and a private `visibleGovernedKeys()` helper: filters `this.governedKeys` by dropping any key whose tool component (substring before the first `:`) is in `hiddenToolNames`. This SINGLE helper feeds BOTH advisory surfaces — the discovery-call site's `governedKeys` argument to `computeServerDiscovery`, and `buildGovernancePolicyResult`'s `getEffectivePolicy` call (the `iris-governance://{profile}` resource) — so they cannot drift, matching the existing shared-`getEffectivePolicy` non-drift discipline. `parseGovernanceConfig`/`IRIS_GOVERNANCE` parsing is untouched — a key naming a hidden tool stays legal/inert; only the reported view is filtered. Verified against a real frozen baseline key (`iris_alerts_manage:reset`) that survives `rebuildGovernedKeys`'s union with `GOVERNANCE_BASELINE` even though the tool itself is never registered when hidden.
- **AC 30.2.3 — payload measurement script.** New `scripts/measure-tools-payload.mjs` (thin CLI orchestrator) + `scripts/lib/measure-tools-payload-core.mjs` (reusable, side-effect-free helpers: `fetchAllTools`/`measureOne`/`buildMarkdownTable`, split out so a vitest sanity test can import them without triggering a full run — mirrors the `validate-prompts.mjs`/`validate-prompts-core.mjs` split). Constructs a REAL `McpServerBase` (from `@iris-mcp/shared`'s built dist) per {5 servers × 3 presets}, drives the REAL `tools/list` SDK request handler via the `_requestHandlers`-map pattern from `tool-visibility.e2e.test.ts`, and sizes the exact wire payload (SDK's own Zod→JSON-schema conversion). Added `"measure:tools-payload": "node scripts/measure-tools-payload.mjs"` to root `package.json`. Ran it — see the measured table below (also pasted into a new minimal `## Tool Visibility Presets` README section, with a pointer that Story 30.3 completes it).
- **Task 4 — tests.** New `packages/shared/src/__tests__/tool-visibility-surfacing.test.ts` (6 tests) using the mocked-bootstrap + `fetchMock` harness (mirrors `server-discovery.test.ts`) so `server.start()` completes without live IRIS and the discovery TOOL CALL (which needs `this.profiles` built, unlike a resource read) can be driven for real: (1) `toolVisibility` present/correct under `full`/`core`/`IRIS_TOOLS_DISABLE`, with an explicit assertion the hidden tool's NAME never appears anywhere in the serialized output or content text; (2) the discovery tool's `governance.policy` omits `iris_alerts_manage:reset` under `core` and includes it under `full` (same tool, two servers); (3) the `iris-governance://default` resource omits the same key under `core`; (4) an `IRIS_GOVERNANCE` config naming the hidden action parses without error (`server.start()` resolves) and does not resurrect the key in either the discovery report or the resource. Also added a cheap (~1s) sanity test in `packages/iris-mcp-all/src/__tests__/measure-tools-payload.test.ts` (Rule #45 — cross-package tests live in `@iris-mcp/all`) exercising `measureOne`/`buildMarkdownTable` against one real server × preset.
- **Verification.** `pnpm turbo run build test lint type-check`: 25/25 tasks green (823 shared tests incl. the 6 new; 348/334/607/451 ops/interop/dev/admin unaffected; 52 `@iris-mcp/all` incl. the 1 new sanity test). `pnpm gen:governance-baseline:check` exit 0 (141 frozen / 201 live / 60 post-foundation — unchanged; the AC 30.2.2 filter is report-only, never touches the key universe or `parseGovernanceConfig`). No ObjectScript/bootstrap/`tools[]`-array/count-assertion change (Rule #31) — `git diff` scope is exactly `server-discovery.ts`, `server-base.ts`, the new script + its core module, `package.json`'s new script entry, `README.md` (minimal section), and the two new test files.

**Measured `tools/list` payload (AC 30.2.3, `pnpm measure:tools-payload`, 2026-07-20):**

| Server | full (count / bytes / ~tokens) | core (count / bytes / ~tokens) | developer (count / bytes / ~tokens) |
| --- | --- | --- | --- |
| @iris-mcp/dev | 29 / 53,404 / ~13,351 | 13 / 17,749 / ~4,437 | 29 / 53,404 / ~13,351 |
| @iris-mcp/admin | 27 / 44,873 / ~11,218 | 13 / 16,613 / ~4,153 | 11 / 15,973 / ~3,993 |
| @iris-mcp/interop | 23 / 38,332 / ~9,583 | 10 / 20,103 / ~5,026 | 23 / 38,332 / ~9,583 |
| @iris-mcp/ops | 22 / 30,563 / ~7,641 | 10 / 13,565 / ~3,391 | 10 / 14,016 / ~3,504 |
| @iris-mcp/data | 8 / 10,937 / ~2,734 | 8 / 10,937 / ~2,734 | 8 / 10,937 / ~2,734 |

(`~tokens = round(bytes/4)`; `full`/`developer` are identical for `@iris-mcp/dev`/`interop` because their `developer` roster includes every tool; `@iris-mcp/data`'s 7 tools are all `core`+`developer`-visible so all three columns match. `core` is the largest reduction wherever a package defines one — up to ~67% fewer bytes on `@iris-mcp/dev`.)

### File List

- `packages/shared/src/server-discovery.ts` (modified — `toolVisibility` field + `computeServerDiscovery` param)
- `packages/shared/src/server-base.ts` (modified — `hiddenToolNames` field, `visibleGovernedKeys()` helper, discovery-call-site + `buildGovernancePolicyResult` wiring, `visibleCount` +1 fix)
- `packages/shared/src/__tests__/tool-visibility-surfacing.test.ts` (new — 6 tests, AC 30.2.1/30.2.2)
- `packages/iris-mcp-all/src/__tests__/measure-tools-payload.test.ts` (new — 1 sanity test, AC 30.2.3)
- `scripts/measure-tools-payload.mjs` (new — CLI orchestrator)
- `scripts/lib/measure-tools-payload-core.mjs` (new — reusable measurement helpers)
- `package.json` (modified — `measure:tools-payload` script entry)
- `README.md` (modified — minimal `## Tool Visibility Presets` section)

## Change Log

- 2026-07-20 — Story created (lead, /epic-cycle 30). toolVisibility surfacing + hidden-key omission (report+resource) + measure-tools-payload script + minimal README table. Ready for dev.
- 2026-07-20 — Dev complete via bmad-dev-story (claude-sonnet-5). All 5 tasks done: `toolVisibility` block on `iris_server_profiles` (counts-only, hidden names never leak — mechanically asserted); shared `visibleGovernedKeys()` filter used by both the discovery report and the `iris-governance://` resource so a hidden tool's key (including its surviving baseline key) is omitted from both, with `IRIS_GOVERNANCE` parsing proven inert/unchanged for a hidden tool's key; `scripts/measure-tools-payload.mjs` (+ `scripts/lib/measure-tools-payload-core.mjs`) measuring real `tools/list` wire payloads per server × preset, wired to `pnpm measure:tools-payload`, table pasted into Completion Notes + a new minimal README section. Fixed a Story-30.0 off-by-one (`toolVisibility.visibleCount` excluded the reserved discovery tool) surfaced by this story's own AC 30.2.1 requirement. 7 new tests (6 shared + 1 cross-package sanity), 0 regressions across 25 turbo tasks; `gen:governance-baseline:check` exit 0 (141/201/60 unchanged). Status → review.
