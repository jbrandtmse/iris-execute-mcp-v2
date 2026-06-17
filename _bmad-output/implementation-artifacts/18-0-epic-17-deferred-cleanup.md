# Story 18.0: Epic 17 Deferred Cleanup

Status: review

**Epic:** 18 — Deferred-Work Cleanup & Hardening (post-Epic-17)

## Story

**As a** maintainer, **I want** the Epic 16–17 deferred items triaged and the include-now ones resolved, **so that** accumulation does not go silent and the next epic starts from a clean ledger.

## Context — Epic 18 Retro-Review Gate (minimal epic)

Epic 18 is a **minimal cleanup epic** authored at `/epic-cycle 18` time (user-confirmed "Just Story 18.0"). It contains only this story. Per the Epic 17 retrospective (`epic-17-retro-2026-06-16.md`) Action Item #1, Story 18.0 triages the carried `deferred-work.md` items (primarily Epic 17 CR 17.2-1…-5, plus the cross-tool `namespace`-accepted-but-ignored pattern CR 16.1-1 / 16.2-1 / 16.3 and the generator/drift-test de-dup CR 16.0-1 / -2) and re-affirms AI#4 (`iris_backup_manage restore`). Include-now items are fixed in THIS story; the rest are re-deferred with rationale.

This story is **strictly additive**. The governance baseline stays frozen `1e62c5ad5bf7` (141 keys; Rule #23/#25). Any ObjectScript handler change regenerates `bootstrap-classes.ts` + moves `BOOTSTRAP_VERSION` in this same story (Rule #24); if no ObjectScript is touched, the bootstrap hash stays unchanged and that is asserted.

## Acceptance Criteria

- **AC 18.0.1** — Every open `deferred-work.md` item originating from Epics 16–17 (CR 16.0-1/-2, CR 16.1-x, CR 16.2-x, CR 16.3-x, CR 17.1-x, CR 17.2-1…-5) plus retro AI#4 is triaged into **include-now** / **re-defer** / **drop** with rationale. The triage table below is the authoritative record (confirm/adjust during dev).
- **AC 18.0.2** — Each **include-now** fix is implemented and preserves existing behavior (strictly additive). The hardening fixes target the NEW, opt-in, default-disabled `iris_production_item` add/arbitrary-settings surface and the read-only `namespace`-param descriptions — no change to any existing enabled behavior or output shape.
- **AC 18.0.3** — If any ObjectScript handler is modified (Interop.cls is, per the include-now set), regenerate `bootstrap-classes.ts` (`pnpm run gen:bootstrap`, Rule #18 — never hand-edit) and record `BOOTSTRAP_VERSION` from→to in this story; `bootstrap.test.ts` green. (Current head: `39dc932907cb`.)
- **AC 18.0.4** — Governance baseline stays frozen (`1e62c5ad5bf7`, 141 keys); `pnpm run gen:governance-baseline:check` exits 0 (Rule #23/#25); the bare `gen-governance-baseline.mjs` is NEVER run.
- **AC 18.0.5** — `deferred-work.md` is updated: include-now items marked RESOLVED (with the fix + commit context), re-deferred items retained with updated rationale/target, dropped items closed with rationale. AI#4 backup-restore re-affirmed as deferred.
- **AC 18.0.6** — Full monorepo test suite green; lint + type-check clean. Every code path touched is exercised by an existing or newly-added test (TS-layer for the `namespace`-description + tool-description changes; ObjectScript-layer or live-smoke for the Interop.cls guards per Rule #26).

## Tasks / Subtasks

- [x] **Task 1 — Confirm triage (AC 18.0.1)**: Re-read the `deferred-work.md` Epic 16–17 sections + Epic 17 retro Action Items. Confirm or adjust the triage table below. Apply Rule #16 (live-probe / read `irislib/Ens/Config/{Production,Item,Setting}.cls` + `src/ExecuteMCPv2/REST/Interop.cls`) before trusting any suggested-resolution API claim.
- [x] **Task 2 — `namespace`-param description cleanup (AC 18.0.2, TS-only) [CR 16.1-1 / 16.2-1 / 16.3]**: In the three ops %SYS-scoped tools that accept-but-ignore `namespace` (`packages/iris-ops-mcp/src/tools/process.ts`, `database.ts`, `backup.ts`), tighten the `namespace` param **description** to state explicitly that the value has no effect (operation is %SYS-scoped). **Do NOT drop the param** — removing an accepted optional param is a back-compat break for any caller currently sending it; a description tightening is strictly additive. Update/add a unit test asserting the description text (or that the param is still accepted and ignored without error).
- [x] **Task 3 — Interop.cls hardening on the new add/arbitrary-settings surface (AC 18.0.2/18.0.3) [CR 17.2-1/-2/-3/-5]**: In `src/ExecuteMCPv2/REST/Interop.cls`:
  - [x] **CR 17.2-1**: `ApplyArbitrarySetting` returns a `%Status`; capture + propagate it at both call sites (currently `Do ..ApplyArbitrarySetting(...)`) before pushing the key to `updatedSettings` — surface a failed setting application instead of swallowing it.
  - [x] **CR 17.2-2**: `@Host`/`@Adapter` suffix parser — scan the **LAST** `@` (not `$Find`'s first), reject an empty setting Name (leading `@`), and reject/flag an unknown suffix (anything other than the validated `Host`/`Adapter` targets) rather than silently folding it into the name with the default target.
  - [x] **CR 17.2-3**: `add` action — pre-check `FindItemByConfigName` for a duplicate item Name in the production (reject non-idempotent duplicate) AND `%Dictionary.CompiledClass.%ExistsId(className)` for the host class (reject non-existent/non-compiled className) before `Items.Insert`/`SaveToClass`.
  - [x] **CR 17.2-5**: check the `%Status` returned by `LoadFromClass` (currently invoked with `Do`); fail clearly on a load failure instead of proceeding to `%OpenId` on a stale/half-loaded extent.
  - [x] Follow Rules #7/#9/#15/#27/#29 + namespace save-restore (no `New $NAMESPACE`).
- [x] **Task 4 — Tool-description note for the extent/XData split (AC 18.0.2/18.0.5) [CR 17.2-4 — doc-only include]**: Add a short note to the `iris_production_item` tool description (TS) documenting that a just-`add`-ed item is not visible to an immediate `get`/`set` until the next add/remove `LoadFromClass` sync (extent vs class-XData split, Rule #27). The underlying extent/XData persistence-model split itself stays **DEFERRED** (pre-existing/accepted IRIS limitation, mirrors Story 5-3 won't-fix) — do NOT re-architect it.
- [x] **Task 5 — Bootstrap re-roll + governance check (AC 18.0.3/18.0.4)**: After Interop.cls changes, deploy via glob-prefixed `iris_doc_load` (Rule #17) to HSCUSTOM, compile clean, `pnpm run gen:bootstrap`, record `BOOTSTRAP_VERSION` from→to, `bootstrap.test.ts` green. `pnpm run gen:governance-baseline:check` exit 0; baseline git-clean.
- [x] **Task 6 — Update `deferred-work.md` + run full suite (AC 18.0.5/18.0.6)**: Mark include-now items RESOLVED, retain re-deferred items with updated rationale/target, close dropped items. Re-affirm AI#4. Full monorepo `pnpm test` + `pnpm lint` + type-check green.

## Triage Table — Epic 16–17 Deferred Items → Epic 18 Story 18.0

Triage date: 2026-06-17. Source: `deferred-work.md` (Epic 16–17 sections) + `epic-17-retro-2026-06-16.md` Action Items.

| Item | Source | Triage Decision |
|---|---|---|
| **CR 17.2-1** — `ApplyArbitrarySetting` `%Status` discarded at both call sites; failed setting still reported as updated | deferred-work.md (17.2) | **INCLUDE-NOW** (Task 3) — capture + propagate status before `%Push`. LOW, on new opt-in surface. |
| **CR 17.2-2** — `@Host`/`@Adapter` suffix parser edges (first-`@`, leading-`@` empty name, unknown suffix silently folded) | deferred-work.md (17.2) | **INCLUDE-NOW** (Task 3) — scan last `@`, validate non-empty name, reject unknown suffix. MED, lead-smoke-covered (Rule #26). |
| **CR 17.2-3** — `add` does not validate className exists/compiles or item-Name uniqueness | deferred-work.md (17.2) | **INCLUDE-NOW** (Task 3) — pre-check `FindItemByConfigName` + `%Dictionary.CompiledClass.%ExistsId`. MED, lead-smoke-covered. |
| **CR 17.2-4** — set-vs-add/remove extent/XData persistence split; just-added item invisible to immediate get/set | deferred-work.md (17.2) | **DEFER (re-affirm, doc-only include)** — pre-existing/accepted IRIS limitation, mirrors Story 5-3 closed won't-fix. Add a tool-description note (Task 4); do NOT re-architect. |
| **CR 17.2-5** — `LoadFromClass` `%Status` ignored (`Do`, no check) | deferred-work.md (17.2) | **INCLUDE-NOW** (Task 3) — check status; pairs with 17.2-2/-3. LOW. |
| **AI#4** — `iris_backup_manage restore` scriptable path | Epic 17 retro AI#4 | **RE-AFFIRM DEFER** — IRIS restore is interactive (`^DBREST`/`CLUMENU^JRNRESTO`), no scriptable classmethod; no demand. Carry in deferred-work. |
| **CR 16.1-1 / 16.2-1 / 16.3-namespace** — ops %SYS-scoped tools (process/database/backup) accept-but-ignore `namespace` | deferred-work.md (16.1/16.2/16.3) | **INCLUDE-NOW** (Task 2) — tighten descriptions to state value has no effect; keep param (dropping = back-compat break). TS-only, no bootstrap. |
| **CR 16.0-1** — generator `--check` vs `governance.test.ts:555` lock-step divergence (shared-helper de-dup) | deferred-work.md (16.0) | **RE-DEFER** — pure refactor, no current correctness impact (today's all-bare action surface agrees, verified); touches frozen-baseline tooling (own focused task). Target: a future generator/CI hardening pass. |
| **CR 16.0-2** — vanished-key `--check` CLI exit-1 path has no direct test (blocked by additive constraint until 16.0-1) | deferred-work.md (16.0) | **RE-DEFER** — pairs with CR 16.0-1; add the unit test when the derivation is extracted into an importable helper. |
| **CR 16.0-3** — `--check --force` precedence / unknown-flag handling | deferred-work.md (16.0) | **DROP (dismissed, by-design)** — safe path always wins, refusal non-destructive; flag-conflict validation is gold-plating for a build-time generator. No action. |
| **CR 16.1-2** — `ProcessManage` TOCTOU window | deferred-work.md (16.1) | **RE-DEFER** — now fails CLOSED / benign refusal; true atomicity not available in `SYS.Process` API. Accepted standard pattern. |
| **CR 16.1-3** — `ProcessGet` `MemoryUsed` mailbox-read latency | deferred-work.md (16.1) | **RE-DEFER** — perf only; revisit if `get` latency is reported. |
| **CR 16.1-4** — self-PID guard protects `$JOB` not external client | deferred-work.md (16.1) | **DROP (dismissed)** — `$JOB` is the only meaningfully self-protectable PID; matches AC intent. |
| **CR 16.2-2** — no numeric range validation on `percentFull`/`targetSize`/`initialSize` | deferred-work.md (16.2) | **RE-DEFER** — clean-envelope path covers it (SanitizeError + Catch backstop); friendlier `.min()/.max()` pre-flight is a future input-hardening pass. |
| **CR 16.2-3** — compact/truncate ByRef pre-init-0 vs failure indistinguishable | deferred-work.md (16.2) | **DROP (dismissed, cosmetic)** — success path never renders on failure; invisible to caller. |
| **CR 16.3-device** (MED) — `run` reads `device` but `StartTask` called without it | deferred-work.md (16.3) | **RE-DEFER** — backup destination is a property of the user-defined task; per-call device override not part of the verified API path. Fold into the same ops-tool cleanup pass (or drop `device` from schema later). |
| **CR 16.3-thaw-password** (LOW) — theoretical `ExternalThaw` password echo | deferred-work.md (16.3) | **RE-DEFER** — theoretical, needs live freeze/thaw round-trip to confirm; narrow redaction concern Epic 11 retro declined to codify. Add redaction only if observed. |
| **CR 17.1-1** — `\|\|` IdKey-delimiter injection guard has no automated test | deferred-work.md (17.1) | **RE-DEFER (covered by Epic 18 lead smoke)** — server-side guard requires live-HTTP to exercise; the Epic 18 / Story 18.0 lead smoke asserts the rejection (Rule #26). No code change. |
| **CR 17.1-2 / 17.1-3** — empty-slot→`*` coercion / `deployable` direct-REST coercion | deferred-work.md (17.1) | **DROP (dismissed-as-intentional)** — documented deliberate-caller paths; MCP callers safe via Zod. No action. |

## Dev Notes

### Include-now scope (the only code that changes)
- **TS (no bootstrap):** `packages/iris-ops-mcp/src/tools/{process,database,backup}.ts` `namespace` param descriptions; `packages/iris-interop-mcp/src/tools/...` `iris_production_item` tool description note (Task 4 — locate the exact tool file during dev).
- **ObjectScript (one bootstrap re-roll):** `src/ExecuteMCPv2/REST/Interop.cls` — `ApplyArbitrarySetting` (status propagation + `@`-suffix parser), `add` branch (dup-name + className-exists pre-check), `LoadFromClass` status checks. Deploy via glob-prefixed `iris_doc_load` (Rule #17); compile clean on HSCUSTOM; `gen:bootstrap`.

### Guardrails
- **Strictly additive (Rule #19 spirit):** the hardening rejects previously-silently-accepted BAD input on the new opt-in default-disabled surface; it must NOT change any existing enabled action's success output shape. The existing `enable`/`disable`/`get`/`set` + 6 working keys stay byte-for-byte (the 17.2 back-compat snapshot tests must remain green).
- **Rule #27** (Ens.Config XData-vs-extent / `LoadFromClass` before `%OpenId`) already applied in 17.2; preserve it.
- **Rule #29** (composite-IdKey delimiter guard) already in `DefaultSettingsManage`; the new `add` validation is the analogous input-hygiene guard for production items.
- **Governance:** no new tools/actions/keys → no `mutates` change, baseline stays frozen `1e62c5ad5bf7`. `gen:governance-baseline:check` only (never bare generator — Rule #25).

### Testing standards
- TS-layer: unit tests for the `namespace`-description and tool-description changes (assert accepted-and-ignored / description text).
- ObjectScript guards (CR 17.2-2/-3 rejections, 17.2-1/-5 status propagation): genuine coverage requires the lead live-HTTP smoke (Rule #26 — mocked-HTTP TS tests can't exercise server-side guards). The Story 18.0 smoke MUST send (a) an `add` with a non-existent className and a duplicate name → assert REJECTED, no write; (b) an arbitrary setting with a malformed `@`-suffix (`@Foo`, leading `@`) → assert REJECTED/flagged; (c) the `||` IdKey guard rejection (CR 17.1-1 coverage). Add ObjectScript-layer unit tests where feasible.

### References
- `epic-17-retro-2026-06-16.md` Action Item #1 + Rules Codified (#27/#28/#29)
- `_bmad-output/implementation-artifacts/deferred-work.md` (Epic 16–17 sections, CR 16.0-x / 16.1-x / 16.2-x / 16.3-x / 17.1-x / 17.2-1…-5)
- `_bmad-output/planning-artifacts/epics.md` (Epic 18 + Story 18.0, ACs 18.0.1–18.0.6)
- `.claude/rules/project-rules.md` Rules #2, #7, #9, #15, #16, #17, #18, #19, #23, #24, #25, #26, #27, #29
- IRIS sources: `irislib/Ens/Config/{Production,Item,Setting}.cls`; handler `src/ExecuteMCPv2/REST/Interop.cls`

### Project Structure Notes
- No new files expected beyond test additions. Touches `iris-ops-mcp` tools (TS), `iris-interop-mcp` tool description (TS), `ExecuteMCPv2.REST.Interop` (ObjectScript) + regenerated `bootstrap-classes.ts`.

### Review Findings

Code review 2026-06-17 (Story 18.0 code-review stage). Three parallel layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor). Outcome: 0 decision-needed, 1 patch (applied), 2 deferred, 5 dismissed. All six ACs verified satisfied; no unresolved HIGH/MED.

**Patch (applied inline):**
- [x] [Review][Patch] deferred-work.md stale line-number refs in CR 17.2-4/17.2-5 original deferral entries [_bmad-output/implementation-artifacts/deferred-work.md:495-496] — replaced shifted hardcoded line numbers (`503,561,532-538`) with stable `ItemManage add/remove branches` references; reclassified the CR 17.2-5 original entry from DEFERRED to RESOLVED-in-18.0 (it was resolved this story) to remove the ledger contradiction.

**Deferred (recorded in deferred-work.md "NEW — surfaced in Story 18.0 code review"):**
- [x] [Review][Defer] CR 18.0-1 (MED) — `add` className guard does not reject whitespace-padded / abstract / `%`-package host classes [src/ExecuteMCPv2/REST/Interop.cls add branch] — strictly additive over OLD (no guard); beyond codified CR 17.2-3 scope; future input-hardening pass.
- [x] [Review][Defer] CR 18.0-2 (LOW) — `add` duplicate-name check relies on `FindItemByConfigName` index collation (case-variant may not be detected) [src/ExecuteMCPv2/REST/Interop.cls add branch] — needs live-probe of `(Production,Name)` collation; fold into same hardening pass.

**Dismissed (verified non-issues):**
- Edge Hunter HIGH "`set` key with `@<non-Host/Adapter>` previously accepted, now rejected" — DISMISSED as a regression. The arbitrary-`@` routing + `ApplyArbitrarySetting` were BOTH introduced in commit `a4100a0` (Story 17.2), i.e. the Epic-17 surface AC 18.0.2 scopes the hardening to (NOT a pre-17 grandfathered contract). The changed behavior IS the specified resolution of codified finding CR 17.2-2. Embedded-`@` acceptance was an incidental `$Find`-first-match mis-parse; Ens.Config.Setting names are ObjectScript identifiers and cannot contain `@` (verified vs `irislib/Ens/Config/Item.cls`), so the OLD path silently created an unconsumable setting and falsely reported success — rejecting it is strictly-better additive behavior per Rule #19, not a back-compat break.
- Edge Hunter MED "`set` error→failure flip" — DISMISSED; this is CR 17.2-1 itself (surface a swallowed failure instead of falsely reporting success), the specified hardening on the Epic-17 surface.
- LOW confirmations (single-render / Rule #7, namespace restore on every new early-exit, `$Get(tApplySC,$$$OK)` undefined guard, last-`@` off-by-one math `tAt-1`, Rule #16 `%Dictionary.CompiledClass.%ExistsId` for "exists AND compiles") — all independently verified correct by all three layers. No defect.

**AC verification:** AC 18.0.1 (triage table complete) / 18.0.2 (include-now fixes implemented + strictly additive, namespace change description-only) / 18.0.3 (bootstrap regenerated not hand-edited, `BOOTSTRAP_VERSION` 39dc932907cb→fd3f065bcd3c, `bootstrap.test.ts` 47 green) / 18.0.4 (governance baseline frozen `1e62c5ad5bf7` git-clean, `gen:governance-baseline:check` exit 0, bare generator NOT run) / 18.0.5 (deferred-work.md updated) / 18.0.6 (TS-layer tests added; ObjectScript guards correctly scoped to lead live-HTTP smoke per Rule #26, documented in Testing standards) — ALL SATISFIED. ops 254 tests green, interop 220 tests green.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.8 (1M context) — `claude-opus-4-8[1m]`.

### Debug Log References

- Interop.cls deploy + compile on HSCUSTOM via glob-prefixed `iris_doc_load` (`c:/git/iris-execute-mcp-v2/src/**/Interop.cls`, Rule #17): compiled successfully (`cku`).
- `pnpm run gen:bootstrap`: `BOOTSTRAP_VERSION` 39dc932907cb → fd3f065bcd3c (Interop.cls is the only changed bootstrapped class).
- `bootstrap.test.ts`: 41 tests green.
- `pnpm run gen:governance-baseline:check`: exit 0 — 141 frozen foundation keys all present in the live surface (190 live / 49 post-foundation); `governance-baseline.ts` git-clean, baseline hash frozen `1e62c5ad5bf7` (bare generator NOT run, Rule #25).
- Full monorepo `pnpm test`: 12/12 packages green. `pnpm lint`: 6/6 clean. `pnpm run type-check`: 12/12 clean.

### Completion Notes List

- **Task 2 (TS-only, no bootstrap):** Tightened the `namespace` param descriptions in `process.ts`/`database.ts`/`backup.ts` to state explicitly the value has NO EFFECT (%SYS-scoped) and is retained for back-compat — param NOT dropped. Added 2 tests per tool (description text assertion + accepted-and-forwarded back-compat assertion).
- **Task 3 (ObjectScript, one bootstrap re-roll):** In `Interop.cls`:
  - CR 17.2-1 — both `ApplyArbitrarySetting` call sites (set + add branches) now capture the `%Status` and render `SanitizeError` before pushing to `updatedSettings`. Single-render preserved (Rule #7): the in-iterator render is followed by a loop `Quit` then a post-loop `If $$$ISERR Quit` that exits the Try without a second render.
  - CR 17.2-2 — `ApplyArbitrarySetting` rewritten to scan the LAST `@` (inline loop, no `$Find` first-match), reject a leading-`@` empty name, and reject an unknown suffix (anything other than `Host`/`Adapter`) with a clear error.
  - CR 17.2-3 — `add` now pre-checks `%Dictionary.CompiledClass.%ExistsId(className)` (rejects non-existent/non-compiled host class) and `tProd.FindItemByConfigName(itemName)` (rejects duplicate item Name) before `Items.Insert`/`SaveToClass`.
  - CR 17.2-5 — `LoadFromClass` `%Status` captured + checked in both add and remove branches.
  - Namespace save/restore preserved (no `New $NAMESPACE`); existing enabled actions' success output shapes unchanged (17.2 back-compat snapshot tests stayed green).
- **Task 4 (TS):** Added an extent/XData add-then-get visibility NOTE to the `iris_production_item` description (Rule #27); the underlying split stays DEFERRED (not re-architected). Test pins the note text.
- **Task 5:** Interop.cls deployed + compiled clean on HSCUSTOM; bootstrap re-rolled 39dc932907cb → fd3f065bcd3c; governance baseline frozen + git-clean.
- **Task 6:** `deferred-work.md` updated with a Story 18.0 triage section (include-now RESOLVED; CR 17.2-4 + AI#4 re-affirmed DEFER with doc-only include; re-defers and drops recorded). Full suite/lint/type-check green.
- **Live verification:** the ObjectScript guards (CR 17.2-2/-3 rejections, 17.2-1/-5 status checks) require live-HTTP coverage (Rule #26) — mocked-HTTP TS tests cannot exercise the server-side guards. Confirmed compile-clean on HSCUSTOM; the destructive-path rejection assertions are scoped to the lead's per-story smoke gate.

### File List

- `packages/iris-ops-mcp/src/tools/process.ts` (modified)
- `packages/iris-ops-mcp/src/tools/database.ts` (modified)
- `packages/iris-ops-mcp/src/tools/backup.ts` (modified)
- `packages/iris-ops-mcp/src/__tests__/process.test.ts` (modified — tests added)
- `packages/iris-ops-mcp/src/__tests__/database.test.ts` (modified — tests added)
- `packages/iris-ops-mcp/src/__tests__/backup.test.ts` (modified — tests added)
- `packages/iris-interop-mcp/src/tools/item.ts` (modified)
- `packages/iris-interop-mcp/src/__tests__/item.test.ts` (modified — test added)
- `src/ExecuteMCPv2/REST/Interop.cls` (modified)
- `packages/shared/src/bootstrap-classes.ts` (regenerated — BOOTSTRAP_VERSION 39dc932907cb → fd3f065bcd3c)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified — Story 18.0 triage section)
