# Story 34.6: Pre-Publish Release Hardening

Status: ready-for-dev

<!-- Created 2026-08-15. Epic 34 re-opened a third time (Rule SC-5) on Project Lead escalation ahead of the first npm publish. -->

## Story

As a **maintainer about to publish this suite publicly**,
I want **the response payload bounded, the epic gate armed so it cannot silently skip at the packaging boundary, and the test-runner guard machine-detectable**,
so that **the first public release cannot ship an unbounded payload, a green build whose gate never ran, or an error state that AI-agent consumers read as success.**

## Why now

`@iris-mcp/*` has **never been published**. Everything sits at `0.0.2` with **9 unreleased changesets** spanning Epics 31–34, and the publish decision has been action item #1 in three consecutive retros. These five items are the subset whose blast radius changes materially the moment the package is public — an unbounded payload reaching real MCP clients, a release built with the gate skipped, and an error state that agent consumers silently misread.

All five are **Epic 34's own review findings**, so they close in Epic 34 rather than deferring to Epic 35.

## Acceptance Criteria

- **AC 34.6.1** (`34-2-R2` + `34-3-R2`, resolved together) — ONE documented output ceiling with an explicit elision marker, applied to **both** `/command` and `/classmethod`. `byRefValues` gains a node/byte budget with a `byRefTruncated` indicator. The ceiling and marker are stated in each tool's description and in the README. **Rule #38 discipline:** the cap truncates the **OUTPUT only** — the target already did the work — and must NOT be advertised as protection against the work itself or against a gateway timeout.
- **AC 34.6.2** (`34-4-R1`) — epic-gate leg (d) must be able to **FAIL** for the property it claims. Replace the namespace-invariant `%SYSTEM.Version.GetVersion()` oracle with a target returning `$NAMESPACE`, asserting `=== "USER"` **and** `!== <configured namespace>` (Rules #34/#40 — the namespace-sensitive area must genuinely differ). Apply to **both** the default-suite gate file and the `custom-rest.integration.test.ts` original.
- **AC 34.6.3** (`34-4-R3`) — the epic gate can no longer silently skip. The fixture probe re-throws anything that is not an `IrisApiError` carrying a not-found envelope (so a credential/network/licence fault fails **loudly** instead of collapsing into "fixtures not deployed"), **and** `IRIS_REQUIRE_LIVE=1` is set in whichever pipeline owns the release. **There is no CI in this repo** (`.github/workflows` absent — verified 2026-08-15), so the packaging/prepublish path is the only enforcement surface: the gate must fail **CLOSED** when packaging a release.
- **AC 34.6.4** (`34-5-R1`) — the zero-result guard is machine-detectable: it carries `structuredContent` with the same `{total, passed, failed, skipped, details, error}` object **and** `isError: true`. **This is a recorded Lead decision — do not re-litigate it, and do not pick only one half.** Applied to **ALL** guard paths including the package discovery-time guard, so no two guard paths diverge.
- **AC 34.6.5** — Rule #19: successful runs and under-ceiling responses are **byte-identical** to today at every level and on both endpoints. Proven mechanically. The ceiling is a deliberate, documented contract change on an unpublished package — state it in the changeset.
- **AC 34.6.6** — Rule #48 mutation evidence per fix (revert → red → restore byte-identically). Specifically: AC 34.6.2's leg (d) shown **RED** when `namespace` is dropped; AC 34.6.3's probe shown to **fail loudly** on a simulated credential fault rather than skipping.
- **AC 34.6.7** — Gates: `pnpm turbo run build test lint type-check` green; `gen:governance-baseline:check` (`:check` ONLY) exit 0 at frozen `1e62c5ad5bf7`/141/201/60; tool counts unmoved (#31); BOOTSTRAP_VERSION from→to recorded and Constraint C-2 re-verified if any bootstrapped class changes (#24; current `34233b5c9f63`); changeset added.

## Tasks / Subtasks

- [ ] **Task 1 — Output ceiling on both endpoints** (AC: 34.6.1, 34.6.5)
  - [ ] Pick and document ONE ceiling. The ledger suggests 64–256 KB; verify against what the CSP gateway and a real MCP client actually tolerate rather than picking a number by feel (Rule #36).
  - [ ] Elision marker must be unambiguous and machine-detectable, not a bare "…".
  - [ ] `byRefValues` node/byte budget + `byRefTruncated`.
  - [ ] Update both tool descriptions and the README; state the Rule #38 caveat explicitly.
- [ ] **Task 2 — Gate leg (d) can fail** (AC: 34.6.2, 34.6.6)
- [ ] **Task 3 — Gate fails closed** (AC: 34.6.3, 34.6.6)
  - [ ] Probe re-throws non-not-found errors.
  - [ ] Arm `IRIS_REQUIRE_LIVE=1` on the release/prepublish path; confirm mechanically that the armed path actually runs it (a variable set in a script nothing invokes is the same defect one layer up).
- [ ] **Task 4 — Machine-detectable guard, all paths** (AC: 34.6.4)
- [ ] **Task 5 — Gates + changeset** (AC: 34.6.7)

## Dev Notes

### The two lead decisions are already made

**AC 34.6.4 — both `structuredContent` and `isError: true`.** The ledger left this as an either/or lead decision; it is settled as **both**. Rationale, so nobody re-opens it: the guard fires only when the caller named a target that produced nothing — a *failed request*, not a clean run — so `isError: true` is truthful; and carrying `structuredContent` keeps `structuredContent.total` reading `0` rather than regressing to `undefined`, which is what an agent consumer reads today. Picking one half leaves a consumer class blind.

**AC 34.6.1 — one ceiling, both endpoints, resolved together.** `34-2-R2` and `34-3-R2` are the same product decision seen from two endpoints; the ledger's own suggested resolution says resolve them together. Do not implement two different ceilings.

### Verified facts about this repo (2026-08-15) — do not re-derive

- **There is no CI.** `.github/workflows` does not exist. `IRIS_REQUIRE_LIVE` currently appears **only** inside `execute-classmethod-epic-gate.test.ts` and in planning/ledger docs — it is armed nowhere. That combination is exactly why AC 34.6.3 exists: today, a release built with IRIS unreachable passes with all six gate legs skipped and the suite green.
- **Nothing is published.** `@iris-mcp/shared` and `@iris-mcp/dev` are both `0.0.2`, `private: false`. 9 pending changesets. So a contract change here costs nothing externally — but it is the last moment that is true.
- Current ledger state: **0 HIGH · 10 MEDIUM · 43 LOW** open (95 items, 42 terminal), all at Rule #37 re-deferral count 1.

### Why `34-3-R2` is a genuine regression risk and not just a duplicate

Before Story 34.3, `Execute()` surfaced a capture `<MAXSTRING>` as a **bounded ERROR**. It now completes and ships the full capture through `%ToJSON` and the CSP gateway — so the unbounded ~3.6 MB success response is **newly reachable on `/command`**. For `/classmethod` this is not new (34.2 already returned success + `truncated` at the ceiling). The ledger's own note says the realistic client outcome at the ceiling is a **transport failure**, which means `truncated` is least visible exactly where it was designed to matter.

### Scope discipline

- Stories 34.0–34.5 stay `done` and are NOT re-touched beyond what these ACs require (Rule #52).
- **Out of scope**, staying in the ledger at Rule #37 count 1: `34-1-R5`, `34-1-R8`, `34-2-R4` (recursion bound), `34-2-R5` (null-device leak), `34-3-R3` (re-entrancy), and all 43 LOW items.
- The npm publish itself is a **separate Project Lead action**, not this story. Do not publish, do not run `changeset version`, do not bump versions.
- No new tool or action (Rule #31) — tool counts and package tool-array length tests must not move.
- Frozen governance baseline untouched (#23/#25) — `:check` only, never the bare generator.

### Constraints

- **Rule #38** — an output cap is not a scan cap. Never advertise it as timeout protection.
- **Rule #19** — under-ceiling behavior byte-identical; prove mechanically per endpoint.
- **Rule #36** — pick the ceiling from measured reality, not intuition.
- **Rule #54** — for each new branch (elision, budget exhaustion, probe re-throw), ask what real input reaches it; and any test fake must return a shape the real API can actually produce.
- **Rule #55** — never generate file content through a shell heredoc; use the file-editing tools.
- **Rule #51** — mechanical tallies only.
- If ObjectScript changes: argumented `Quit` ILLEGAL inside Try/Catch; triple `$$$`; no underscores in method/class-parameter names; never touch a `Storage` section; glob-prefixed `iris_doc_load` (Rule #17); Rule #7 I/O discipline on any render path.

### Testing

- Vitest under `packages/**` (default suite; `packages/iris-dev-mcp/vitest.config.ts` excludes `src/**/*.integration.test.ts`), plus `%UnitTest` under `ExecuteMCPv2.Tests.*` for any ObjectScript change.
- Baselines: `@iris-mcp/dev` 638 tests / 38 files, 0 skipped; `ExecuteMCPv2.Tests` 330/330; `iris-mcp-all` 112/17; turbo 29/29.
- **Rule #35** — compare any `iris_execute_tests` total against a mechanically-counted expectation; never trust a zero.
- Live IRIS reachable: 2026.1 Build 235U; `HSCUSTOM` primary, `USER` second.

### References

- [Source: `_bmad-output/implementation-artifacts/deferred-work.md`] — `34-2-R2`, `34-3-R2`, `34-4-R1`, `34-4-R3`, `34-5-R1` with each raising layer's suggested resolution
- [Source: `_bmad-output/planning-artifacts/epics.md#Story 34.6`] — AC text
- [Source: `packages/iris-dev-mcp/src/__tests__/execute-classmethod-epic-gate.test.ts`] — the gate file (legs and probe)
- [Source: `packages/iris-dev-mcp/src/tools/execute.ts`] — the guards and the response assembly
- [Source: `.claude/rules/project-rules.md`] — #7, #17, #19, #24, #31, #34, #35, #36, #38, #40, #48, #51, #52, #54, #55

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
