# Story 16.0: Epic 15 Deferred Cleanup — `gen-governance-baseline.mjs --check` (no-write drift mode)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **developer / CI maintainer**,
I want **a no-write `--check` mode on `scripts/gen-governance-baseline.mjs` (plus a guard that the default write path refuses to overwrite the frozen baseline without `--force`)**,
so that **the frozen-foundation governance baseline can be drift-verified in CI and locally without the footgun of silently regrowing the committed 141-key file** (Epic 15 retro Action Item #3; Rule #25).

## Context — Epic 15 Retro Review Gate

This is the Epic 16 retro-review cleanup story (the "Story X.0" gate). It triages the Epic 15 retrospective (`epic-15-retro-2026-06-16.md`) action items and the open `deferred-work.md` items against Epic 16 scope. The full triage table is at the end of this file.

The single INCLUDE item is **Action Item #3** (the `--check` mode). All other open items are DEFER (no Epic 16 intersection) or PROCESS notes the lead applies at story creation (AI#2 Rule #24 per-story bootstrap regen; AI#4 Rule #26 destructive-path rejection in live smokes). AI#1 (codify Rules #23–26) is already DONE.

## Acceptance Criteria

1. **AC 16.0.1 — `--check` (no-write) mode.** `node scripts/gen-governance-baseline.mjs --check` re-derives the LIVE governance keys from the built server dists and verifies the FROZEN committed baseline (`packages/shared/src/governance-baseline.ts`, `GOVERNANCE_BASELINE` / hash `1e62c5ad5bf7` / 141 keys) **one-directionally** — exactly mirroring the existing `governance.test.ts` drift guard:
   - **Every committed foundation key MUST still exist in the live surface.** If any frozen key has vanished from the live tools, print the vanished keys with the same "real back-compat regression — restore the tool/action, do NOT regenerate the frozen baseline" guidance and **exit with a non-zero code** (for CI).
   - **New live keys outside the frozen baseline are EXPECTED and allowed** (Epic 15+ post-foundation tools governed by `mutates` + `defaultSeed`). Report their count for visibility; do NOT fail on them.
   - On success, print a summary (frozen-key count, live-key count, post-foundation new-key count) and **exit 0**.
2. **AC 16.0.2 — `--check` writes nothing.** The `--check` path MUST NOT call `writeFileSync`. After a `--check` run, `git diff --exit-code packages/shared/src/governance-baseline.ts` is clean (the frozen file is byte-for-byte unchanged). The committed hash stays `1e62c5ad5bf7`.
3. **AC 16.0.3 — write-path footgun guard.** Running the generator in its default (write) mode WITHOUT an explicit `--force` flag MUST refuse to overwrite the frozen `governance-baseline.ts` — print a clear message explaining the file is frozen, that `--check` is the safe verification path, and that `--force` is required to genuinely regenerate (only ever appropriate to re-verify the Epic-14 foundation hash, never to grow the file with post-foundation tools). It MUST exit non-zero when it refuses. `--force` restores today's write behavior (used only for a deliberate foundation re-derivation).
4. **AC 16.0.4 — DO-NOT-REGROW banner updated.** The generator's top-of-file banner (and the generated file's header, if touched) documents the new `--check` / `--force` usage so the next maintainer sees it before running. (The existing FROZEN-FOUNDATION NOTE already warns against regrow; extend it with the concrete flags.)
5. **AC 16.0.5 — npm script.** Add `gen:governance-baseline:check` to root `package.json` running `node scripts/gen-governance-baseline.mjs --check`. The existing `gen:governance-baseline` script is unchanged in name but now hits the `--force`-guarded write path (document that it requires `--force` to actually write, mirroring the banner). Mirrors the `gen:bootstrap` discipline (Rule #25 reference).
6. **AC 16.0.6 — tests.** Add a test (discoverable by the default suite — Rule 8) that:
   - runs the script with `--check` against the current (correct) tool surface and asserts exit code 0;
   - asserts the frozen file is unchanged after a `--check` run (no write);
   - asserts the default write path WITHOUT `--force` refuses (non-zero exit, no write).
   Use a child-process invocation (`execFileSync`/`spawnSync` on `node scripts/gen-governance-baseline.mjs ...`) so the real CLI is exercised, not an internal re-implementation. Place it where vitest's default run discovers it (e.g. `packages/shared/src/__tests__/`), respecting the project's `*.test.ts` (non-`*.integration.test.ts`) convention. The test must run AFTER the build (the generator imports built dists) — follow the same dist-dependency assumption the existing `governance.test.ts` drift guard already relies on.
7. **AC 16.0.7 — strictly additive, baseline frozen.** NO ObjectScript change, NO `BOOTSTRAP_VERSION` bump, NO regeneration of `governance-baseline.ts` (it stays frozen at `1e62c5ad5bf7` / 141 keys — verify the git diff on that file is empty at the end). The `--check` mode and the existing one-directional `governance.test.ts` drift guard must agree.
8. **AC 16.0.8 — full monorepo green.** `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm type-check` all pass; the new test is included and green.

## Tasks / Subtasks

- [x] **Task 1 — Add `--check` mode to the generator (AC 16.0.1, 16.0.2)**
  - [x] Parse `process.argv` for `--check` and `--force` near the top of `scripts/gen-governance-baseline.mjs`.
  - [x] Refactor the key-derivation (the `for (const pkg of SERVER_PACKAGES)` loop + `unwrapActionOptions`) so it can run for both write and check modes — keep using the generator's own `unwrapActionOptions` (the correct unwrap; note this is more robust than `governance.test.ts`'s direct `?.action?.options` read — see Dev Notes / CR 15.0-5).
  - [x] In `--check`: import the committed `GOVERNANCE_BASELINE` from `packages/shared/src/governance-baseline.ts` (or `dist`), compute `vanished = committed \ live`; if non-empty, print each + the regression guidance and `process.exit(1)`; else print summary and `process.exit(0)`. Report `postFoundation = live \ committed` count (no failure).
  - [x] Ensure NO `writeFileSync` runs on the `--check` path.
- [x] **Task 2 — Footgun guard on the write path (AC 16.0.3, 16.0.4)**
  - [x] When neither `--check` nor `--force` is passed: print the frozen-file refusal message (point at `--check` and `--force`) and `process.exit(1)` BEFORE `writeFileSync`.
  - [x] When `--force`: run today's write behavior unchanged.
  - [x] Update the top-of-file FROZEN-FOUNDATION NOTE banner with the `--check` / `--force` usage.
- [x] **Task 3 — npm script (AC 16.0.5)**
  - [x] Add `"gen:governance-baseline:check": "node scripts/gen-governance-baseline.mjs --check"` to root `package.json`.
- [x] **Task 4 — Tests (AC 16.0.6)**
  - [x] Add `governance-baseline-check.test.ts` (default-suite-discoverable) that child-process-invokes the CLI: `--check` exits 0 + leaves the file unchanged; default-no-`--force` write path exits non-zero + leaves the file unchanged.
- [x] **Task 5 — Verify & finalize (AC 16.0.7, 16.0.8)**
  - [x] `git diff --exit-code packages/shared/src/governance-baseline.ts` is clean; hash still `1e62c5ad5bf7`.
  - [x] `pnpm build && pnpm test && pnpm lint && pnpm type-check` all green.

## Dev Notes

### What exists today (the footgun)
`scripts/gen-governance-baseline.mjs` ALWAYS ends in `writeFileSync(outPath, output)` and enumerates the **live** tool surface (now 93 tools / Epic 15 included), not the frozen 141. So running it for ANY reason (even to "check counts") overwrites the frozen `governance-baseline.ts` and regrows it (e.g. to 66 admin keys), breaking hash `1e62c5ad5bf7` and the one-directional drift test. The lead tripped this during Story 15.6 prep and had to `git checkout -- governance-baseline.ts`. Story 15.1's AC 15.1.7 added only a prose "do not re-run" note; this story is the real fix (Rule #25).

### One-directional check is already specified in the test layer — mirror it
The authoritative logic lives in [`packages/shared/src/__tests__/governance.test.ts:527-586`](../../packages/shared/src/__tests__/governance.test.ts#L527-L586) ("governance baseline drift check"):
- `deriveBaselineFromDists()` builds the live key set from the five `SERVER_PACKAGES` dists.
- `vanished = committed \ live` must be `[]` (RETAINED assertion).
- `postFoundation = live \ committed` is EXPECTED to be non-empty (no assertion).
The `--check` mode is the CLI/CI mirror of exactly this. Reuse the same `SERVER_PACKAGES` list and `VANISHED_HINT` wording for consistency.

### Lock-step note (CR 15.0-5, do not regress)
The generator derives action options via `unwrapActionOptions` (peels `ZodOptional`/`ZodDefault`/`ZodNullable`). The `governance.test.ts` drift guard reads `tool.inputSchema?.shape?.action?.options` directly (a known deferred lock-step gap — CR 15.0-5, harmless on today's all-bare surface). Keep the generator's `--check` mode using `unwrapActionOptions` (the correct/robust path). Do NOT downgrade it to the bare read. (Fully closing CR 15.0-5 by also fixing the test-side read is out of THIS story's scope — it's tracked as a future generator/drift-test de-duplication; only note it if trivially adjacent.)

### Frozen invariant — DO NOT regenerate
`GOVERNANCE_BASELINE` stays frozen: 141 keys, `GOVERNANCE_BASELINE_HASH = "1e62c5ad5bf7"`. New Epic 16 ops tools (16.1–16.3) will add NEW post-foundation keys that are EXPECTED to live OUTSIDE this baseline and are governed by `mutates` + `defaultSeed` (write → disabled, read → enabled). Never add them to the frozen file. This story does not touch tool surfaces at all.

### Generator runs after build
The generator imports built `packages/*/dist/tools/index.js`. Any test that invokes it must run after `pnpm turbo run build` (the test runner already builds deps; the existing drift guard relies on the same assumption).

### Source-tree components to touch
- `scripts/gen-governance-baseline.mjs` — add `--check`/`--force`, refactor derivation, footgun guard, banner.
- `package.json` (root) — add `gen:governance-baseline:check` script.
- `packages/shared/src/__tests__/governance-baseline-check.test.ts` — NEW test.
- (DO NOT touch) `packages/shared/src/governance-baseline.ts` — must stay frozen.

### Testing standards
Vitest, `*.test.ts` in `src/__tests__/`, discovered by the default suite (NOT `*.integration.test.ts`, which is excluded). Child-process the real CLI for the `--check`/refusal assertions. Keep the test self-cleaning (no leftover writes).

### Project Structure Notes
- Pure TypeScript/Node-script + npm-script + test story; consistent with prior X.0 cleanup stories (e.g. 15.0 was TS+generator+tests only, no bootstrap bump, baseline hash unchanged).
- No conflicts with the unified structure; `scripts/` is the established home for `gen-*.mjs`.

### References
- [Source: _bmad-output/implementation-artifacts/epic-15-retro-2026-06-16.md#Action-Items] — AI#3 (`--check` mode), AI#2/#4 (process notes), AI#1 (done).
- [Source: .claude/rules/project-rules.md#25] — Rule #25 (generator emitting a frozen artifact needs a no-write `--check` mode + DO-NOT-REGROW banner / `--force`).
- [Source: .claude/rules/project-rules.md#23] — Rule #23 (frozen-foundation baseline; one-directional drift test).
- [Source: scripts/gen-governance-baseline.mjs] — current generator (write-only, footgun).
- [Source: packages/shared/src/__tests__/governance.test.ts#L504-L586] — authoritative one-directional drift logic to mirror.
- [Source: packages/shared/src/governance-baseline.ts] — frozen baseline (141 keys / `1e62c5ad5bf7`).

## Epic 15 → Epic 16 Retro-Review Triage

Triage of **Epic 15 retrospective** (`epic-15-retro-2026-06-16.md`) action items + open `deferred-work.md` entries against **Epic 16** (Operations Tools: process/database/backup ObjectScript handlers + `@iris-mcp/ops` tools). Date: 2026-06-16.

| Item | Source | Triage Decision |
|---|---|---|
| AI#1 — Codify Epic 15 lessons as Rules #23–#26 | Epic 15 retro | **DROP** — already DONE this retro (`project-rules.md` has #23–26). |
| AI#2 — Reinterpret "one bump at closer" per Rule #24 at story creation | Epic 15 retro | **PROCESS (no code)** — lead applies at each Epic 16 ObjectScript story's creation: regen `bootstrap-classes.ts` + move `BOOTSTRAP_VERSION` per-story (16.1/16.2/16.3); 16.4 VERIFIES idempotence, it is NOT a deferred single bump. Recorded in sprint-status note + this story. |
| AI#3 — Implement `gen-governance-baseline.mjs --check` (no-write drift mode) + DO-NOT-REGROW banner | Epic 15 retro | **INCLUDE** — this story (AC 16.0.1–16.0.8). |
| AI#4 — Destructive ops tools: live-endpoint smoke must assert guarded rejection of destructive paths (Rule #26) | Epic 15 retro | **PROCESS (no code)** — lead applies per-story at the 16.1–16.3 smoke gate (terminate/dismount/truncate/purge-style paths must be REJECTED on the live endpoint with disposable targets only). Recorded in sprint-status note. |
| "Apply Rule #23: baseline stays frozen `1e62c5ad5bf7`; new ops keys governed by `mutates`; do NOT run `gen:governance-baseline`" | Epic 15 retro (Epic 16 prep) | **PROCESS** — standing guidance for 16.1–16.3; this story's `--check` mode operationalizes it. |
| list-Close-in-catch codebase-wide hardening (CR 15.1-1 / 15.2-2 / 15.3-3 / 15.4-8) | deferred-work.md | **DEFER (carry) + guidance** — separate cross-cutting `Security.cls` pass; NOT blocking Epic 16. New Epic 16 ObjectScript list methods MUST adopt the correct `Close`-in-catch pattern from the start (note to 16.1–16.3 devs). |
| Connection/profile-layer items (CR 14.1 / 14.2 — concurrency race, health-check meta, port/timeout coercion, whitespace profile, in-flight bootstrap variance, untrimmed `server`, addTools partial-state) | deferred-work.md | **DEFER** — Epic 16 adds ops tools, not new connection/profile callers. No intersection. |
| `namespace` schema field declared-but-not-forwarded (CR 15.3-6, suite-wide) | deferred-work.md | **DEFER** — cross-tool consistency pass; new ops tools should follow the prevailing pattern; not this story. |
| URL-encoded profile name not decoded (CR 14.5) | deferred-work.md | **DEFER** — advisory resource; realistic names identity-encoded; no Epic 16 intersection. |
| Admin-tool specifics (X.509/audit fileName hardening, view pagination, export overwrite, LDAP host-blank validity, etc. — CR 15.2/15.3/15.4) | deferred-work.md | **DEFER** — admin-server (`iris-admin-mcp`) refinements; no Epic 16 (`iris-ops-mcp`) intersection. |
| All Epic 11/12 retained-open items + Epic 8.x legacy + docdb typed-property population | deferred-work.md | **DEFER** — re-affirmed; no Epic 16 intersection. |

**Decision summary: 1 INCLUDE (this story), 0 ROUTE, 3 PROCESS (AI#2/#4 + Rule #23 guidance — applied by lead, not code), rest DEFER (carried forward unchanged for re-triage after Epic 16 retro).**

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (via bmad-dev-story skill).

### Debug Log References

Manual CLI verification (post-`pnpm build`):
- `node scripts/gen-governance-baseline.mjs --check` → exit 0; reported `frozen=141`, `live=166`, `post-foundation=25`; printed "OK — every frozen foundation key still exists in the live surface".
- `node scripts/gen-governance-baseline.mjs` (no flag) → exit 1; printed "REFUSING to overwrite the FROZEN baseline" with `--check` / `--force` guidance.
- `git diff --exit-code packages/shared/src/governance-baseline.ts` → clean (frozen, hash `1e62c5ad5bf7` untouched).

### Completion Notes List

- Refactored the per-package key-derivation into a reusable `deriveLiveKeys()` async function used by BOTH the `--check` and the `--force` write path. The generator's robust `unwrapActionOptions` peel is preserved on both paths (CR 15.0-5 lock-step gap intentionally NOT regressed — `--check` does not downgrade to `governance.test.ts`'s bare `?.action?.options` read).
- `--check` (no-write): imports the committed `GOVERNANCE_BASELINE`, computes `vanished = committed \ live` (exit 1 + per-key regression guidance using the same `VANISHED_HINT` wording as `governance.test.ts` if non-empty) and `postFoundation = live \ committed` (reported for visibility, never a failure). On success: summary + exit 0. No `writeFileSync` on this path.
- Footgun guard: the default (no-flag) invocation now REFUSES and exits 1 BEFORE any write, pointing at `--check` (safe) and `--force` (deliberate foundation re-derivation). `--force` restores today's write behavior unchanged.
- Top-of-file FROZEN-FOUNDATION NOTE banner extended with a concrete USAGE block documenting `--check` / no-flag / `--force` (AC 16.0.4). The generated file's header doc comment was updated only in the `--force` write template (not regenerated — see below); the committed `governance-baseline.ts` is untouched.
- Added root npm script `gen:governance-baseline:check`. The existing `gen:governance-baseline` script is unchanged in name but now hits the `--force`-guarded refusal path (documented in the banner).
- New test `packages/shared/src/__tests__/governance-baseline-check.test.ts` (3 tests, default-suite-discoverable, `*.test.ts`) child-process-invokes the real CLI: `--check` exits 0; `--check` leaves the frozen file byte-for-byte unchanged (hash assertion); default no-`--force` write path exits non-zero + leaves the file unchanged. All 3 green.
- AC 16.0.7 (frozen, additive) honored: NO ObjectScript change, NO `BOOTSTRAP_VERSION` bump, `governance-baseline.ts` git diff EMPTY (still 141 keys / `1e62c5ad5bf7`). The `--check` mode and the existing one-directional `governance.test.ts` drift guard agree.
- AC 16.0.8: full monorepo green — `pnpm build` (6/6), `pnpm test` (12/12 tasks; shared now +3 = 503), `pnpm lint` (6/6), `pnpm type-check` (12/12).

### File List

- `scripts/gen-governance-baseline.mjs` (modified — `--check`/`--force` modes, `deriveLiveKeys()`/`computeHash()` refactor, footgun guard, banner)
- `package.json` (modified — added `gen:governance-baseline:check` script)
- `packages/shared/src/__tests__/governance-baseline-check.test.ts` (new — 3 CLI tests)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — story → review)

## Change Log

| Date | Change |
|---|---|
| 2026-06-16 | Story 16.0 implemented (Epic 15 retro AI#3 / Rule #25): added no-write `--check` drift mode + `--force`-guarded write path + footgun-guard refusal + USAGE banner to `scripts/gen-governance-baseline.mjs`; added root `gen:governance-baseline:check` npm script; added `governance-baseline-check.test.ts` (3 default-suite tests). Strictly additive — no ObjectScript, no BOOTSTRAP_VERSION bump, `governance-baseline.ts` frozen at 141 keys / `1e62c5ad5bf7` (git diff empty). Full monorepo green. Status → review. |
| 2026-06-16 | Code review (bmad-code-review, fresh context): 3 layers (Blind / Edge-Case / Acceptance). All 8 ACs verified PASS; Rules #18/#23/#24/#25 matched; frozen baseline git-clean (141 keys / `1e62c5ad5bf7`); new test in DEFAULT suite. One HIGH-value robustness gap auto-fixed inline (CR 16.0-FIX1, false-OK guard). One LOW diagnostic improvement auto-fixed (CR 16.0-FIX2, stderr in test failure message). 2 LOW deferred (CR 16.0-1 lock-step de-dup, CR 16.0-2 vanished-key CLI coverage), 1 LOW dismissed. See Review Findings. |

## Review Findings

### Code Review — 2026-06-16 (bmad-code-review, fresh context, 3 parallel layers)

**Verdict:** All 8 ACs (16.0.1–16.0.8) PASS; load-bearing Rules #18, #23, #24, #25 all matched. Critical invariants confirmed: frozen `governance-baseline.ts` git-clean (141 keys / hash `1e62c5ad5bf7`); NO ObjectScript change; NO `BOOTSTRAP_VERSION` bump; `--check` never writes; default-no-`--force` refuses with non-zero exit; `--check` is one-directional and AGREES with `governance.test.ts:527-586` (verified live: `--check` exit 0 reporting frozen=141 / live=166 / post-foundation=25; drift guard 41 tests green); new test in DEFAULT vitest suite (`*.test.ts`, not `*.integration.test.ts`).

**Auto-fixed inline (HIGH/MED):**

- [x] **[Review][Patch] CR 16.0-FIX1 — `--check` false-OK guard (HIGH-value robustness)** [`scripts/gen-governance-baseline.mjs:257-281`] — Blind + Edge Case Hunters both flagged: the original `--check` did `new Set(committedModule.GOVERNANCE_BASELINE)` with no validation. If the committed baseline imports successfully but `GOVERNANCE_BASELINE` resolves to `undefined`/non-iterable/empty (export renamed, file emptied, or a TS-import resolution miss), `new Set(undefined)` is an empty set → `vanished` empty → `--check` reports "OK" and exits 0 while the foundation is actually destroyed — a false negative that defeats `--check`'s entire purpose as the CI guard. **Fixed:** `--check` now validates the committed export is iterable AND that the resulting set is non-empty BEFORE the diff; either condition fails loudly with a "frozen foundation appears destroyed — refusing to report a false OK" message and `process.exit(1)`. (Note: the export is a `Set<string>`, not an array — the guard checks `Symbol.iterator` + `.size`, not `Array.isArray`.) Re-verified: `--check` still exits 0 / frozen=141 on the intact baseline; all 4 new tests + the 41 `governance.test.ts` tests green; frozen file git-clean.

- [x] **[Review][Patch] CR 16.0-FIX2 — test failure diagnostic dumps stderr (MED, diagnostics)** [`packages/shared/src/__tests__/governance-baseline-check.test.ts:64-69`] — Edge Case Hunter: the `--check` success test's assertion message interpolated only `stdout`, but the single most-likely real-world failure (server dists not built → the CLI throws the "run pnpm turbo run build first" hint) writes that hint to **stderr** — so a CI failure would surface a near-empty diagnostic. **Fixed:** the failure message now includes both `stdout` and `stderr`.

**Deferred (LOW — see `deferred-work.md` § "code review of story 16.0"):**

- [x] **[Review][Defer] CR 16.0-1 — generator/drift-test lock-step divergence** [`scripts/gen-governance-baseline.mjs:57` vs `packages/shared/src/__tests__/governance.test.ts:555`] — the `--check` path uses the robust `unwrapActionOptions` peel; the in-suite drift guard reads `?.action?.options` bare. They AGREE on today's all-bare surface (verified) and would only diverge on a future wrapped `action` enum. Pre-existing CR 15.0-5 gap; Dev Notes explicitly scoped closing it OUT and the generator side was correctly NOT regressed. Suggested resolution: extract one shared derivation helper. Deferred — out of this story's scope.

- [x] **[Review][Defer] CR 16.0-2 — `--check` vanished-key (exit-1) branch has no direct CLI coverage** [`packages/shared/src/__tests__/governance-baseline-check.test.ts:130-137`; `scripts/gen-governance-baseline.mjs:269-281`] — the new test covers success + refusal only; reproducing a vanished frozen key requires perturbing built dists OR the frozen file, both forbidden by AC 16.0.7's additive constraint. The same logic IS mirrored (in-process) by `governance.test.ts`. AC 16.0.6 required only the 3 positive/refusal assertions (all present). Suggested resolution: cover the exit-1 branch via the extracted helper from CR 16.0-1. Deferred — blocked by the additive constraint.

**Dismissed (LOW, noise):**

- **CR 16.0-3 — `--check --force` precedence silent / unknown-flag tolerance** [`scripts/gen-governance-baseline.mjs:56-58`] — `--check` wins over `--force` (the safe verify path), and typo'd flags fall through to the non-destructive refusal. Correct-by-design for a build-time generator; flag-conflict/unknown-flag validation is gold-plating. No action.
