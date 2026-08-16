# Story 34.7: Publish Blockers — Surrogate-Safe Truncation, Shared Response Budget, Build-Freshness Gate

Status: done

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

- [x] **Task 1 — Surrogate-safe truncation** (AC: 34.7.1, 34.7.2)
  - [x] Guard the cut in `ExecuteMCPv2.Utils.ApplyOutputCeiling` so it never lands between a high and low surrogate; back off to the preceding boundary.
  - [x] Confirm the resulting body is valid UTF-8 **on the wire** under a strict decoder.
  - [x] Confirm the client-visible length is genuinely ≤ the ceiling (the defect inflated it to 32,770).
- [x] **Task 2 — Shared response budget** (AC: 34.7.3, 34.7.6)
  - [x] Replace the three independent budgets with one, spent `returnValue` → `byRefValues` → `output`.
  - [x] Keep all three flags; each still reports whether ITS field was truncated.
  - [x] Prove under-budget responses byte-identical to 34.6.
- [x] **Task 3 — Honest, testable docs** (AC: 34.7.4)
  - [x] Escape-heavy fixture; state raw-vs-serialized plainly at every doc site.
- [x] **Task 4 — Build-freshness gate** (AC: 34.7.5, 34.7.7)
- [x] **Task 5 — Gates + changeset** (AC: 34.7.8)

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

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- Live wire-level surrogate probe (raw `fetch` + `TextDecoder`): pre-fix reproduced the documented defect exactly — 65,588-byte HTTP response, strict decode threw `The encoded data was not valid for encoding utf-8`, lenient decode inflated to 32,770 client-visible characters. Post-fix: strict decode succeeds, `output.length` = 32,767.
- Live escape-heavy measurement (`TargetReturnEscapeHeavyOverCeiling` via raw `fetch`): raw byte length 98,410 for the whole HTTP response body (a single 32768-raw-character escape-heavy `returnValue` consuming the entire shared budget alone) — cited in `Utils.cls`, `execute.ts`, README, CHANGELOG, and the changeset.
- Mutation evidence (AC 34.7.7), each applied → confirmed RED → restored → confirmed GREEN, with `iris_doc_load` re-upload+recompile (never `iris_doc_compile` alone) after every restore:
  - Surrogate guard: removed `SurrogateSafeCutLength` calls in `ApplyOutputCeiling` → live `/command` wire probe went RED (strict-decode failure, 32,770 chars); restored, GREEN.
  - Shared budget: reverted `tByRefByteBudget` seed and `output`'s `ApplyOutputCeiling` ceiling argument to the old per-field shape → `ClassMethodBudgetTest` 2/3 RED, live leg (e-6) RED (`byRefValues` showed the mutated value instead of being omitted); restored, `ExecuteMCPv2.Tests` 353/353 and `@iris-mcp/dev` 653/653 green.
  - Build-freshness gate: staled `packages/iris-dev-mcp`'s `dist/` (touched `src/index.ts` newer) and separately fully deleted `dist/` → `node scripts/prepublish-gate.mjs` and `pnpm publish --dry-run --no-git-checks` both failed closed with **zero `.tgz` produced** in either case (filesystem-verified); rebuilt (`pnpm turbo run build`), gate passed and a complete, valid 371.4 kB tarball would be produced.
  - Incidental finding during the build-gate mutation test: a stale `tsconfig.tsbuildinfo` (gitignored, untracked) left TypeScript's incremental compiler silently exiting 0 while writing zero `dist/` output for `@iris-mcp/dev` — exactly the "green build, no artifact" class of failure AC 34.7.5 exists to catch. Cleared across all packages; `pnpm turbo run build --force` confirmed a clean rebuild everywhere.
- `iris_doc_load` called once with a bare (non-glob) file path during setup, which (per Rule #17) would have collapsed the class name to `User.*`; confirmed via `iris_doc_get(metadataOnly)` that no stray `User.UtilsTest`/`User.ClassMethodArgsTest` classes were created (upload silently no-op'd rather than landing at the wrong name), then re-ran with the correct glob-prefixed path. No cleanup needed.
- Constraint C-2 re-verified after every `Command.cls` compile via `iris_doc_list(category:"RTN", filter:"ExecuteMCPv2.REST.Command", generated:true)`: exactly one `ExecuteMCPv2.REST.Command.1.int` throughout.
- `pnpm run gen:governance-baseline:check` (never the bare generator): 141 frozen / 201 live / 60 post-foundation new — unchanged from the pre-story baseline; frozen `governance-baseline.json` untouched per `git status`.

### Completion Notes List

- **AC 34.7.1/34.7.2 (surrogate-safe truncation, wire-level pin).** Added `ExecuteMCPv2.Utils.SurrogateSafeCutLength(pStr, pLen)`, a small helper backing a cut length off by one UTF-16 code unit whenever the code unit at that position is a high surrogate (`$Ascii` 55296-56319) — using the same `$Ascii(string, position)` form already proven live by the pre-existing `TestApplyOutputCeilingMidSurrogatePairStaysValidJSON` test. Both retained-length computations inside `ApplyOutputCeiling` (the marker-carrying branch and the marker-less hard-cut fallback) now route through it. The AC 34.7.2 wire-level pin lives in `execute-classmethod-epic-gate.test.ts` leg (e-5): it deliberately bypasses `ctx.http`/`IrisHttpClient` (whose `response.text()` decodes leniently, exactly like the Story 34.6 pin's blind spot) and issues its own raw `fetch` against `/command`, reading `response.arrayBuffer()` and decoding with `new TextDecoder("utf-8", {fatal:true})`. The pre-existing `UtilsTest.TestApplyOutputCeilingMidSurrogatePairStaysValidJSON` (which only ever proved validity through an internal `%ToJSON`/`%FromJSON` round-trip — the Rule #36/#54 blind oracle this AC calls out) was rewritten to pin the NEW guarantee directly (content never ends on a lone high surrogate) rather than merely tolerating the old defect; two new focused unit tests (`TestSurrogateSafeCutLengthCases`, `TestApplyOutputCeilingMarkerlessBandNeverEndsOnHighSurrogate`) pin the helper and the marker-less band deterministically.
- **AC 34.7.3/34.7.6 (shared response budget).** `InvokeWithArgs` gained an additive, optional trailing `Output pOutputBudget As %Integer` parameter (omittable exactly like `pByRefTruncated` before it — all 60+ pre-existing `ClassMethodArgsTest` call sites needed no change, proven by a new dedicated back-compat test). Immediately after a successful dispatch and before byRefValues assembly, it computes how much of the shared 32768-character budget a stringified-and-ceiling-applied copy of `pReturn` would consume (mirroring, never duplicating behavior of, `Command.cls`'s own `$IsObject` OREF-guard + `ApplyOutputCeiling` sequence on the identical value) and seeds `byRefValues`' own byte budget with whatever remains. `Command.cls`'s `ClassMethod()` threads the leftover through to `output`'s own `ApplyOutputCeiling` call. `returnValue`'s own truncation in `Command.cls` is UNCHANGED — always first in priority, it always sees the full ceiling. New `ExecuteMCPv2.Tests.ClassMethodBudgetTest` (a fresh class rather than growing the already ~970-line `ClassMethodArgsTest.cls` further) pins the arithmetic directly. Existing epic-gate legs (e)/(e-3)/(e-4) were updated for the new numbers — each now DERIVES its expected value from the fixture's own known, small return string rather than a re-hard-coded literal — and a new live leg (e-6) proves the full three-way priority order end-to-end (a `returnValue` alone exceeding the whole budget starves both `byRefValues` and `output`). A mocked TS-layer test in `execute.test.ts` that fed an envelope shape the real server can no longer produce (returnValue AND output both at the full 32768 simultaneously) was split into two independently-realistic scenarios (Rule #54).
- **AC 34.7.4 (raw-vs-serialized docs, escape-heavy fixture).** New fixture `TargetReturnEscapeHeavyOverCeiling` (a quote, backslash, tab, and a control character with no short JSON escape, repeated to 40,000 raw characters). Live-measured: the truncated 32768-raw-character result serializes to a **98,410-character** HTTP response body — cited verbatim at every doc site touched (`Utils.cls` class banner + `ApplyOutputCeiling`/`OUTPUTCEILING` banners, `Command.cls` banners, both `execute.ts` tool descriptions, `packages/iris-dev-mcp/README.md`, `CHANGELOG.md`, the changeset). New live leg (e-7) pins the raw-character invariant (exactly 32768, never more) alongside a generous (2x) lower bound on the serialized size, so the leg stays robust to minor envelope-shape drift while still proving the inflation is real.
- **AC 34.7.5/34.7.7 (build-freshness gate).** New `scripts/lib/dist-freshness.mjs` (`checkDistFresh`) is per-package and self-referential by construction — it takes the calling package's own directory as an explicit argument, never derives a path from its own `import.meta.url` (which would always resolve to the shared `scripts/lib/` location regardless of caller). Skips (rather than fails) a package whose own `package.json` declares no `files:["dist"]` (only `@iris-mcp/all`), derived mechanically from the manifest rather than a hand-maintained list (Rule #20). Wired as the FIRST step in both `scripts/verify-iris-reachable.mjs` (7 packages, via `process.cwd()`) and `packages/iris-dev-mcp/scripts/prepublish-gate.mjs` (`@iris-mcp/dev`, via its own pre-existing `packageDir`). Pinned by 8 new default-suite unit tests in `packages/iris-mcp-all` (Rule #45 — the only package depending on all five servers) using isolated temp directories with controlled `utimesSync` mtimes, and mutation-verified live end-to-end via real `pnpm publish --dry-run` producing zero tarballs on a stale/missing dist and a complete tarball once rebuilt.
- **AC 34.7.8 (gates).** `pnpm turbo run build test lint type-check` — 29/29 tasks green (only a pre-existing, unrelated ESLint warning in `packages/shared/src/cli/governance.ts`, untouched by this story). `ExecuteMCPv2.Tests` 353/353 (348 baseline + 5 new: 2 in `UtilsTest`, 3 in the new `ClassMethodBudgetTest`). `@iris-mcp/dev` 653/653 across 38 files (649 baseline + 3 new epic-gate legs + 1 net from splitting one execute.test.ts scenario into two realistic ones). `iris-mcp-all` 120/18 files (112/17 baseline + 8 tests / 1 file for `dist-freshness.test.ts`). Epic gate (`execute-classmethod-epic-gate.test.ts`) 16/16, 0 skipped (13 baseline + 3 new legs). `gen:governance-baseline:check` (never the bare generator): 141 frozen / 201 live / 60 post-foundation new, unchanged. Bootstrapped classes changed (`Utils.cls`, `Command.cls`) → ran `pnpm run gen:bootstrap`: **BOOTSTRAP_VERSION `ae812159d829` → `c8cf90200b39`** at dev time; subsequently re-generated twice as later passes edited `Utils.cls`'s banners — QA's doc-accuracy fix took it to `a5db4ddbdbed`, and the code-review doc-accuracy fix (true worst-case serialized figure) took it to **`06b326631504`**, which is the value that ships. Full Rule #24 chain: `ae812159d829` → `c8cf90200b39` → `a5db4ddbdbed` → `06b326631504`. 29 classes (roster unchanged — no class added/removed, so neither `scripts/gen-bootstrap.mjs` nor `packages/shared/src/__tests__/bootstrap.test.ts`'s rosters needed edits). Constraint C-2 re-verified: exactly one `ExecuteMCPv2.REST.Command.1.int` after every compile. Tool counts unmoved (no new tool/action; confirmed by the unchanged `tool-visibility-snapshot-drift`/`action-default-audit-pin`/`packages.test.ts` results inside the 29/29 turbo run). Changeset (`.changeset/execute-response-ceiling-and-gate-hardening.md`) and `CHANGELOG.md` updated in place (still pre-first-publish, so amended rather than superseded with a second entry) rather than creating a new changeset file. `deferred-work.md` updated: `34-6-CR-10`/`34-6-CR2-6`/`34-6-CR-11` moved to a new "Terminal disposition — Story 34.7" section (all RESOLVED), ledger recount to 0 HIGH / 9 MEDIUM / 58 LOW = 67 open across 132 distinct (65 terminal). **Superseded by later passes** — the QA pass added `34-7-QA-1` (68 open / 133 distinct) and the code-review pass added a further 7 items; `deferred-work.md`'s own final recount is authoritative (Rule #51).
- **Not done / explicitly out of scope:** no `changeset version` run, no version bumps, nothing published, no `git commit`. `.vscode/settings.json`'s `objectscript.conn.active` was already `false` at session start (confirmed) and was never a bulk `iris_doc_export` in this story, so no toggle was needed or performed.

### File List

- `.changeset/execute-response-ceiling-and-gate-hardening.md` — amended in place: corrected the stale "per FIELD, three times the figure" claim to point at the shared-budget section; added three new sections (surrogate fix, shared budget, build-freshness gate).
- `CHANGELOG.md` — three new entries appended to the existing Epic 34 pre-release block (surrogate fix, shared budget + raw-vs-serialized docs, build-freshness gate).
- `_bmad-output/implementation-artifacts/deferred-work.md` — new "Terminal disposition — Story 34.7 escalated publish blockers" section; ledger recount.
- `packages/iris-dev-mcp/README.md` — `iris_execute_command`/`iris_execute_classmethod` sections rewritten for the shared budget and raw-vs-serialized-size distinction; live 98,410-character measurement cited.
- `packages/iris-dev-mcp/scripts/prepublish-gate.mjs` — runs `checkDistFresh` against its own `packageDir` as the first step, failing closed before the epic-done gate.
- `packages/iris-dev-mcp/src/__tests__/execute-classmethod-epic-gate.test.ts` — fixed legs (e)/(e-3)/(e-4) for the shared-budget arithmetic (derived, not re-hard-coded); added legs (e-5) wire-level surrogate pin, (e-6) priority-order capstone, (e-7) escape-heavy serialized-size pin; added a local `BASE_URL` constant for leg (e-5)'s raw fetch.
- `packages/iris-dev-mcp/src/__tests__/execute.test.ts` — split the one mocked over-ceiling test that fed a now-impossible envelope shape (Rule #54) into two independently-realistic shared-budget scenarios.
- `packages/iris-dev-mcp/src/tools/execute.ts` — rewrote both tool descriptions for the shared budget (spent in field order) and the raw-vs-serialized-size distinction.
- `packages/shared/src/bootstrap-classes.ts` — regenerated (`pnpm run gen:bootstrap`); BOOTSTRAP_VERSION `ae812159d829` → `c8cf90200b39` → `a5db4ddbdbed` (QA doc fix) → `06b326631504` (code-review doc fix; the value that ships).
- `scripts/verify-iris-reachable.mjs` — runs `checkDistFresh` against `process.cwd()` as the first step, failing closed before the IRIS-reachability check.
- `scripts/lib/dist-freshness.mjs` — new. `checkDistFresh`, the shared, per-package, self-referential build-freshness check.
- `src/ExecuteMCPv2/REST/Command.cls` — `ClassMethod()`: threads `InvokeWithArgs`' new `pOutputBudget` output into `output`'s `ApplyOutputCeiling` call; updated banners.
- `src/ExecuteMCPv2/Tests/ClassMethodArgsFixture.cls` — new fixtures `TargetReturnHugeWriteAndByRef` (AC 34.7.3 capstone) and `TargetReturnEscapeHeavyOverCeiling` (AC 34.7.4).
- `src/ExecuteMCPv2/Tests/ClassMethodArgsTest.cls` — updated `TestByRefValueBudgetExhaustionOmitsRatherThanDestroys` for the shared-budget arithmetic (derived from the observed `returnValue`, not re-hard-coded); now also asserts `pOutputBudget`.
- `src/ExecuteMCPv2/Tests/ClassMethodBudgetTest.cls` — new. Unit-level pins for the AC 34.7.3 shared-budget arithmetic and its back-compat contract.
- `src/ExecuteMCPv2/Tests/UtilsTest.cls` — rewrote `TestApplyOutputCeilingMidSurrogatePairStaysValidJSON` to pin the new never-mid-pair guarantee; added `TestSurrogateSafeCutLengthCases` and `TestApplyOutputCeilingMarkerlessBandNeverEndsOnHighSurrogate`.
- `src/ExecuteMCPv2/Utils.cls` — `SurrogateSafeCutLength` (new); `ApplyOutputCeiling` surrogate guard; `InvokeWithArgs` shared-budget computation and new `pOutputBudget` output; updated banners throughout.
- `packages/iris-mcp-all/src/__tests__/dist-freshness.test.ts` — new. 8 unit tests for `checkDistFresh` against isolated temp directories.

### Review Findings

Close kind **NORMAL/CLEAN** — all three adversarial layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor) delivered explicit findings payloads inside the 20-minute bounded-close window (Rule #57); `failed_layers` empty, review NOT degraded.

- [x] [Review][Patch] **HIGH — the documented serialized "worst case" (98,410) is wrong by 2x at every public doc site** [`src/ExecuteMCPv2/Utils.cls`, `packages/iris-dev-mcp/src/tools/execute.ts` x2, `packages/iris-dev-mcp/README.md` x2, `CHANGELOG.md`, `.changeset/execute-response-ceiling-and-gate-hardening.md`] — the reviewer's own live measurement on the deployed `/command` endpoint recorded, for the SAME 32768 raw characters: 32,860 (escaping-neutral) / 98,311 (the dev fixture's mixed profile) / **196,495** (all C0 control characters, each a 6-character `\uXXXX` escape) — 6.0x inflation, ~3.9x past the 50,031-character client-divert threshold, versus the "as large as 98,410" published in MCP tool descriptions (an immutable public contract after publish). The RAW ceiling itself was verified correct in all three profiles (exactly 32768). FIXED: every site now carries the full measured range, the true worst case, and the residual-risk statement; the `/command` description's figure is now provenance-correct (measured on `/command`, not transplanted from `/classmethod`).
- [x] [Review][Patch] **MEDIUM — new mocked fixture is a shape the real server cannot emit (Rule #54)** [`packages/iris-dev-mcp/src/__tests__/execute.test.ts`] — `"A".repeat(500) + "\n[IRIS-MCP-TRUNCATED ceiling=500chars]\n"` is **539** characters stamped `ceiling=500`, violating `ApplyOutputCeiling`'s never-exceeds-the-ceiling invariant; and a marker-less byRef hard-cut cannot coexist with a small untruncated `returnValue` under the shared budget. Found independently by all three layers, in the very hunk whose comment cites Rule #54. FIXED: the scenario is now internally consistent and every figure is DERIVED from the shared-budget arithmetic with a length assertion.
- [x] [Review][Patch] **MEDIUM — Rule #24 BOOTSTRAP_VERSION record names a hash present nowhere in the tree** [story file lines 129, 142] — recorded `ae812159d829` → `c8cf90200b39` while the file shipped `a5db4ddbdbed`. FIXED: full four-hop chain now recorded (`ae812159d829` → `c8cf90200b39` → `a5db4ddbdbed` → `06b326631504`, the value that ships).
- [x] [Review][Patch] **MEDIUM — the newly-reachable marker-less `output` band was undocumented** [`packages/iris-dev-mcp/src/tools/execute.ts`, `packages/iris-dev-mcp/README.md`] — because `output` is spent LAST, its ceiling can land in the 1..40 band below the marker's own length, so `output` is emitted as a bare unmarked prefix while both docs promised truncated content is "replaced with a structured, machine-detectable elision marker … never a bare '...'" (a caveat previously scoped only to `byRefValues`). Newly reachable under the shared budget. FIXED: documented at both sites, including that `truncated` is then the only signal.
- [x] [Review][Defer] LOW x9 — `34-7-CR-1` … `34-7-CR-9` recorded in `deferred-work.md` with severity, finding, rationale and suggested resolution: single-step surrogate back-off on malformed UTF-16; `checkDistFresh` exact-`"dist"` skip predicate; its throw-vs-JSDoc mismatch; symlink handling in `newestMtimeMs`; no clock-skew guard; declared entry points unverified; cross-package staleness; leg (e-5) parity dependence; uncharged byRefValues scaffolding/OREF overshoot.

**Dismissed as false positive (1):** a HIGH claim that the final `pOutputBudget` can go negative and re-trigger `ApplyOutputCeiling`'s `-1` "use full ceiling" sentinel, failing the budget OPEN. Verified not reachable: `pByteBudget` is clamped to >= 0 at every mutation site (`Utils.cls` OREF charge, leaf charge, and key charge, which either sets 0 or subtracts a strictly smaller value), and `pOutputBudget` is clamped again after the `returnValue` deduction. Confirmed independently by the Edge Case Hunter's own path walk and by live probe.

**Reviewer's own mutation evidence (Rule #48), all reproduced independently of the dev's report:**
- *Surrogate guard removed* → live `/command` wire probe RED: 65,588-byte response, strict `TextDecoder({fatal:true})` threw `The encoded data was not valid for encoding utf-8`, lenient decode inflated to **32,770** client-visible characters. Restored byte-identically (md5 `71d765b8a5a7b0ae56c0cd1fffe7dc76`), re-uploaded via `iris_doc_load` + recompile → strict decode OK at **32,767** characters, marker intact.
- *Shared budget reverted to per-field* → `ClassMethodBudgetTest` 2/3 RED and epic-gate leg (e-6) RED (`byRefValues` showed `{"0":"byref-value"}` instead of `{}`). Restored, both GREEN.
- *AC 34.7.6 Rule #19 proven mechanically by the reviewer*: five under-budget probes across BOTH endpoints (`/classmethod` zero-args, byRef, write-moderate, twenty-args; `/command` small) produced **byte-identical md5 hashes** on the shared-budget build and on the reverted per-field (= Story 34.6) build.
- *Build gate* — closing the auditor's finding that only 1 of 2 wirings had evidence: mutation-verified the `scripts/verify-iris-reachable.mjs` wiring (which gates 7 packages) on `@iris-mcp/shared` via real `pnpm publish --dry-run --no-git-checks`: stale dist → FAILED CLOSED; **fully deleted dist → exit 1, ZERO tarball**; and the exact target failure — a stale `tsconfig.tsbuildinfo` leaving `tsc` at **exit 0 with zero dist output** → still **exit 1**. Rebuilt → gate passes and a complete tarball is produced.

**Gates re-verified by the reviewer after all fixes:** turbo 29/29; `ExecuteMCPv2.Tests` 353/353 (mechanical `Test*` count 353 — Rule #35 exact); `@iris-mcp/dev` 653/653 across 38 files; `iris-mcp-all` 120/18; epic gate 16/16, 0 skipped; `gen:governance-baseline:check` exit 0 at frozen `1e62c5ad5bf7` / 141 / 201 / 60 with the baseline file untouched; Constraint C-2 exactly one `ExecuteMCPv2.REST.Command.1.int`; `gen:bootstrap` idempotent (md5 unchanged across a re-run); tool counts unmoved; Rule #38 clean (every doc site explicitly DENIES transport/timeout protection).
