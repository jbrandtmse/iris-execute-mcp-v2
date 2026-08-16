# Story 34.7: Publish Blockers — Surrogate-Safe Truncation, Shared Response Budget, Build-Freshness Gate

Status: ready-for-dev

<!-- Created 2026-08-16. Epic 34 re-opened a fourth time (Rule SC-5) on Project Lead escalation of the three Story 34.6 items that are only free to change BEFORE the first npm publish. -->

## Story

As a **maintainer publishing this suite for the first time**,
I want **truncation to never emit invalid UTF-8, the response as a whole to be bounded by the ceiling it advertises, and packaging to refuse a stale build**,
so that **the first immutable public release is correct on the wire, honest in its documented limits, and cannot ship an empty tarball.**

## Why these three, why now

npm versions are **immutable**. Two of these change a public contract and one prevents an unrecoverable bad artifact — all three are free today and expensive or impossible after the first publish. Everything else in the ledger can ship and be fixed in a patch release.

**AC 34.7.1 is a defect Story 34.6 introduced.** Before the ceiling existed, `output` passed through verbatim and was always valid UTF-8. Fixing it is not polish; it is reverting a regression we created.

## Acceptance Criteria

- **AC 34.7.1** (`34-6-CR-10`) — truncation is surrogate-boundary aware: a cut MUST NOT leave a lone surrogate. `$Extract` currently cuts at a UTF-16 code-unit index with no guard. Verified live: with the cut landing on a high surrogate, the raw HTTP body is **not valid UTF-8** — IRIS emits the lone `D83D` as WTF-8 `ED A0 BD`, Node's lenient decoder substitutes 3 × U+FFFD, and the client-visible string becomes **32,770 characters**, breaking the "capped at 32768 characters" claim outright. A strict decoder (`TextDecoder({fatal:true})`, Go/Rust/Python strict, a validating proxy) errors. Back the cut off to the preceding character boundary.
- **AC 34.7.2** — the pin for AC 34.7.1 MUST validate **on the wire with a strict decoder** (`TextDecoder` with `fatal: true`, or equivalent), **NOT** by round-tripping inside IRIS. The Story 34.6 test was structurally blind precisely because it round-tripped internally (Rules #36/#54): IRIS accepted its own WTF-8 happily, so the test could never see the defect.
- **AC 34.7.3** (`34-6-CR2-6`) — ONE shared response budget replaces the three independent per-field ceilings. **Lead decision, recorded so it is not re-litigated:** spend the budget in field order **`returnValue` → `byRefValues` → `output`**. Rationale: the small, high-value fields are never starved, and narration — usually the field that actually blows the budget — absorbs the truncation. The three flags (`truncated` / `returnValueTruncated` / `byRefTruncated`) are **RETAINED** per the Story 34.6 review's explicit verdict; only the budget arithmetic changes.
- **AC 34.7.4** (`34-6-CR2-6`) — the documented claim must be **accurate and testable**: state plainly what the ceiling bounds (raw characters) and what JSON escaping can do to the serialized body. Pin it with an **escape-heavy fixture** (quotes, backslashes, tabs, control characters). Live measurement showed two 32768-character escape-heavy fields serializing to **131,102** characters — every escaping-neutral fixture in Story 34.6 (`"H".repeat(...)`-style) was blind to this by construction (Rule #58).
- **AC 34.7.5** (`34-6-CR-11`) — packaging refuses a stale or missing build, failing **CLOSED**. Fix so each publishable package verifies its **OWN** `dist` is present and newer than its `src`, or builds it as part of packing.
- **AC 34.7.6** — Rule #19: under-budget responses stay byte-identical to Story 34.6's behavior wherever the shared budget does not bind. Proven mechanically.
- **AC 34.7.7** — Rule #48 mutation evidence per fix: surrogate guard removed → the strict-decoder pin RED; shared budget reverted to per-field → the worst-case pin RED; a package's `dist` deleted or staled → packaging RED with **zero tarball**.
- **AC 34.7.8** — Gates: `pnpm turbo run build test lint type-check` green; `gen:governance-baseline:check` (`:check` ONLY) exit 0 at frozen `1e62c5ad5bf7`/141/201/60; tool counts unmoved (#31); BOOTSTRAP_VERSION from→to recorded and Constraint C-2 re-verified if a bootstrapped class changes (#24; current `ae812159d829`); changeset updated.

## Tasks / Subtasks

- [ ] **Task 1 — Surrogate-safe truncation** (AC: 34.7.1, 34.7.2)
  - [ ] Guard the cut in `ExecuteMCPv2.Utils.ApplyOutputCeiling` so it never lands between a high and low surrogate; back off to the preceding boundary.
  - [ ] Confirm the resulting body is valid UTF-8 **on the wire** under a strict decoder.
  - [ ] Confirm the client-visible length is genuinely ≤ the ceiling (the defect inflated it to 32,770).
- [ ] **Task 2 — Shared response budget** (AC: 34.7.3, 34.7.6)
  - [ ] Replace the three independent budgets with one, spent `returnValue` → `byRefValues` → `output`.
  - [ ] Keep all three flags; each still reports whether ITS field was truncated.
  - [ ] Prove under-budget responses byte-identical to 34.6.
- [ ] **Task 3 — Honest, testable docs** (AC: 34.7.4)
  - [ ] Escape-heavy fixture; state raw-vs-serialized plainly at every doc site.
- [ ] **Task 4 — Build-freshness gate** (AC: 34.7.5, 34.7.7)
- [ ] **Task 5 — Gates + changeset** (AC: 34.7.8)

## Dev Notes

### The ordering trap in AC 34.7.5 — read before touching the gates

The Story 34.6 review established these mechanically; do not re-derive them:
- **`prepublishOnly` runs BEFORE `prepack`.**
- `scripts/verify-iris-reachable.mjs` imports only `@iris-mcp/shared`'s dist — **never the calling package's own**.
- `packages/iris-dev-mcp/scripts/prepublish-gate.mjs` runs vitest over TypeScript **SOURCE**, not the built output.
- **No** package in the workspace declares a `prepare` or `prepack` script, and every publishable server package declares `files: ["dist"]`.

Net effect today: with a stale or missing `dist`, **both gates pass green and npm packs the tarball without erroring**. Rule #22's "smoke the BUILT dist as a real consumer would" is inverted at the one moment it matters most.

Whatever you add must be per-package and self-referential — a gate that checks *someone else's* dist is the same defect wearing a different hat.

### Why AC 34.7.2's wording is strict

The Story 34.6 surrogate test round-tripped through `%ToJSON`/`%FromJSON` **inside IRIS**, which accepts its own WTF-8 — so the test passed while the wire was invalid. This is a Rule #54 fake-can't-see-reality case and a Rule #36 wrong-oracle case at once. The new pin must decode the **actual HTTP response bytes** with a strict decoder. If a test can pass without ever looking at bytes that left the server, it does not satisfy this AC.

### The budget change is a contract change — make it coherent

Story 34.6 shipped three independent 32768 budgets, so a fully-compliant, fully-flagged `/classmethod` response can carry ~98 KB raw. The documented rationale for 32768 was staying "safely under" the 50,031-character threshold at which a real MCP client diverted output to a file — the worst case exceeds that by ~2.6×, which defeats the number's entire justification.

One shared budget restores the rationale. Field order is a **lead decision** (see AC 34.7.3) — do not invert it: `returnValue` is the method's actual result and is usually small, so giving it first claim costs almost nothing and guarantees it is never starved by narration.

**Rule #38 still applies:** the cap truncates OUTPUT only. The target already did the work. Never advertise it as transport or timeout protection — the CSP gateway was measured clean to 3,000,000 characters, so any such claim would be actively false.

### Scope discipline

- Stories 34.0–34.6 stay `done` and are NOT re-touched beyond what these ACs require (Rule #52).
- No new tool or action (Rule #31) — tool counts and package tool-array length tests must not move.
- Frozen governance baseline untouched (#23/#25) — `:check` only, never the bare generator.
- **Do NOT publish**, do not run `changeset version`, do not bump versions.
- Out of scope: all remaining open MEDIUM/LOW ledger items.

### Constraints

- **Rule #58** — fixture diversity is the reason this story exists twice over: escaping-neutral fixtures hid the budget claim, and an internal round-trip hid the encoding defect. New fixtures must be adversarial by construction (escape-heavy, astral-plane, boundary-landing).
- **Rule #19** — under-budget byte-identical; prove mechanically.
- **Rule #48** — mutation evidence per fix, per AC 34.7.7.
- **Rule #24 + Constraint C-2** — `Utils.cls`/`Command.cls` are bootstrapped: re-run `pnpm run gen:bootstrap`, record BOOTSTRAP_VERSION from→to, and re-verify exactly ONE `ExecuteMCPv2.REST.Command.1.int`.
- **Rule #55** — never generate file content through a shell heredoc; use the file-editing tools.
- **Rule #51** — mechanical tallies only.
- ObjectScript: argumented `Quit` ILLEGAL inside Try/Catch (ERROR #1043); triple `$$$`; no underscores in method/class-parameter names; never touch a `Storage` section; glob-prefixed `iris_doc_load` (Rule #17); Rule #7 I/O discipline on any render path.

### Testing

- `%UnitTest` under `ExecuteMCPv2.Tests.*`; vitest under `packages/**` (default suite — `packages/iris-dev-mcp/vitest.config.ts` excludes `src/**/*.integration.test.ts`). The wire-level strict-decoder pin belongs in the **default** suite.
- Baselines: `ExecuteMCPv2.Tests` 348/348; `@iris-mcp/dev` 649/649 across 38 files; `iris-mcp-all` 112/17; turbo 29/29; epic gate 13/13, 0 skipped.
- **Rule #35** — compare `iris_execute_tests` totals against mechanical `Test*` counts; never trust a zero.
- Live IRIS: 2026.1 Build 235U; `HSCUSTOM` primary, `USER` second.

### References

- [Source: `_bmad-output/implementation-artifacts/deferred-work.md`] — `34-6-CR-10`, `34-6-CR-11`, `34-6-CR2-6` with full live evidence
- [Source: `_bmad-output/planning-artifacts/epics.md#Story 34.7`] — AC text
- [Source: `src/ExecuteMCPv2/Utils.cls`] — `ApplyOutputCeiling`, `BuildByRefNode`, `AddByRefPosition`
- [Source: `scripts/verify-iris-reachable.mjs`, `packages/iris-dev-mcp/scripts/prepublish-gate.mjs`] — the two gates
- [Source: `.claude/rules/project-rules.md`] — #7, #17, #19, #22, #24, #31, #35, #36, #38, #48, #51, #52, #54, #55, #58

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
