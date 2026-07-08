# Story 24.2: SQL Resource Caps + Docs + Live Smokes

Status: done

## Story

As a **suite operator running against production**,
I want **optional `IRIS_SQL_MAX_ROWS`/`IRIS_SQL_TIMEOUT` caps on `iris_sql_execute`, plus a marketing-grade "point it at prod in read-only mode" docs story across all surfaces, proven end-to-end by live read-only rejection smokes**,
so that **the one-word read-only safety net ships documented, discoverable, and demonstrably enforced on a real server**.

## Context

Story 24.1 shipped the `IRIS_GOVERNANCE_PRESET` engine + surfacing. This story completes Epic 24:
1. **SQL resource caps** (spec §2.4) — two optional env vars clamping `iris_sql_execute`.
2. **Docs rollup** (Rule #30, conventions §5) — the headline capability written up across README, all client-config guides, per-server README, and CHANGELOG.
3. **Live smokes** (Rules #22/#26, spec AC 9) — the built dist under `IRIS_GOVERNANCE_PRESET=read-only` proving a real write is REFUSED with `presetApplied` and a real read succeeds, against live IRIS (HSCUSTOM).

**Binding spec:** [research/feature-specs/02-governance-presets.md](./research/feature-specs/02-governance-presets.md) §2.4 + §3 story 3 + AC 7/9. Conventions: [00-conventions.md](./research/feature-specs/00-conventions.md) §5 (docs) + §6 (DoD).

## Acceptance Criteria

1. **AC 24.2.1 — SQL caps clamp + annotate; unset = no-op.**
   - `IRIS_SQL_MAX_ROWS` (optional positive int): a HARD cap on `iris_sql_execute`'s effective row limit. `effectiveLimit = min(caller_maxRows ?? DEFAULT_MAX_ROWS, IRIS_SQL_MAX_ROWS)`. When the cap actually reduced the caller's requested limit, the response carries `"rowsCapped": true`. (Distinct from the existing `truncated`/`totalAvailable` — both may be present; `rowsCapped` specifically means the ENV cap clamped, not merely that more rows existed.)
   - `IRIS_SQL_TIMEOUT` (optional positive number, **seconds**): forwarded to the tool's HTTP call as a per-request timeout (`ctx.http.post(path, body, { timeout: IRIS_SQL_TIMEOUT * 1000 })` — `RequestOptions.timeout` is milliseconds, see `http-client.ts:22,150`).
   - Both are read in `loadConfig` (`config.ts`) and surfaced on `IrisConnectionConfig` as optional fields (consumed via `ctx.config`). An invalid value (non-positive / non-numeric) **fails fast at startup** mirroring the existing `timeout` validation (`config.ts:72-73`).
   - **Unset caps are byte-for-byte today's behavior** — mechanical snapshot/no-op test (Rule #19): with neither env var set, `iris_sql_execute` output and the HTTP call are identical to pre-change (no `rowsCapped` field, no timeout option passed). Caps apply regardless of preset.

2. **AC 24.2.2 — Docs rollup (Rule #30, all surfaces).** Update ALL of:
   - **`README.md`** — (a) env-var table: add `IRIS_GOVERNANCE_PRESET`, `IRIS_SQL_MAX_ROWS`, `IRIS_SQL_TIMEOUT` rows (default state, one-line purpose); (b) the "Multiple Servers & Governance" section: a **marketing-grade "Read-only mode" subsection** headlining *"Point it at production in read-only mode with one environment variable"* — what `read-only` blocks/allows, that explicit `IRIS_GOVERNANCE` overrides still win, that `presetApplied` explains a denial, and the SQL caps; (c) Backward-compat note: preset unset + caps unset = today's behavior.
   - **`docs/client-config/claude-code.md`, `claude-desktop.md`, `cursor.md`** — a copy-pasteable `env` block showing `IRIS_GOVERNANCE_PRESET=read-only` (and note the SQL caps), correctly formatted for each client.
   - **Per-server README** (`packages/iris-dev-mcp/README.md`) — note `IRIS_SQL_MAX_ROWS`/`IRIS_SQL_TIMEOUT` in the `iris_sql_execute` reference; and (framework note, Rule #31) the read-only preset applies to ALL servers as configuration (not a tool).
   - **`CHANGELOG.md`** — an entry for the preset + SQL caps under the current pre-release heading.
   - State default states per Rule #30: `read-only` is opt-in (unset = full access today); SQL caps opt-in (unset = no cap).

3. **AC 24.2.3 — Live smokes (lead gate, Rules #22/#26; spec AC 9).** Against the BUILT dist + live IRIS (HSCUSTOM), with `IRIS_GOVERNANCE_PRESET=read-only`:
   - A real `iris_global_set` (a write) is **REFUSED** with a `GOVERNANCE_DISABLED` error carrying `presetApplied: "read-only"`, and **changes nothing** (verify the global is unchanged).
   - A real `iris_global_get` (a read) **succeeds**.
   - An explicit `IRIS_GOVERNANCE` re-enable of one write (e.g. `{"global":{"iris_global_set":true}}`) under the same preset is verified to **allow** that write live.
   - (SQL caps) With `IRIS_SQL_MAX_ROWS` set low, a real `iris_sql_execute` returns `rowsCapped: true` + the clamped row count; with it unset, no cap.
   - Spec §4 ACs 1–9 all pass; conventions §6 DoD checklist complete. Results recorded in the story file. Disposable smoke scripts deleted before staging.

4. **AC 24.2.4 — Suite/baseline integrity.** `pnpm turbo run build` + `pnpm turbo run test` green; `pnpm gen:governance-baseline:check` exit 0; `git diff --exit-code packages/shared/src/governance-baseline.ts` clean (Rule #23/#25). No new tool/governance key (Rule #31 — SQL caps are configuration on an existing tool; `index.test.ts` tool-array lengths unchanged).

## Tasks / Subtasks

- [x] **Task 1 — Config plumbing (AC 24.2.1)**
  - [x] In `config.ts` `loadConfig`: read `IRIS_SQL_MAX_ROWS` (optional positive int) and `IRIS_SQL_TIMEOUT` (optional positive number, seconds). Validate + fail fast on invalid values (mirror the `timeout` check at `config.ts:72-73`). Add optional fields to `IrisConnectionConfig` (e.g. `sqlMaxRows?: number`, `sqlTimeoutMs?: number` — store the timeout pre-converted to ms, or store seconds and convert at the call site; pick one and document). Unset → `undefined`.
- [x] **Task 2 — SQL caps in the tool (AC 24.2.1)**
  - [x] In `packages/iris-dev-mcp/src/tools/sql.ts` handler: compute `requested = maxRows ?? DEFAULT_MAX_ROWS`; `cap = ctx.config.sqlMaxRows`; `effectiveLimit = cap !== undefined ? Math.min(requested, cap) : requested`. Slice by `effectiveLimit`. Add `rowsCapped: true` to the result ONLY when `cap !== undefined && cap < requested`. Preserve existing `truncated`/`totalAvailable` semantics (recompute against `effectiveLimit`).
  - [x] Forward the timeout: build an options object; if `ctx.config.sqlTimeoutMs !== undefined` set `options.timeout = ctx.config.sqlTimeoutMs`; call `ctx.http.post(path, body, options)`. When unset, pass no options (byte-for-byte today).
  - [x] Update the tool `description` to document `IRIS_SQL_MAX_ROWS`/`IRIS_SQL_TIMEOUT` (operator-set hard caps).
- [x] **Task 3 — Unit tests (AC 24.2.1, Rule #19)**
  - [x] `packages/iris-dev-mcp/src/__tests__/sql.test.ts` (extend): (a) unset caps → no `rowsCapped`, no timeout option (mock the http client, assert the 3rd arg is undefined/absent) — the byte-for-byte no-op proof; (b) `sqlMaxRows` below the caller's `maxRows` → `rowsCapped: true` + clamped rowCount; (c) `sqlMaxRows` above the caller's request → no `rowsCapped`; (d) `sqlTimeoutMs` set → the post options carry `timeout`. Add config-parse tests in `config.test.ts` for the two env vars incl. invalid-value fail-fast.
  - [x] Keep tests in the DEFAULT suite (not `*.integration.test.ts`).
- [x] **Task 4 — Docs rollup (AC 24.2.2)** — all surfaces listed in the AC. Write the README "Read-only mode" subsection as the marketing headline, with the escaped-JSON caveat consistent with the existing `IRIS_PROFILES`/`IRIS_GOVERNANCE` guidance.
- [x] **Task 5 — Verify (AC 24.2.4)**
  - [x] `pnpm turbo run build` + `pnpm turbo run test` green; `pnpm gen:governance-baseline:check` exit 0; `git diff --exit-code packages/shared/src/governance-baseline.ts` clean.
- [x] **Task 6 — Live smokes (AC 24.2.3 — the LEAD executes these at the smoke gate; dev ensures the built dist supports env-driven preset + caps end-to-end.)** Dev: confirm the tool reads `ctx.config.sqlMaxRows`/`sqlTimeoutMs` from the real config path so a built-dist run with the env vars set actually caps. Note in Dev Agent Record that the live rejection smoke is the lead's gate.

### Review Findings

Code review (2026-07-08, adversarial three-layer). Outcome: **0 HIGH**; 2 patched inline, 1 deferred, 3 dismissed. All patches verified: shared build clean, 664/664 shared + 365/365 dev tests green, `gen:governance-baseline:check` exit 0, `governance-baseline.ts` git-clean.

- [x] [Review][Patch] CR 24.2-P1 (MED) — `IRIS_SQL_TIMEOUT` accepted non-finite `Infinity` (→ `{timeout: Infinity}` → Node clamps to ~1ms, silently disabling SQL). Switched `Number.isNaN` → `!Number.isFinite` (matches `profiles.ts:200`). [`packages/shared/src/config.ts`] — FIXED + config test added.
- [x] [Review][Patch] CR 24.2-P2 (MED) — SQL caps silently ignored on non-default `IRIS_PROFILES` profiles (`mergeProfile` allowlist omitted `sqlMaxRows`/`sqlTimeoutMs`), undercutting AC 24.2.1's "HARD cap" + Epic 24's "point it at PRODUCTION" (named-profile) headline. Now inherited from `base` like `timeout` (conditional spread, Rule #19 shape preserved). [`packages/shared/src/profiles.ts`] — FIXED; QA "KNOWN GAP" test flipped to assert propagation WORKS + unset-shape test added.
- [x] [Review][Defer] CR 24.2-1 (LOW) — `IRIS_SQL_MAX_ROWS` is a post-fetch display slice, not a wire/memory resource cap (Atelier returns all rows, then `slice`); docs' "hard cap" framing overstates the guarantee. [`packages/iris-dev-mcp/src/tools/sql.ts`] — deferred, pre-existing tool mechanism (see `deferred-work.md`).
- [x] [Review][Dismiss] `rowsCapped: true` when `cap < requested` even if fewer rows exist — by-design, matches AC 24.2.1 ("reduced the requested **limit**", distinct from `truncated`); explicitly tested.
- [x] [Review][Dismiss] `Number()` accepts hex/scientific/whitespace forms — consistent with pre-existing `IRIS_PORT`/`IRIS_TIMEOUT` validators; story instructed mirroring that pattern.
- [x] [Review][Dismiss] Docs describe caps as "hard ceiling on any call" without profile caveat — mooted by CR 24.2-P2 (caps now apply to every profile).

## Dev Notes

### Probe result (spec `[PROBE the TS path]` — resolved, use these)
- `iris_sql_execute` (`packages/iris-dev-mcp/src/tools/sql.ts`): `maxRows` param (`z.coerce.number().int().min(1).optional()`), `DEFAULT_MAX_ROWS = 1000`, `limit = maxRows ?? DEFAULT_MAX_ROWS`, slices, sets `truncated`/`totalAvailable`. It calls `ctx.http.post(path, body)` with **no timeout arg today**.
- `ctx.http.post(path, body, options?)` — `RequestOptions.timeout` is **milliseconds**, overriding the client default (`http-client.ts:22,150` — `timeout = options?.timeout ?? this.defaultTimeout`). So `IRIS_SQL_TIMEOUT` seconds → `{ timeout: seconds*1000 }`.
- `ctx.config` is `IrisConnectionConfig` (`tool-types.ts:155`), built by `loadConfig` (`config.ts:43`). Add the two optional cap fields there. The existing `timeout` field (default 60_000ms) is the model for validation + typing.

### Hard constraints
- **Rule #19 (back-compat):** unset caps = byte-for-byte today (no `rowsCapped`, no timeout option). This is a mechanical no-op test, not prose. Same discipline that governs the preset's unset path.
- **Rule #30 (docs):** ALL surfaces — a new capability documented on only some surfaces is an incomplete rollup. State default states (read-only opt-in; caps opt-in).
- **Rule #31:** SQL caps are configuration on an EXISTING tool; the preset is framework configuration. No new tool/key; package `index.test.ts` tool-array lengths unchanged.
- **Rule #23/#25:** frozen baseline untouched; `gen:governance-baseline:check` only.
- **Rules #22/#26 (live smoke):** drive the BUILT dist (rebuild first). The read-only rejection must be proven on a REAL server (the preset gate lives in `handleToolCall`); assert the write changed nothing. Delete the smoke script before staging.

### Not service-introducing
- This story modifies an existing tool (`iris_sql_execute`) + docs + config; it introduces no new service/module a later story consumes. No Integration AC needed (it consumes Story 24.1's preset only in the live smoke). The `## Integration ACs` note: "Modifies existing tool + config; no new consumer wiring — not service-introducing."

### Project Structure Notes
- Touch: `packages/shared/src/config.ts` (env read + `IrisConnectionConfig` fields), `packages/iris-dev-mcp/src/tools/sql.ts` (caps), tests in both packages' `__tests__/`, `README.md`, `docs/client-config/*.md` (×3), `packages/iris-dev-mcp/README.md`, `CHANGELOG.md`.
- Do NOT touch ObjectScript, `governance-baseline.ts`, `baseline-classifications.ts`, or the preset engine (24.1 — stable).

### References
- [Source: research/feature-specs/02-governance-presets.md#2.4 SQL resource caps] — the two env vars, clamp + `rowsCapped` annotation, timeout forwarding, unset=no-op, docs.
- [Source: research/feature-specs/02-governance-presets.md#3 story 3] + [#4 AC 7, AC 9] — caps wiring, docs rollup, live smokes.
- [Source: packages/iris-dev-mcp/src/tools/sql.ts] — the tool to extend (probe result above).
- [Source: packages/shared/src/http-client.ts:22,150] — `RequestOptions.timeout` (ms) plumbing.
- [Source: packages/shared/src/config.ts:9,24,72-82] — `IrisConnectionConfig` + `loadConfig` + the `timeout` validation to mirror.
- [Source: README.md:67-80,175-285] — env-var table + "Multiple Servers & Governance" section to extend.
- [Source: .claude/rules/project-rules.md] — Rules #19, #22, #23, #25, #26, #30, #31.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via bmad-dev-story workflow.

### Debug Log References

None — no debugger/temporary-global sessions were needed; implementation followed the story's
precise Dev Notes probe result directly.

### Completion Notes List

- **AC 24.2.1 (SQL caps clamp + annotate; unset = no-op) — MET.** `loadConfig` (`packages/shared/src/config.ts`)
  reads `IRIS_SQL_MAX_ROWS` (positive integer, fail-fast) and `IRIS_SQL_TIMEOUT` (positive number of
  seconds, fail-fast, pre-converted to `sqlTimeoutMs` in milliseconds) and returns them as optional
  `IrisConnectionConfig` fields via a conditional spread — when unset, the returned object literally
  carries no `sqlMaxRows`/`sqlTimeoutMs` keys at all (not even `undefined`), so `toEqual`/`not.toHaveProperty`
  assertions prove byte-for-byte parity with the pre-change shape. `iris_sql_execute`
  (`packages/iris-dev-mcp/src/tools/sql.ts`) computes `effectiveLimit = min(requested, cap)` when a cap
  is configured, sets `rowsCapped: true` only when `cap < requested` (never when `cap === requested`,
  matching AC wording exactly), and preserves `truncated`/`totalAvailable` recomputed against the
  clamped `effectiveLimit` so both fields can coexist with `rowsCapped`. The HTTP call is made with
  EITHER two args (`path, body`) OR three (`path, body, options`) — never three with an explicit
  `undefined` third arg — so the pre-existing `toHaveBeenCalledWith(path, body)` two-arg assertions in
  `sql.test.ts` continue to pass unmodified (Jest/Vitest `toHaveBeenCalledWith` treats a call recorded
  with a trailing explicit `undefined` as arity-3, which would NOT match a 2-arg expectation — this was
  the load-bearing implementation detail for the Rule #19 mechanical no-op proof).
- **AC 24.2.2 (docs rollup) — MET.** Updated: `README.md` (env-var table +3 rows, a new "Read-only
  mode" marketing subsection under "Multiple Servers & Governance" headlining the one-env-var pitch,
  presetApplied explanation, explicit-override precedence, and the paired SQL caps; Backward
  Compatibility note), `docs/client-config/{claude-code,claude-desktop,cursor}.md` (new "Read-only Mode +
  SQL Resource Caps (optional)" section with a copy-pasteable escaped `env` block per client),
  `packages/iris-dev-mcp/README.md` (Configuration section note that `IRIS_GOVERNANCE_PRESET` is
  framework config applying to all 5 servers, not a dev-package tool; SQL Tools section governance-defaults
  callout extended with the caps note; `iris_sql_execute` example annotated with the `rowsCapped` behavior),
  `CHANGELOG.md` (new `[Pre-release — 2026-07-08]` entry covering the whole Epic 24 capability —
  preset + baseline-classifications + SQL caps — since Stories 24.0/24.1 had not yet added a CHANGELOG
  entry). Verified README.md had ZERO prior mentions of "preset" before this story, confirming the docs
  rollup for `IRIS_GOVERNANCE_PRESET` (shipped in Story 24.1) was correctly deferred to this story per
  the epic's story split.
- **AC 24.2.3 (live smokes) — LEAD GATE, not executed by dev.** Verified instead that the BUILT dist
  (`packages/shared/dist/config.js`, `packages/iris-dev-mcp/dist/tools/sql.js`) contains the cap-reading
  code end-to-end (`ctx.config.sqlMaxRows`/`sqlTimeoutMs` read from the real `loadConfig` → `buildToolContext`
  → `ctx.config` path — no mock/shortcut), so a built-dist run with `IRIS_SQL_MAX_ROWS`/`IRIS_SQL_TIMEOUT`
  set will cap/time-out for real. The `IRIS_GOVERNANCE_PRESET` read-only rejection path was already
  live-verified in Story 24.1 (not re-verified here — Story 24.1 is stable/not touched). Per the task
  instructions, the live rejection smokes remain the lead's per-story smoke gate.
- **AC 24.2.4 (suite/baseline integrity) — MET.** `pnpm turbo run build` (6/6), `pnpm turbo run test`
  (12/12 tasks — shared 661, dev 356, admin 439, ops 335, interop 270, all green), `pnpm turbo run lint
  type-check` (18/18), `pnpm gen:governance-baseline:check` exit 0 (frozen 141 / live 194 / 53
  post-foundation, foundation intact), `git diff --exit-code packages/shared/src/governance-baseline.ts`
  clean. No new tool/governance key — every package's `index.test.ts` tool-array length assertion is
  unchanged (dev 20 tests incl. `index.test.ts` 8 tests, unmodified).
- **Scope note for the lead/reviewer (not an AC gap, flagged for awareness):** `IRIS_SQL_MAX_ROWS`/
  `IRIS_SQL_TIMEOUT` are read once into the `default` profile's `IrisConnectionConfig` (via
  `loadConfig`). Multi-server setups using `IRIS_PROFILES` build non-default profiles via
  `profiles.ts`'s `mergeProfile()`, which constructs a fresh `IrisProfile` object literal listing only
  the documented per-profile fields (`host`/`port`/`username`/`password`/`namespace`/`https`/`timeout`)
  — it does NOT spread `sqlMaxRows`/`sqlTimeoutMs` from the default profile. So today, the SQL caps
  apply ONLY when a call resolves to the `default` profile; calls with an explicit `server: "<other>"`
  profile bypass the cap even if the operator set the env vars. This story's ACs, Dev Notes ("Project
  Structure Notes"), and unit/live-smoke plan scope the caps to `config.ts` + `sql.ts` only and do NOT
  mention `profiles.ts` (a Story 14.1 module marked stable elsewhere in the rules), so `profiles.ts` was
  deliberately left untouched rather than unilaterally widening scope. If per-profile cap propagation is
  desired, it needs a follow-up story to extend `ProfileOverride`/`mergeProfile` (or make the caps
  suite-wide/env-only rather than per-profile-config), plus new tests/live smoke against a non-default
  profile.

### File List

- `packages/shared/src/config.ts` — added `IRIS_SQL_MAX_ROWS`/`IRIS_SQL_TIMEOUT` env parsing + fail-fast
  validation + optional `sqlMaxRows`/`sqlTimeoutMs` fields on `IrisConnectionConfig`.
- `packages/shared/src/__tests__/config.test.ts` — added 9 tests for the two new env vars (unset no-op,
  parse, fail-fast on invalid/zero/negative/non-integer).
- `packages/iris-dev-mcp/src/tools/sql.ts` — wired `ctx.config.sqlMaxRows` (effective-limit clamp +
  `rowsCapped` annotation) and `ctx.config.sqlTimeoutMs` (conditional `http.post` options arg); updated
  tool `description`.
- `packages/iris-dev-mcp/src/__tests__/sql.test.ts` — added 6 tests (byte-for-byte no-op, cap-below,
  cap-above/no-op, cap-equals-default/no-op, timeout-forwarded).
- `README.md` — env-var table rows, new "Read-only mode" marketing subsection, Backward Compatibility
  note.
- `docs/client-config/claude-code.md` — new "Read-only Mode + SQL Resource Caps (optional)" section.
- `docs/client-config/claude-desktop.md` — new "Read-only Mode + SQL Resource Caps (optional)" section.
- `docs/client-config/cursor.md` — new "Read-only Mode + SQL Resource Caps (optional)" section.
- `packages/iris-dev-mcp/README.md` — `IRIS_GOVERNANCE_PRESET` framework note, SQL caps governance-defaults
  callout, `iris_sql_execute` example `rowsCapped` note.
- `CHANGELOG.md` — new `[Pre-release — 2026-07-08]` Epic 24 entry.

## Change Log

| Date | Change |
|---|---|
| 2026-07-08 | Story 24.2 dev pass complete: `IRIS_SQL_MAX_ROWS`/`IRIS_SQL_TIMEOUT` optional caps wired into `iris_sql_execute` via `loadConfig`/`IrisConnectionConfig` (`sqlMaxRows`/`sqlTimeoutMs`, fail-fast validation mirroring the existing `timeout` check); `effectiveLimit = min(requested, cap)`, `rowsCapped: true` only when the cap actually clamps, `truncated`/`totalAvailable` recomputed against the clamp so both can coexist; timeout forwarded as `{ timeout: sqlTimeoutMs }` to `ctx.http.post` ONLY when set (never an explicit-`undefined` 3rd arg) — a mechanical no-op test proves unset caps are byte-for-byte today's call signature and output shape (Rule #19). 15 new unit tests (9 `config.test.ts` + 6 `sql.test.ts`). Full docs rollup (Rule #30) across README.md (env-var table + new "Read-only mode" marketing subsection, folding in Story 24.1's previously-undocumented `IRIS_GOVERNANCE_PRESET` + Backward Compatibility note), all 3 client-config guides (copy-pasteable escaped `env` blocks), `packages/iris-dev-mcp/README.md` (framework-config note + SQL-caps callout + `rowsCapped` example note), and a new consolidated `CHANGELOG.md` entry covering Epic 24 (24.0/24.1/24.2 — Stories 24.0/24.1 had not yet added one). No new tool/governance key (Rule #31); frozen baseline `1e62c5ad5bf7` untouched, `gen:governance-baseline:check` exit 0 (141/194/53), `git diff --exit-code governance-baseline.ts` clean. Verified: `pnpm turbo run build` clean (7 packages), `pnpm turbo run test` 12/12 tasks green (shared 661, dev 356, admin 439, ops 335, interop 270 — zero regressions), `pnpm turbo run lint type-check` 18/18 green. AC 24.2.3 (live rejection smokes) intentionally left for the lead's per-story smoke gate; verified the built dist reads the real `ctx.config.sqlMaxRows`/`sqlTimeoutMs` config path end-to-end. Flagged (not fixed, out of authorized scope — `profiles.ts` not in this story's touch-list): `IRIS_SQL_MAX_ROWS`/`IRIS_SQL_TIMEOUT` apply only to calls resolving to the `default` profile today; `profiles.ts`'s `mergeProfile()` does not propagate the two new fields to `IRIS_PROFILES`-defined non-default profiles. Status: ready-for-dev → review. |
