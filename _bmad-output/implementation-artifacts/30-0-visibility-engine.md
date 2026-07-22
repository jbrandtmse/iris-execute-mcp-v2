# Story 30.0: Visibility Engine (shared)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **suite operator running an MCP server for a small/weak model**,
I want **a config-driven advertise-time visibility layer that filters which tools are registered (env-var presets + per-tool enable/disable), evaluated once at server construction**,
so that **I can trim any server to a research-backed ~10-tool core with one environment variable — while call-time governance, tool counts, and (unset-env) today's `tools/list` are all byte-for-byte unchanged**.

## Acceptance Criteria

- **AC 30.0.1 — Env parsing (fail-fast style, mirroring `parseGovernancePreset`).**
  - Unknown `IRIS_TOOLS_PRESET` value → **fail fast at startup** naming the valid values (`full`, `core`, `developer`). Unset/empty ⇒ `full` (default).
  - `IRIS_TOOLS_DISABLE` / `IRIS_TOOLS_ENABLE`: comma-separated tool names, whitespace trimmed, trailing-`*` wildcard supported (`iris_doc_*` matches the family). A bare `*` (whole token) is **rejected** (fail fast).
  - Unknown tool names in either list → **WARN, not fail** (the env block is shared across all 5 servers, so a dev-server tool name is legitimately "unknown" to the data server). A wildcard matching zero tools also **warns**.
  - The same **literal** name in both `DISABLE` and `ENABLE` → startup **warning** (ENABLE wins per precedence); NOT an error (wildcard-expansion overlap is intended usage).
  - `iris_server_profiles` named **literally** in `IRIS_TOOLS_DISABLE` → **fail fast** (deliberate misconfiguration of the reserved discovery tool). A wildcard that would match it silently **skips** it (no fail, no warn required for the wildcard case).
- **AC 30.0.2 — Resolution & constructor filter (spec §2.2 / §2.3).**
  - Per-tool visibility = `ENABLE-match ?? DISABLE-match(inverted) ?? presetRoster(tool) ?? true` — precedence **ENABLE > DISABLE > preset > default-visible**; trailing-`*` wildcards expand in both lists.
  - The filter is applied at the `McpServerBase` **constructor** registration loop ([server-base.ts:459-462](../../packages/shared/src/server-base.ts#L459-L462)): a hidden tool never reaches `this.registerTool` — absent from the SDK registry, from `tools/list`, and from governance key derivation.
  - A hidden tool is absent from `tools/list` **AND** calling it returns the SDK's **standard unknown-tool error** (no custom envelope, no `GOVERNANCE_DISABLED` error).
  - The dynamic `addTools()` path ([server-base.ts:1500-1503](../../packages/shared/src/server-base.ts#L1500)) applies the **same** filter (a hidden tool added at runtime stays hidden). `removeTools()` is unchanged. **Do NOT build runtime toggling** (spec §5 out-of-scope).
  - A startup log line (stderr, existing `logger` style) reports active preset + visible/hidden counts + any warnings from AC 30.0.1.
- **AC 30.0.3 — `assertPresetCoverage` (sibling of `assertGovernanceClassification`).** For every **named** preset (`core`, `developer` — NOT `full`), `include ∪ exclude` must EQUAL the package tool-name set exactly, with `include ∩ exclude = ∅`. A violation **throws at construction**, naming the offending tool + preset. `full` is reserved (= all tools) and cannot be defined in a roster. When `options.toolPresets` is **absent** (no package wired rosters yet — the state until Story 30.1), the assert is a no-op and the engine treats every named preset as "all tools visible" so behavior is unchanged.
- **AC 30.0.4 — Rule #19 back-compat capstone (DEFAULT suite).** With **no** visibility env vars set, each of the 5 servers' registered tool-name set **deep-equals its pre-feature snapshot**. Mechanical `toEqual`/set-equality, all 5 packages, running in the default `pnpm test` suite (NOT a `*.integration.test.ts` suffix).

### Integration ACs

This story introduces the **visibility engine** (`packages/shared/src/tool-visibility.ts`), the constructor filter, `assertPresetCoverage`, and the new optional `McpServerBaseOptions.toolPresets` field. The engine is **exercised end-to-end within this story's own ACs**: AC 30.0.2 drives the real `McpServerBase` constructor → `tools/list` → an unknown-tool call on a hidden name, and AC 30.0.4 constructs all 5 real servers. The **preset-roster consumers** (the `presets.ts` × 5 packages wired via `toolPresets`) land in **Story 30.1** — until then `options.toolPresets` is absent and the engine is a no-op filter over env vars only (AC 30.0.3 handles the absent-rosters case). No consumer beyond this epic; the first roster consumer is Story 30.1.

## Tasks / Subtasks

- [x] **Task 1 — Create the visibility engine module** (AC: 30.0.1, 30.0.2, 30.0.3)
  - [x] New `packages/shared/src/tool-visibility.ts`. Export `TOOL_PRESET_NAMES = ["full", "core", "developer"] as const` and a `ToolPresetName` type; `full` is reserved (all tools), only `core`/`developer` are definable in rosters.
  - [x] Export `ToolPresetRosters` type: `{ core: { include: string[]; exclude: string[] }; developer: { include: string[]; exclude: string[] } }` (the shape a package's `presets.ts` exports). Mirror the JSDoc-banner + naming conventions of `governance.ts`.
  - [x] Export `parseToolVisibilityConfig(env = process.env)`: parse `IRIS_TOOLS_PRESET` (fail-fast on unknown value naming valid ones — mirror [`parseGovernancePreset`](../../packages/shared/src/governance.ts#L346-L359) error style), `IRIS_TOOLS_DISABLE`, `IRIS_TOOLS_ENABLE` (trim, split on comma, drop empties, reject bare `*`). Return a structured config `{ preset, disable: string[], enable: string[] }`. Collect (do not throw) warnings for return/logging where AC 30.0.1 says WARN.
  - [x] Export `resolveVisibleTools({ toolNames, config, rosters, reservedName })`: apply precedence `ENABLE > DISABLE > preset > default-visible` with trailing-`*` wildcard matching; ALWAYS keep `reservedName` (`iris_server_profiles`) visible; produce `{ visible: Set<string>, warnings: string[] }`. Detect: literal-in-both-lists (warn, ENABLE wins), unknown literal names (warn), zero-match wildcards (warn), literal `iris_server_profiles` in DISABLE (throw — but see seam note: the reserved tool is registered OUTSIDE `options.tools`, so guard on the literal appearing in the parsed disable list).
  - [x] Export `assertPresetCoverage(rosters, toolNames)`: for `core` and `developer`, assert `include ∪ exclude === toolNames` and `include ∩ exclude === ∅`; throw naming the first offending tool + preset (message shape modeled on [`assertGovernanceClassification`](../../packages/shared/src/governance.ts#L521-L542)). No-op when `rosters` is undefined.
  - [x] Re-export the new public symbols from `packages/shared/src/index.ts`.
- [x] **Task 2 — Add the `toolPresets` option + wire the constructor filter** (AC: 30.0.2, 30.0.3, 30.0.4)
  - [x] Add optional `toolPresets?: ToolPresetRosters` to [`McpServerBaseOptions`](../../packages/shared/src/server-base.ts#L152-L171) with a JSDoc banner explaining it is per-package and consumed by the visibility filter (default: absent ⇒ all tools visible under every preset).
  - [x] In the constructor ([server-base.ts:459-462](../../packages/shared/src/server-base.ts#L459-L462)), BEFORE the `for (const tool of options.tools)` loop: parse visibility config from env, run `assertPresetCoverage(options.toolPresets, options.tools.map(t => t.name))` (no-op when absent), compute the visible set via `resolveVisibleTools`, then register ONLY visible tools. Store the resolved `{ preset, visibleCount, hiddenCount }` on a private field for Story 30.2's `toolVisibility` surfacing (this story only needs the counts internally + the log line).
  - [x] Add a code comment on the **asymmetry**: visibility env is parsed in the **constructor** (registration is constructor-time), whereas `IRIS_GOVERNANCE` is parsed in `start()`. A constructor throw is still a clean startup crash (same operator UX as existing fail-fast paths).
  - [x] Keep the `iris_server_profiles` registration ([server-base.ts:481](../../packages/shared/src/server-base.ts#L481)) **unconditional** — it is registered outside/after the `options.tools` filter loop, so it is never filtered. Verify the visible-count log line + `defaultEnabledWrites`/`rebuildMutatesLookup`/`assertGovernanceClassified` still operate on the FILTERED live registry (hidden tools contribute no governance keys — that is the intended "invisible to governance derivation" property).
  - [x] Apply the same filter in `addTools()` ([server-base.ts:1500-1503](../../packages/shared/src/server-base.ts#L1500)): a hidden tool added at runtime is not registered. Reuse the resolved visible-set predicate (store the parsed config / a `isVisible(name)` closure on a private field so `addTools` and the constructor share one source of truth).
  - [x] Emit the startup log line via the existing `logger` (stderr) — active preset + visible/hidden counts + accumulated warnings.
- [x] **Task 3 — Unit tests for every §2.2 edge** (AC: 30.0.1, 30.0.2, 30.0.3)
  - [x] New `packages/shared/src/__tests__/tool-visibility.test.ts`: unknown preset throws naming valid values; bare `*` rejected; trailing-`*` wildcard expansion; precedence ENABLE>DISABLE>preset>default (incl. the `iris_doc_*` DISABLE + `iris_doc_get` ENABLE hole-punch); literal-in-both warns (ENABLE wins); unknown-name warns; zero-match wildcard warns; literal `iris_server_profiles` in DISABLE throws; wildcard skips `iris_server_profiles` silently; `assertPresetCoverage` throws on missing + on overlapping disposition, passes on exact cover; absent rosters ⇒ no-op.
  - [x] Constructor-level test (build a real `McpServerBase` with a small synthetic tool array + env overrides): hidden tool absent from `getToolNames()`; calling a hidden tool via the SDK path returns the **standard unknown-tool error** (assert it is NOT a `GOVERNANCE_DISABLED`/custom envelope); `addTools` of a hidden-by-config tool leaves it unregistered.
- [x] **Task 4 — Rule #19 back-compat capstone** (AC: 30.0.4)
  - [x] New `packages/shared/src/__tests__/tool-visibility-backcompat.test.ts` (DEFAULT suite — no `.integration.` suffix): for each of the 5 server packages, construct the real server with NO visibility env vars and assert its `getToolNames()` set **deep-equals** a captured pre-feature snapshot (the current registered set). Prefer importing each package's constructed server or its `tools` array so the snapshot is derived from source, not hand-authored. This is the epic-done gate's back-compat proof; it must fail if the filter ever drops a tool under empty env.
- [x] **Task 5 — Verify & self-check**
  - [x] `pnpm --filter @iris-mcp/shared build` clean; `pnpm --filter @iris-mcp/shared test` green (no regressions in the 765+ existing tests).
  - [x] `pnpm gen:governance-baseline:check` exits 0 (frozen baseline `1e62c5ad5bf7`, 141 keys, UNCHANGED — the filter must not perturb governance key derivation under empty env).
  - [x] No new tool, no new governance key, no `BOOTSTRAP_VERSION` bump, no ObjectScript change — confirm `git diff` touches only `packages/shared/src/**` (+ index re-export).

## Dev Notes

- **This is a framework-only (`@iris-mcp/shared`) TS story.** Zero ObjectScript, zero bootstrap. The whole epic is strictly additive (Rule #19 is a release gate). Do NOT touch `governance-baseline.ts`, any `bootstrap-classes.ts`, or `BOOTSTRAP_VERSION`.
- **Two orthogonal layers (spec §2.1).** Visibility answers "does the agent know this exists?" (per-**tool**, enforced at registration); governance answers "is this call allowed?" (per-**action**, enforced at `dispatchToolCall`). Visibility is evaluated FIRST by construction — a hidden tool can never reach the governance gate. An `IRIS_GOVERNANCE` key naming a hidden tool stays legal and inert. Do NOT conflate: `read-only` **safety** is still `IRIS_GOVERNANCE_PRESET=read-only`, never a visibility preset.
- **Enforcement seam (spec §2.3).** The single choke point is the constructor loop at [server-base.ts:459-462](../../packages/shared/src/server-base.ts#L459-L462) (the same place D2 injects the `server` param and where all 5 packages flow through). Register only the visible subset; hidden tools never reach `mcpServer.registerTool`.
- **Reserved tool.** `iris_server_profiles` (`SERVER_DISCOVERY_TOOL_NAME`, [server-discovery.ts:44](../../packages/shared/src/server-discovery.ts#L44)) is registered unconditionally at [server-base.ts:481](../../packages/shared/src/server-base.ts#L481), OUTSIDE the `options.tools` loop — so it is structurally never filtered. The only work for the reserved tool: fail-fast if it is named *literally* in `IRIS_TOOLS_DISABLE` (a deliberate misconfiguration), and silently skip it for wildcard matches. It is the discovery surface every server's MCP instructions say to call FIRST and the diagnostic for this feature.
- **Governance derivation must stay consistent.** After filtering, `rebuildMutatesLookup`/`rebuildGovernedKeys`/`assertGovernanceClassified` ([server-base.ts:483-497](../../packages/shared/src/server-base.ts#L483-L497)) run on the FILTERED `this.tools` registry. Under empty env nothing is filtered ⇒ governance keys are byte-for-byte today's (AC 30.0.4 + the `gen:governance-baseline:check` gate prove this). Under a preset, hidden tools legitimately contribute no keys — that is the intended "invisible to governance key derivation" property (spec §2.3 step 3), and it is fine because the config is shared and governance already tolerates keys for tools a server doesn't host.
- **Fail-fast style to mirror.** [`parseGovernancePreset`](../../packages/shared/src/governance.ts#L346-L359) (unknown value → `throw presetError(...)` naming `VALID_PRESETS`) and [`assertGovernanceClassification`](../../packages/shared/src/governance.ts#L521-L542) (collect offenders, sort, throw a single message naming all). Match that voice for `parseToolVisibilityConfig` and `assertPresetCoverage`.
- **Out of scope here (do NOT build):** runtime toggling (`RegisteredTool.enable()/disable()` + `listChanged`); per-action visibility; per-profile visibility; the `toolVisibility` output block on `iris_server_profiles` (that is **Story 30.2**); the preset rosters themselves (**Story 30.1**). This story is the engine + the filter seam + the coverage assert + the two test gates.
- **Testing standards.** Vitest, tests in `packages/shared/src/__tests__/`. Assertion macros/patterns follow the existing suite. The back-compat test MUST be in the default run (no `.integration.` suffix) — it is the epic's Rule #19 gate. Prefer deriving snapshots from source (import the package tool arrays) over hand-authored name lists, so the test cannot silently rot.

### Project Structure Notes

- New file: `packages/shared/src/tool-visibility.ts` (engine + types + parse + resolve + assert). New tests: `packages/shared/src/__tests__/tool-visibility.test.ts`, `packages/shared/src/__tests__/tool-visibility-backcompat.test.ts`.
- Edited: `packages/shared/src/server-base.ts` (add `toolPresets` to `McpServerBaseOptions`; constructor filter; `addTools` filter; startup log line; private field(s) for the resolved visibility state), `packages/shared/src/index.ts` (re-export new public symbols).
- No package `tools[]` array is touched in this story (Rule #31 — no tool counts move anywhere; the count assertions in each package's `index.test.ts` stay byte-for-byte). The per-package `presets.ts` wiring is Story 30.1.
- Naming: engine module named `tool-visibility.ts` to match the architecture I1/I2 record and spec §2.4 (`shared/src/tool-visibility.ts`).

### References

- [Source: _bmad-output/planning-artifacts/research/feature-specs/11-tool-visibility-presets.md#2.2] — env vars & resolution (`ENABLE > DISABLE > preset > default-visible`, wildcard, edge semantics).
- [Source: _bmad-output/planning-artifacts/research/feature-specs/11-tool-visibility-presets.md#2.3] — enforcement seam (filter before registration; reserved tool; `addTools` filter; no runtime toggling).
- [Source: _bmad-output/planning-artifacts/research/feature-specs/11-tool-visibility-presets.md#2.4] — rosters ownership, `assertPresetCoverage`, `TOOL_PRESET_NAMES`.
- [Source: _bmad-output/planning-artifacts/research/feature-specs/11-tool-visibility-presets.md#3] — Story 1 scope; [#4] — ACs 1-7 map to this story's AC 30.0.1-30.0.4.
- [Source: _bmad-output/planning-artifacts/epics.md#Story-30.0] — AC 30.0.1-30.0.4.
- [Source: _bmad-output/planning-artifacts/architecture.md#I1] — advertise-time visibility layer in front of the D5 gate.
- [Source: _bmad-output/planning-artifacts/architecture.md#I2] — package-owned rosters + registration-time coverage.
- [Source: packages/shared/src/server-base.ts#L433-L526] — constructor registration order (filter seam at L459-462; reserved-tool registration at L481; governance rebuilds L483-497).
- [Source: packages/shared/src/governance.ts#L346-L359] — `parseGovernancePreset` fail-fast style to mirror.
- [Source: packages/shared/src/governance.ts#L521-L542] — `assertGovernanceClassification` throw shape to mirror for `assertPresetCoverage`.
- [Source: .claude/rules/project-rules.md#53] — every new tool declares an explicit include/exclude disposition per preset (the coverage-assert contract this engine enforces); [#19] additive back-compat proof; [#31] tool counts don't move; [#28] the `mutates`-classification analog `assertPresetCoverage` mirrors.

## Review Findings

**Code review 2026-07-19 (bmad-code-review, 3-layer adversarial: Blind Hunter + Edge Case Hunter + Acceptance Auditor, Opus).** Outcome: **0 HIGH, 0 MEDIUM (after context triage), 0 patch, 4 defer (all LOW, Epic-30-own), 2 dismissed.** Status → `done`.

Independently verified before triage:
- **Rule #19 gate is GENUINE and doubly-protected.** The AC 30.0.4 capstone (`tool-visibility-backcompat.test.ts`) transcribes each package's tool-name roster from spec §2.5 rather than importing the leaf `tools` arrays — a documented, Rule #45-justified deviation (shared cannot depend on leaf packages; shared builds first). Confirmed the dev's claim holds: each leaf package's own untouched `src/__tests__/index.test.ts` constructs the SAME `McpServerBase` class with its REAL `tools` array under empty env and asserts exact `getToolNames()` equality (dev 28+1, admin 26+1, interop 22+1, ops 21+1, data 7+1 — all reconcile with the capstone snapshot). A filter regression that dropped/added a real tool under empty env would fail BOTH the leaf tests AND the capstone. Not a HIGH finding.
- **`pnpm gen:governance-baseline:check` exits 0** — frozen baseline `1e62c5ad5bf7` (141 keys) unchanged; 201 live / 60 post-foundation unaffected. `governance-baseline.ts` git-clean.
- **Rule #31 held** — no package `tools[]` array or count assertion moved (leaf `index.test.ts` counts byte-for-byte unchanged; visibility engine is package-array-agnostic).
- **Rule #53** — `assertPresetCoverage` is a faithful every-tool-declares-a-disposition analog of `assertGovernanceClassification` (collect-all-offenders-then-throw-one-message shape; no-op when rosters absent).
- **ADRs I1/I2 conformant**; **Integration ACs honest** — the engine IS exercised end-to-end within this story (e2e drives the real SDK `tools/list`/`tools/call` wire + a real wired `toolPresets` roster under `core` vs `full`); roster consumers (`presets.ts` × 5) genuinely land in Story 30.1.
- **Rule #3 (real-runtime test evidence) satisfied** — `tool-visibility.e2e.test.ts` (QA, 10 wire-level tests) drives the real SDK surfaces at construction, in the default suite.
- **Engine logic sound** — precedence ENABLE>DISABLE>preset>default, trailing-`*` wildcard, reserved-tool literal-throw/wildcard-skip, `isToolVisible` single-name path decision-equivalent to the batch path, and counts all verified correct by all three layers. No shared-state/ordering/off-by-one defects.

### Deferred (LOW, Epic-30-own — below Rule #37 ≥3-re-deferral threshold; inherited ledger is at ZERO)

- [x] [Review][Defer] `addTools()` dynamic-add bypasses named-preset roster curation [packages/shared/src/tool-visibility.ts:279-285] — under a wired roster + `IRIS_TOOLS_PRESET=core`, a tool added at runtime that is in neither `include` nor `exclude` defaults to visible (`presetVisible` → `undefined` → `?? true`). Zero impact in 30.0 (no rosters wired anywhere) and `addTools` has NO production usage (tests only); also plausibly correct-by-design (`assertPresetCoverage` structurally forbids a roster from listing a non-registered/dynamic tool). Suggested resolution: Story 30.1 confirms the intended semantics when it wires the rosters.
- [x] [Review][Defer] A named preset requested against a package with unwired rosters is a silent no-op (no operator warning) [packages/shared/src/tool-visibility.ts:280] — `IRIS_TOOLS_PRESET=core` on an unwired package shows the full set with `hidden=0` and no warning. This is *specified* behavior (AC 30.0.3: absent rosters ⇒ every named preset behaves like `full`); only the diagnostic warning is missing. Relevant only in the 30.0→30.1 transition window. Suggested resolution: Story 30.1 (all 5 wired) closes the window; optionally emit a warn when a named preset resolves with rosters absent.
- [x] [Review][Defer] AC 30.0.4 capstone snapshot is transcribed from spec §2.5, not source-derived from the leaf `tools` arrays [packages/shared/src/__tests__/tool-visibility-backcompat.test.ts] — weaker than Task 4's "prefer importing … derived from source" wording; the aggregate Rule #19 property is nonetheless genuinely gated (see verification above). Suggested resolution: add a source-derived all-5-real-arrays back-compat check in `packages/iris-mcp-all` (the one package that legitimately depends on all five — Rule #45) during Epic 30.
- [x] [Review][Defer] Spec §2.2 "config hiding EVERY package tool ⇒ startup warning" not implemented [packages/shared/src/tool-visibility.ts resolveVisibleTools] — `resolveVisibleTools` warns on literal-dup/unknown-name/zero-match-wildcard but not on an empty resolved visible set; not enumerated in AC 30.0.1. Diagnostic nicety, no correctness impact. Suggested resolution: push a warning when the visible set (minus the reserved tool) is empty; fold into Story 30.1/30.2.

### Dismissed (noise / working-as-designed)

- `IRIS_TOOLS_PRESET` value is not trimmed (`"core "` fails fast) — faithfully mirrors `parseGovernancePreset`, which the story explicitly required mirroring; fail-fast (not silent-wrong); changing only this parser would diverge from its sibling.
- Non-trailing wildcards (`*_get`, `iris_*_doc`) are treated as literals — documented trailing-`*`-only contract; produces a zero-match/unknown-name warning rather than mis-hiding.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

None (no ObjectScript, no `^ClineDebug` needed — pure TS unit/construction tests).

### Completion Notes List

- Implemented `packages/shared/src/tool-visibility.ts`: `TOOL_PRESET_NAMES`/`ToolPresetName`, `ToolPresetRoster`/`ToolPresetRosters`, `ToolVisibilityConfig`, `parseToolVisibilityConfig` (fail-fast on unknown `IRIS_TOOLS_PRESET` and on a bare `*` token in `IRIS_TOOLS_DISABLE`/`IRIS_TOOLS_ENABLE`, mirroring `parseGovernancePreset`'s error style), `resolveVisibleTools` (precedence ENABLE > DISABLE > preset > default-visible, trailing-`*` wildcard matching, all AC 30.0.1 warning/throw conditions), `assertPresetCoverage` (mirrors `assertGovernanceClassification`'s collect-all-then-throw-one-message shape; no-op when `rosters` is `undefined`).
- Wired the constructor filter in `server-base.ts`: `toolPresets?: ToolPresetRosters` added to `McpServerBaseOptions`; the constructor now parses `IRIS_TOOLS_*` (with an explicit code-comment on the parse-timing asymmetry vs. `IRIS_GOVERNANCE`'s `start()`-time parse), runs `assertPresetCoverage`, resolves the visible set, registers ONLY visible tools, and logs a single startup line (`Tool visibility: preset="…" visible=N hidden=N [warnings=N]`) via the existing stderr `logger`. `iris_server_profiles` stays registered unconditionally, outside the filter (unchanged). Added a private `isToolVisible(name)` helper (reuses `resolveVisibleTools` for a single name) so `addTools()` applies the IDENTICAL filter to dynamically-added tools; `removeTools()` is untouched per spec.
- Re-exported the new public symbols from `packages/shared/src/index.ts`.
- Task 3: `packages/shared/src/__tests__/tool-visibility.test.ts` (34 tests) — every §2.2 edge on the pure functions, plus 6 construction-level tests against a REAL `McpServerBase` (no `start()`/no IRIS needed): hidden tool absent from `getToolNames()`; calling a hidden tool over the real `tools/call` wire returns the SDK's own `McpError(InvalidParams, "Tool … not found")` shape (resolved by the SDK to `isError:true` with no `structuredContent`) — verified as structurally DIFFERENT from a `GOVERNANCE_DISABLED` denial; `addTools()` leaves a hidden-by-config dynamically-added tool unregistered; the absent-rosters no-op under `IRIS_TOOLS_PRESET=core`.
- Task 4: `packages/shared/src/__tests__/tool-visibility-backcompat.test.ts` (6 tests) — the AC 30.0.4 capstone. **Deviation from the story's literal file-location assumption, documented in the test file's own banner**: it constructs 5 REAL `McpServerBase` instances (same class/constructor/filter code every real server flows through) seeded with each package's current tool-NAME roster transcribed verbatim from the approved spec table (`11-tool-visibility-presets.md` §2.5), rather than importing the five leaf packages' actual `tools` arrays. `@iris-mcp/shared` cannot depend on any leaf package (every one already depends on shared — Rule #45's circular-dependency rule), and — independent of the package.json cycle — Task 5's own self-check requires `pnpm --filter @iris-mcp/shared test` to pass in complete isolation, which a leaf-package dist import would break (shared is built BEFORE the leaf packages; a filtered `--filter @iris-mcp/shared build` never produces their dist). Verified this is not a coverage gap: each leaf package's own `src/__tests__/index.test.ts` (pre-existing, untouched by this story, Rule #31) already independently pins its REAL `tools` array's exact length/content AND constructs the SAME `McpServerBase` class against it — so a regression in the new filter breaks BOTH suites simultaneously. Counts cross-checked live against each package's own test file (`toHaveLength(28)`/`(26)`/`(22)`/`toBeGreaterThanOrEqual(20)` with `toolCount`/`names` = 22/`toHaveLength(7)`).
- Verification (Task 5): `pnpm --filter @iris-mcp/shared build` clean; `pnpm --filter @iris-mcp/shared test` → 47 files / 805 tests green (up from the pre-story 765 baseline by the +40 new tests here — no regressions). `pnpm gen:governance-baseline:check` → exit 0, frozen baseline `1e62c5ad5bf7` / 141 keys unchanged (201 live, 60 post-foundation, unaffected). Additionally ran the FULL monorepo (`pnpm turbo run build` then `pnpm turbo run test`, all 13 packages, beyond what Task 5 strictly required) since `server-base.ts` is shared foundation code every one of the 5 servers' own `index.test.ts` exercises under empty env — all 13 packages green, zero regressions. `git diff` for the implementation is scoped to `packages/shared/src/server-base.ts` + `packages/shared/src/index.ts` (edits) plus the 3 new `packages/shared/src/**` files (tool-visibility.ts + 2 test files) — no ObjectScript, no bootstrap, no package `tools[]` array, no governance-baseline file touched.

### File List

- `packages/shared/src/tool-visibility.ts` (new)
- `packages/shared/src/server-base.ts` (edited — `toolPresets` option, constructor filter, `isToolVisible`/`addTools` filter, startup log line)
- `packages/shared/src/index.ts` (edited — re-export new public symbols)
- `packages/shared/src/__tests__/tool-visibility.test.ts` (new)
- `packages/shared/src/__tests__/tool-visibility-backcompat.test.ts` (new)

## Change Log

- 2026-07-20 — Story created (lead, /epic-cycle 30). Engine + constructor filter + coverage assert + Rule #19 capstone. Ready for dev.
- 2026-07-20 — Dev complete (bmad-dev-story). Visibility engine (`tool-visibility.ts`) + constructor/`addTools` filter wired in `server-base.ts` + barrel re-export. 34 unit/construction tests (`tool-visibility.test.ts`) + 6-test Rule #19 back-compat capstone (`tool-visibility-backcompat.test.ts`, deviation from the story's literal shared-package leaf-import assumption documented above and in the test file banner — Rule #45 circular-dependency + Task 5's own standalone-test-in-isolation requirement). `pnpm --filter @iris-mcp/shared test` 805/805 (+40 new); full monorepo `pnpm turbo run build`/`test` 13/13 packages green; `gen:governance-baseline:check` exit 0 (141 frozen keys unchanged). Status → review.
