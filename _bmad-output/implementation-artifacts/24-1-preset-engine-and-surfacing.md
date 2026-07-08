# Story 24.1: Preset Engine & Surfacing

Status: done

## Story

As a **suite operator**,
I want **`IRIS_GOVERNANCE_PRESET=read-only` to block every write-classified action across all five servers while explicit `IRIS_GOVERNANCE` keys still override, and the active preset surfaced in discovery/resource/denial output**,
so that **I can point the suite at production in read-only mode with one environment variable — and see WHY a call was blocked**.

## Context

Story 24.0 shipped `BASELINE_ACTION_CLASSIFICATIONS` (every frozen-baseline key → `read`/`write`). This story wires it into the governance cascade as a new **preset layer** and surfaces the active preset. The cascade gains one layer between the explicit layers and the default seed:

```
today:  effective = profile.explicit(key) ?? global.explicit(key) ?? defaultSeed(key)
new:    effective = profile.explicit(key) ?? global.explicit(key) ?? presetSeed(key) ?? defaultSeed(key)
```

`presetSeed` is threaded exactly like Epic 20's F2 `defaultEnabledWrites` — an **optional, default-`undefined`/empty** parameter so that **unset preset is byte-for-byte today's behavior** (Rule #19 mechanical proof, required capstone).

**Binding spec:** [research/feature-specs/02-governance-presets.md](./research/feature-specs/02-governance-presets.md) §2.2 + §2.3 + §3 story 2 + AC 1/2/4/5/6. Conventions: [00-conventions.md](./research/feature-specs/00-conventions.md). SQL caps (§2.4) are Story 24.2 — NOT this story.

## Acceptance Criteria

1. **AC 24.1.1 — Cascade + back-compat capstone.** The cascade gains a `presetSeed` layer between the explicit layers and `defaultSeed`, threaded as **optional default-`undefined`/empty** parameters through `defaultSeed`/`effective`/`getEffectivePolicy` (mirror the F2 `defaultEnabledWrites` threading in `governance.ts`). **Back-compat capstone (DEFAULT suite, Rule #21):** with no preset set, `getEffectivePolicy` over the FULL key universe (baseline ∪ all registered keys) on a constructed server **deep-equals** a pre-change snapshot for every key. A pre-change snapshot may be captured from `git show HEAD:...` or by asserting the unset-preset policy equals the policy computed with the preset parameter omitted entirely.

2. **AC 24.1.2 — Read-only capstone over the full key universe (not samples).** Under `IRIS_GOVERNANCE_PRESET=read-only`: **every** write-classified key resolves `false` (baseline writes via `BASELINE_ACTION_CLASSIFICATIONS`, new-tool writes via `mutates`, AND `defaultEnabled` writes — e.g. `iris_production_control:clean` — are `false`; read-only means read-only); **every** read-classified key resolves `true` (framework read tools like `iris_server_profiles` stay enabled because their `mutates` is `read`). Explicit `IRIS_GOVERNANCE` overrides beat the preset at **both** global and profile layers (an operator can re-enable one specific write under read-only, and can also disable a read). Assert over the full universe, iterating the actual key set — not a hand-picked sample.

3. **AC 24.1.3 — Startup validation.** An unknown `IRIS_GOVERNANCE_PRESET` value **fails fast at startup** with a clear message **naming the valid values** (`read-only`, `full`), mirroring the malformed-`IRIS_PROFILES` fail-fast in `packages/shared/src/profiles.ts` (the `profilesError` helper → `throw new Error("IRIS_PROFILES is invalid: ...")`). `full` behaves identically to unset (pass-through — `presetSeed` returns `undefined` for every key).

4. **AC 24.1.4 — Surfacing.** (a) `iris_server_profiles` structured output gains `preset: "read-only" | "full" | null` and the policy it already reports reflects the preset (same engine — add an assertion). (b) The `iris-governance://{profile}` resource reflects the preset (same engine — one assertion). (c) A call blocked *by the preset* (not by an explicit key) carries `"presetApplied": "read-only"` in its `GOVERNANCE_DISABLED` structured error; a call blocked by an explicit `IRIS_GOVERNANCE:false` does NOT carry `presetApplied` (the distinction is the whole point — operators need to know WHY it was blocked).

5. **AC 24.1.5 — Baseline & suite integrity.** `pnpm gen:governance-baseline:check` exits 0; `git diff --exit-code packages/shared/src/governance-baseline.ts` clean (Rule #23/#25). `pnpm turbo run build` + `pnpm turbo run test` green across all packages; no existing test perturbed except intentional advertised-shape updates (see Dev Notes).

## Tasks / Subtasks

- [x] **Task 1 — Preset type + parse + startup validation (AC 24.1.3)**
  - [x] Define a `GovernancePreset = "read-only" | "full"` type (in `governance.ts` or `config.ts` — choose the sibling of the existing config types). Internally normalize `full`/unset → `undefined`/`null` (no preset).
  - [x] Read `IRIS_GOVERNANCE_PRESET` from env where connection/governance config is assembled (trace how `IRIS_GOVERNANCE` / `IRIS_PROFILES` reach the server — likely `config.ts` + `profiles.ts` + `server-base.ts` construction). Validate: value must be `read-only`, `full`, or unset; anything else throws at startup naming the valid values (mirror `profiles.ts:profilesError`). Add a `governanceError`-style helper or reuse the existing pattern.
- [x] **Task 2 — `presetSeed` + cascade threading (AC 24.1.1, 24.1.2)**
  - [x] Add `presetSeed(key, preset, mutatesLookup, classifications, defaultEnabledWrites?) => boolean | undefined` in `governance.ts`. Returns `undefined` when `preset` is null/`"full"` (→ falls to `defaultSeed`). For `"read-only"`: resolve the key's class — `BASELINE_ACTION_CLASSIFICATIONS[key]` for baseline keys, else `mutatesLookup.get(key)` for new keys — then `read → true`, `write → false`. **`defaultEnabled` writes are `false` under read-only** (do NOT consult `defaultEnabledWrites` to re-enable; read-only overrides F2).
  - [x] Decide + document the class-resolution fallback for a key with NO resolvable class (unreachable given AC 24.0.1 completeness + `assertGovernanceClassification`, but be explicit): under `read-only`, **fail safe → treat as `write` → `false`** (never let an unclassifiable key through read-only). Add a comment.
  - [x] Insert the layer in `effective`: `profileLayer ?? global ?? presetSeed(...) ?? defaultSeed(...)`. Thread `preset` + `classifications` as **optional trailing params** (default `undefined`/empty) through `effective` and `getEffectivePolicy` (and `defaultSeed` only if your design needs it). Unset ⇒ the `presetSeed(...)` term is `undefined` ⇒ identical to today.
- [x] **Task 3 — Wire into the server (AC 24.1.2, 24.1.4)**
  - [x] In `server-base.ts`: store the parsed preset + build/hold the classification lookup (import `BASELINE_ACTION_CLASSIFICATIONS`). Pass `preset` + `classifications` to **all three** `getEffectivePolicy` call sites (resource ~543, enforcement gate ~894, discovery tool ~940 — grep `getEffectivePolicy` to confirm each).
  - [x] In the `GOVERNANCE_DISABLED` error construction (~911): set `presetApplied: <preset>` only when the denial was caused by the preset — i.e. the key is disabled, there is NO explicit `IRIS_GOVERNANCE` override for it at either layer, and `presetSeed(key)` returned `false`. Do NOT set it for an explicit-`false` denial.
- [x] **Task 4 — Surface the preset in discovery (AC 24.1.4a)**
  - [x] In `server-discovery.ts` (`iris_server_profiles`): add `preset: "read-only" | "full" | null` to the structured result; ensure the reported `policy`/`policies` reflect the preset (they will, once the tool's `getEffectivePolicy` call is threaded). Add an assertion the policy shows read-only effects when the preset is active.
- [x] **Task 5 — Tests (AC 24.1.1, 24.1.2, 24.1.3, 24.1.4)**
  - [x] Back-compat capstone (DEFAULT suite): unset-preset `getEffectivePolicy` over the full key universe deep-equals the omitted-preset baseline (Rule #19/#21). Do NOT name it `*.integration.test.ts`.
  - [x] Read-only capstone (DEFAULT suite): iterate the FULL key universe — assert every `write`-class key `false`, every `read`-class key `true`, `iris_production_control:clean` (defaultEnabled write) `false`, `iris_server_profiles` `true`; explicit global override re-enables one write under read-only; explicit profile override wins over both preset and global.
  - [x] Startup: unknown preset throws naming valid values; `full` == unset (pass-through) snapshot.
  - [x] Surfacing: `iris_server_profiles` reports `preset`; resource reflects preset (one assertion); `presetApplied` present on a preset-caused denial and ABSENT on an explicit-`false` denial.
  - [x] Update any advertised-shape tests that legitimately move (discovery output now has a `preset` field; policy maps under read-only differ). Do NOT inflate package tool-array length counts — no tool is added (Rule #31). Preset is server configuration, not a tool.
- [x] **Task 6 — Verify (AC 24.1.5)**
  - [x] `pnpm turbo run build` + `pnpm turbo run test` green; `pnpm gen:governance-baseline:check` exit 0; `git diff --exit-code packages/shared/src/governance-baseline.ts` clean.

### Review Findings

Code review 2026-07-08 (adversarial three-layer — Blind Hunter / Edge Case Hunter / Acceptance Auditor). **Acceptance Auditor: all 5 ACs PASS, 0 findings.** Outcome: **0 HIGH, 0 MEDIUM**; 1 LOW patched inline; 1 LOW deferred; 2 dismissed (spec-required). Verification re-run green post-patch: `@iris-mcp/shared` build clean, 653/653 shared tests pass, `gen:governance-baseline:check` exit 0 (141 frozen / 194 live / 53 post-foundation), `governance-baseline.ts` git-clean.

- [x] [Review][Patch] CR 24.1-P1 (LOW) — Prototype-safe classification lookup in `presetSeed` [packages/shared/src/governance.ts:592] — `classifications[key]` was an un-guarded bracket read on a plain object, inconsistent with the file's own `ownBool`/`hasOwnProperty` discipline: a governance key colliding with an `Object.prototype` member (e.g. `"constructor"`) would resolve to the inherited value, shadow the `?? mutatesLookup` fallback, and (fail-safe) block the key. Unreachable in practice (all keys are `iris_`-prefixed; composite `tool:action` keys never equal a bare prototype member) and fails safe (block-only, never wrongly enable), but hardened to an own-property read for defense-in-depth and consistency. **APPLIED** — build + 653 tests green.
- [x] [Review][Defer] CR 24.1-1 (LOW) — `presetApplied` is not strictly but-for under read-only [packages/shared/src/server-base.ts:930] — deferred, in-spec observation (see deferred-work.md).

**Dismissed (no action):**
- Blind #2 — `ServerDiscoveryResult.preset` is a new always-present required field. DISMISSED: AC 24.1.4a explicitly requires `preset: "read-only" | "full" | null` on the discovery output; additive per the suite's additive-changes policy; suite green confirms no other unpatched `ServerDiscoveryResult` constructor.
- Edge #2 — `"full"` self-reports as `"full"` while unset reports `null` in the discovery `preset` field. DISMISSED: AC 24.1.4a mandates the `full` vs `null` distinction (report the operator's explicit choice); the Rule #19 byte-for-byte contract governs enforcement (policy map, gate decision, denial envelope, `presetApplied`) — all proven identical between unset and `full` — not the self-report field.

## Dev Notes

### Consumes Story 24.0
- Import `BASELINE_ACTION_CLASSIFICATIONS` from `./baseline-classifications.js`. It covers exactly the 141 baseline keys (completeness test-enforced). New (post-baseline) keys are NOT in it — resolve those via `mutatesLookup` (`buildMutatesLookup`, already built in `server-base.ts:rebuildMutatesLookup`). Every non-baseline key carries `mutates` (enforced by `assertGovernanceClassification`), so `classifications[key] ?? mutatesLookup.get(key)` covers the whole universe.

### The F2 threading pattern to mirror (governance.ts)
- Epic 20 added `defaultEnabledWrites: ReadonlySet<string> = new Set()` as the trailing optional param on `defaultSeed`/`effective`/`getEffectivePolicy`. Study those signatures (lines ~481, ~516, ~557) and thread `preset`/`classifications` the SAME way — optional, defaulted, so an unset preset can't change any existing call's result. This is the mechanical guarantee behind AC 24.1.1.
- `effective` (line ~516) is where the cascade actually composes: insert the `presetSeed(...)` term between `ownBool(config.global, key)` and `defaultSeed(...)`, joined by `??`.

### Surfacing call sites (server-base.ts — grep to confirm exact lines)
- `getEffectivePolicy` is called at ~543 (`iris-governance://{profile}` resource), ~894 (enforcement gate in `handleToolCall`), ~940 (discovery tool policy). ALL three must receive the preset + classifications, or the resource/tool/gate will disagree — a governance-consistency bug. Add a test that the tool's reported policy == the gate's decision under read-only.
- `GOVERNANCE_DISABLED` error object is built ~911. The `presetApplied` field is OPTIONAL — only when the preset caused the denial.

### Startup validation (profiles.ts pattern)
- `profiles.ts` throws `new Error("IRIS_PROFILES is invalid: ...")` via the `profilesError` helper for malformed config, at construction/parse time (fail fast). Mirror this for the preset: on an unknown value, throw a clear `IRIS_GOVERNANCE_PRESET must be one of: read-only, full (received "<x>")`-style error at startup. Do NOT silently ignore an unknown preset (a typo'd `read_only` must NOT fall through to "no preset" — that would silently run in full-access mode when the operator intended read-only; this is a safety trap — fail loud).

### Hard constraints
- **Rule #19 (back-compat):** the unset-preset path must be byte-for-byte today's. The optional-default-param threading is the mechanism; the AC 24.1.1 capstone is the proof. Anything that changes an existing call's result with no preset is a HIGH bug.
- **Rule #21 (default suite):** both capstones run in `pnpm test`. Not `*.integration.test.ts`.
- **Rule #23/#25:** never touch `governance-baseline.ts`; never run the bare generator; `gen:governance-baseline:check` only.
- **Rule #31:** the preset is server CONFIGURATION, not a tool. Package tool-array length assertions (`index.test.ts` `toHaveLength`) MUST NOT change. Only the discovery-tool OUTPUT shape (`+preset` field) and read-only policy-map contents move.
- **Rule #32 note:** `iris_production_control:clean` ships `defaultEnabled` (F2, default-enabled write). Under read-only it MUST flip to `false` — the read-only capstone explicitly pins this. Do not let the F2 `defaultEnabledWrites` set re-enable it under read-only.

### Integration ACs
- **This story CONSUMES Story 24.0's `BASELINE_ACTION_CLASSIFICATIONS`** and produces the preset engine consumed observably WITHIN this story: the read-only capstone (full-universe write-blocked/read-enabled), the `iris_server_profiles` `preset` field, and the `presetApplied` denial field are the consumer-observable effects. Story 24.2 further exercises the preset via live dist smokes. (Producer + in-story consumer — Rule 1 satisfied.)

### Project Structure Notes
- Touch: `packages/shared/src/governance.ts` (presetSeed + threading), `packages/shared/src/config.ts` and/or `packages/shared/src/profiles.ts` (env read + validation), `packages/shared/src/server-base.ts` (wire 3 call sites + error field + store preset/classifications), `packages/shared/src/server-discovery.ts` (`preset` output field). Tests under `packages/shared/src/__tests__/`.
- Do NOT add a new tool or governance key. Do NOT touch ObjectScript, `governance-baseline.ts`, or `baseline-classifications.ts` (24.0's frozen output — consume only).

### References
- [Source: research/feature-specs/02-governance-presets.md#2.2 Preset resolution — cascade extension] — the exact cascade, presetSeed semantics, defaultEnabled-blocked-under-read-only, explicit-override-wins, fail-fast.
- [Source: research/feature-specs/02-governance-presets.md#2.3 Surfacing] — `preset` field, resource reflection, `presetApplied` denial field.
- [Source: research/feature-specs/02-governance-presets.md#4] — AC 1 (byte-for-byte), 2 (read-only full universe), 4 (explicit override), 5 (fail fast), 6 (surfacing).
- [Source: packages/shared/src/governance.ts:481-586] — `defaultSeed`/`effective`/`getEffectivePolicy` + the F2 `defaultEnabledWrites` threading to mirror.
- [Source: packages/shared/src/server-base.ts:543,894,940] — the three `getEffectivePolicy` call sites; :911 `GOVERNANCE_DISABLED` error.
- [Source: packages/shared/src/profiles.ts:107-114] — `profilesError` fail-fast helper to mirror for preset validation.
- [Source: packages/shared/src/server-discovery.ts:88-131] — `iris_server_profiles` structured output shape to extend with `preset`.
- [Source: .claude/rules/project-rules.md] — Rules #19, #21, #23, #25, #31, #32.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via `bmad-dev-story` skill.

### Debug Log References

None — no live IRIS calls required; this story is pure TypeScript engine + wiring + unit/capstone tests. Studied the F2 `defaultEnabledWrites` threading pattern (`governance.ts` `defaultSeed`/`effective`/`getEffectivePolicy`, lines ~481-586 pre-change) and its test style (`governance.test.ts` "F2 back-compat" / "F2 all-other-writes-still-disabled sweep" describes) before mirroring it for `presetSeed`. Confirmed the three `getEffectivePolicy`/`effective` call sites in `server-base.ts` (resource ~543, gate ~894, discovery ~940 pre-change) and the `GOVERNANCE_DISABLED` construction (~911 pre-change) by direct read, not by line-number guesswork.

### Completion Notes List

- **`governance.ts`** — added `GovernancePreset = "read-only" | "full"` type; `parseGovernancePreset(env)` (fail-fast `IRIS_GOVERNANCE_PRESET is invalid: ...` naming both valid values, mirroring `profilesError`); `presetSeed(key, preset, mutatesLookup, classifications = {})` — `undefined`/`"full"` → pass-through `undefined`; `"read-only"` → resolves `classifications[key] ?? mutatesLookup.get(key)`, `read`→`true`/`write`→`false`/unclassifiable→`false` (fail-safe, single-line `cls === "read"`); `hasExplicitOverride(key, profile, config)` — exported helper the gate uses to attribute a denial. Inserted `presetSeed(...)` into the `effective` cascade between the explicit layers and `defaultSeed`; threaded `preset`/`classifications` as optional trailing params (default `undefined`/`{}`) through `effective` and `getEffectivePolicy` — omitting them is byte-for-byte identical to calling with `preset: undefined` (proved directly, both with synthetic fixtures and the REAL `BASELINE_ACTION_CLASSIFICATIONS`/`GOVERNANCE_BASELINE`).
- **`server-base.ts`** — added `private preset: GovernancePreset | undefined = undefined` (mirrors `governanceConfig`'s pre-start pass-through default); parsed via `parseGovernancePreset()` in `start()` immediately after `parseGovernanceConfig()` (same fail-fast-at-boot timing). Threaded `this.preset` + `BASELINE_ACTION_CLASSIFICATIONS` into all three `getEffectivePolicy`/`effective` call sites (resource, enforcement gate, discovery tool). In the `GOVERNANCE_DISABLED` denial path, added a `presetCaused` computation (`this.preset !== undefined && !hasExplicitOverride(...) && presetSeed(...) === false`) that conditionally adds `structuredContent.presetApplied` — verified both the "present" and "absent" cases live in tests, including the read-only-blocked-by-explicit-override case (preset active but NOT the cause) and the `preset:"full"` case (never attributed).
- **`server-discovery.ts`** — `computeServerDiscovery` gained `preset?`/`classifications` trailing params, threaded into both `getEffectivePolicy` calls (single-profile + `allProfiles` map); `ServerDiscoveryResult` gained `preset: GovernancePreset | null` (`preset ?? null`), so `iris_server_profiles` now reports the active preset alongside the (already preset-aware) policy map.
- **Rule #31 confirmed**: no tool/governance key added — `preset` is a new OUTPUT field on the existing framework discovery tool, and no package `tools/index.ts` array changed length. Verified via full-suite green run (no package `index.test.ts` needed updating).
- **Tests** — new `packages/shared/src/__tests__/governance-preset.test.ts` (39 tests, DEFAULT suite, not `*.integration.test.ts`): `parseGovernancePreset` fail-fast (7), `presetSeed` pure-function mechanics (8), `effective`/`getEffectivePolicy` synthetic cascade threading incl. F2-override (9), the AC 24.1.1 back-compat capstone over the REAL `BASELINE_ACTION_CLASSIFICATIONS` (2 tests, all 141 keys), the AC 24.1.2 read-only capstone over the REAL classification map with a vacuous-loop guard (1 test), two constructed-`McpServerBase` capstones iterating the FULL registered key universe (`governedKeys`, baseline ∪ registered incl. the discovery tool + a synthetic `iris_production_control:clean` defaultEnabled-write mirror) for both back-compat and read-only + explicit-override-wins (5 tests), and surfacing tests for the discovery `preset` field / resource reflection / `presetApplied` presence-and-absence (9 tests).
- No existing test needed updating — grepped for whole-object `toEqual` on the discovery result and for package `index.test.ts` tool-array length assertions; none exist, so the new `preset` output field and read-only policy-map contents are purely additive to what the OLD suite already asserted (Rule #31 confirmed mechanically, not just by inspection).
- Verification: `pnpm --filter @iris-mcp/shared build` clean; `pnpm turbo run build` clean (all 7 packages); `pnpm turbo run test` — 12/12 tasks green, 2072 tests total (shared 646, incl. the new 39; admin 439; interop 270; ops 335; data 121; dev 351 — no regressions); `pnpm gen:governance-baseline:check` exit 0 (141 frozen / 194 live / 53 post-foundation, unchanged); `git diff --exit-code packages/shared/src/governance-baseline.ts` clean (frozen baseline untouched, bare generator never run).

### File List

- `packages/shared/src/governance.ts` (modified — `GovernancePreset` type, `parseGovernancePreset`, `presetSeed`, `hasExplicitOverride`; `effective`/`getEffectivePolicy` threaded with `preset`/`classifications`)
- `packages/shared/src/server-base.ts` (modified — `preset` field + `start()` parse; all 3 `getEffectivePolicy`/`effective` call sites threaded; `presetApplied` denial attribution)
- `packages/shared/src/server-discovery.ts` (modified — `computeServerDiscovery` threads `preset`/`classifications`; `ServerDiscoveryResult.preset` field)
- `packages/shared/src/__tests__/governance-preset.test.ts` (new — 39 tests)

## Change Log

| Date | Change |
|---|---|
| 2026-07-08 | Story 24.1 dev pass complete: `IRIS_GOVERNANCE_PRESET` preset engine — `presetSeed` cascade layer inserted between the explicit `IRIS_GOVERNANCE` layers and `defaultSeed` (`effective = profile.explicit ?? global.explicit ?? presetSeed ?? defaultSeed`), threaded as optional trailing params through `effective`/`getEffectivePolicy` mirroring Epic 20's F2 `defaultEnabledWrites` pattern. `parseGovernancePreset` fails fast on an unknown value naming `read-only`/`full` (mirrors `profiles.ts:profilesError`); `full` is an explicit pass-through alias for unset. `read-only` blocks every write-classified key (baseline via `BASELINE_ACTION_CLASSIFICATIONS`, new-tool via `mutates`, AND `defaultEnabled` writes — read-only overrides Epic 20 F2) and enables every read-classified key; explicit `IRIS_GOVERNANCE` overrides beat the preset at both global and profile layers. Surfaced via `iris_server_profiles`' new `preset: "read-only"\|"full"\|null` field (also reflected in the already-preset-aware policy map + the `iris-governance://{profile}` resource, same engine), and via an optional `presetApplied` field on a `GOVERNANCE_DISABLED` denial — present ONLY when the preset (not an explicit override) caused the denial. New `packages/shared/src/__tests__/governance-preset.test.ts` (39 tests, default suite): parseGovernancePreset fail-fast, `presetSeed` pure-function mechanics, synthetic cascade-threading matrix, the AC 24.1.1 back-compat capstone and the AC 24.1.2 read-only capstone both run over the REAL 141-key `BASELINE_ACTION_CLASSIFICATIONS` AND over a constructed `McpServerBase`'s full registered key universe (baseline ∪ registered tools incl. a synthetic `iris_production_control:clean` defaultEnabled-write mirror), plus surfacing tests for all three AC 24.1.4 sub-parts. No tool/governance key added (Rule #31 — `preset` is a new output field, not a new key); no package `tools/index.ts` array length changed. Verified: `pnpm turbo run build` clean (7 packages); `pnpm turbo run test` 2072/2072 green (12/12 tasks, zero regressions); `pnpm gen:governance-baseline:check` exit 0 (141/194/53, unchanged); `git diff --exit-code governance-baseline.ts` clean (frozen baseline untouched, bare generator never run). Status: ready-for-dev → review. |
