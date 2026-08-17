# Story 34.5: TS-Layer `truncated` Reachability + Test-Runner Zero-Result Guard

Status: done

<!-- Created 2026-08-15. Epic 34 re-opened a second time (Rule SC-5) on Project Lead escalation of 34-4-R4 and 34-4-R10. -->

## Story

As an **AI-agent caller of the IRIS MCP tools**,
I want **`truncated` to actually reach me on error responses, and the test runner to refuse to report a zero-result run as success**,
so that **an advertised capability is real at the surface I use, and a test run that executed nothing cannot be mistaken for a clean pass.**

## Acceptance Criteria

- **AC 34.5.1** (`34-4-R4`) — the envelope `result` is preserved on `IrisApiError` in `packages/shared/src/http-client.ts` (or equivalent), and `truncated` is surfaced in the affected tools' **error** responses. Today `http-client.ts` throws `IrisApiError` whenever `status.errors[]` is non-empty, and that type carries only `statusCode`/`errors`/`originalUrl` — the `result` part is dropped, so a REST-layer `truncated` is invisible to every tool caller.
- **AC 34.5.2** (`34-4-R4`) — the README/changeset wording walked back during the Story 34.4 review is **restored to the stronger claim** only once AC 34.5.1 makes it true. Verify the restored text against live behavior, not against intent (Rule #36). If any part remains untrue, the docs must state the accurate narrower reach.
- **AC 34.5.3** (`34-4-R10`) — `iris_execute_tests` gains a zero-result guard on the `class` and `method` branches, mirroring the guard `package` already has: when a run returns no method-level rows, surface an explicit error naming the target and level instead of `total: 0, passed: 0` with no error. A typo'd method name must be distinguishable from a genuine clean run.
- **AC 34.5.4** — all three levels (`package`, `class`, `method`) are pinned by tests: a matching run reports real counts; a non-matching run reports an explicit error. Include the `method`-level case observed live during the 34.4 review (`level: "method"` returning `total: 0` silently).
- **AC 34.5.5** — Rule #19 back-compat: a **successful** run's response shape is unchanged at every level (`total`/`passed`/`failed`/`skipped`/`details`), and `IrisApiError`'s existing consumers keep working — AC 34.5.1 is strictly additive to that type. Proven mechanically, not by prose.
- **AC 34.5.6** — Rule #48: each fix carries mutation evidence (revert → red → restore byte-identically).
- **AC 34.5.7** — Gates: `pnpm turbo run build test lint type-check` green; `pnpm gen:governance-baseline:check` (`:check` ONLY) exit 0 with frozen `1e62c5ad5bf7` / 141 / 201 / 60; tool counts unmoved (Rule #31 — no tool or action is added); changeset added.

## Tasks / Subtasks

- [x] **Task 1 — Preserve the envelope result on `IrisApiError`** (AC: 34.5.1, 34.5.5)
- [x] **Task 2 — Surface `truncated` on the tools' error responses** (AC: 34.5.1)
- [x] **Task 3 — Zero-result guard for `class`/`method` levels** (AC: 34.5.3)
- [x] **Task 4 — Tests across all three levels** (AC: 34.5.4, 34.5.6)
- [x] **Task 5 — Restore docs wording once it is true** (AC: 34.5.2)
- [x] **Task 6 — Gates + changeset** (AC: 34.5.7)

## Dev Notes

### Both defects are already root-caused — do not re-investigate, verify and fix

**`34-4-R4` — `truncated` never reaches the caller.** `packages/shared/src/http-client.ts` throws `IrisApiError` whenever the Atelier envelope's `status.errors[]` is non-empty. `IrisApiError` carries only `statusCode`, `errors`, and `originalUrl` — the envelope's `result` object is discarded at that throw. Story 34.4 correctly put `truncated` **on the REST error envelope** (verified live by `curl` on both `/command` and `/classmethod`), so the server side is done; the value simply never survives the client hop. The 34.4 review confirmed this end-to-end through the real tool and had to walk back README/changeset wording that claimed otherwise.

**`34-4-R10` — the test runner's silent zero-result.** In `packages/iris-dev-mcp/src/tools/execute.ts`:
- `level: "package"` **does** guard this — around L180 it returns an explicit `No test classes found in package '<target>'` when discovery yields nothing.
- `level: "class"` (L187-188) and `level: "method"` (L189-195) have **no equivalent guard**. Method level parses `target.split(":")` into `{class, methods:[method]}` and passes it straight through.
- `total` is derived at L300-324 **solely** from result rows carrying `r.method`; class-level summary rows are deliberately skipped. So zero method rows ⇒ `total: 0, passed: 0, failed: 0` with **no error field** — indistinguishable from a genuine clean run.

Observed live: the Story 34.4 reviewer called `iris_execute_tests` at `level: "method"`, got `total: 0`, and only noticed because Rule #35 mandates comparing the returned `total` against a mechanically-counted expectation. **Rule #35 caught a defect in the tool Rule #35 exists to police.** That is the story's centre of gravity: a runner that reports success for zero executed tests can mask a regression on any story in this repo.

### Why this is worth a story rather than a ledger entry

Both are in **our own verification and error-reporting surface**, and both fail *silently*:
- an advertised capability that is invisible at the only surface callers use;
- a test runner that cannot distinguish "nothing ran" from "everything passed".

Neither is a crash. Both are the "green badge over a dead check" shape that Epic 34's own review history hit three separate times in the epic gate.

### Constraints

- **Rule #19 is the main risk on AC 34.5.1.** `IrisApiError` is shared and thrown from a hot path used by every tool in every package. The change must be **strictly additive** to the type — existing consumers (catch blocks, error-shape assertions, `instanceof` checks) must be untouched. Prove it mechanically across packages, not by inspection of one call site.
- **This is a TS-layer story.** No ObjectScript change is expected. If one proves necessary, `Command.cls`/`Utils.cls` are bootstrapped → Rule #24 BOOTSTRAP_VERSION bump (current `34233b5c9f63`) and Constraint C-2 re-verification (exactly one `ExecuteMCPv2.REST.Command.1.int`) both apply.
- **Rule #31** — no new tool or action; tool counts and package tool-array length tests must not move.
- **Rules #23/#25** — frozen governance baseline untouched; run `gen:governance-baseline:check` only, never the bare generator.
- **Rule #36** — AC 34.5.2's restored docs claim must be verified against live behavior. This exact claim was already wrong once.
- **Rule #58** — for AC 34.5.4, fixture diversity matters: a class that exists with a method that does not, a class that does not exist, a valid method that genuinely passes, and the `ClassName:MethodName` parse edge (missing colon, empty method part).
- Tests must be discoverable by the DEFAULT suite (Rule 8) — vitest under `packages/**`, standard naming, not excluded.

### Testing

- Vitest under `packages/**`. Current baselines: `@iris-mcp/dev` 622 tests / 38 files, 0 skipped; turbo 29/29; `ExecuteMCPv2.Tests` 330/330.
- Live IRIS reachable (2026.1 Build 235U; `HSCUSTOM` primary, `USER` second) — AC 34.5.4's zero-result cases should be confirmed against the real runner, since the defect was invisible to the existing suite.
- **Rule #35 applies to your own verification**: compare any `iris_execute_tests` total against a mechanically-counted expectation. Do not trust a zero.

### References

- [Source: `_bmad-output/implementation-artifacts/deferred-work.md`] — items `34-4-R4` and `34-4-R10` with full reproduction detail
- [Source: `packages/shared/src/http-client.ts`] — the `IrisApiError` throw that drops the envelope `result`
- [Source: `packages/iris-dev-mcp/src/tools/execute.ts#L177-L195`] — the level branches; `#L300-L324` — where `total` is derived
- [Source: `_bmad-output/implementation-artifacts/34-4-response-integrity-gate-durability.md`] — AC 34.4.2's envelope scope and the walked-back docs wording
- [Source: `.claude/rules/project-rules.md`] — #19, #24, #25, #31, #35, #36, #48, #51, #55, #58

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via bmad-dev-story workflow.

### Debug Log References

- Live probe (disposable, deleted after use): built `@iris-mcp/shared` + `@iris-mcp/dev` dist, ran the real `executeTestsTool`/`executeCommandTool` handlers against live IRIS (HSCUSTOM) — confirmed the zero-result guard fires on a nonexistent class, a nonexistent method on a real class (`ExecuteMCPv2.Tests.AdvisorDataTest:NoSuchMethod34_5`), and does NOT fire on genuine matches (13-method class-level run, 1-method method-level run using the Atelier endpoint's stripped-prefix method-name convention discovered during the probe). Also confirmed a real `/command` error (`Set x = 1/0`) now surfaces `structuredContent: {"truncated": false}` alongside `isError: true`.
- Mutation evidence (Rule #48), all three fixes independently: revert → red → restore byte-identical (`diff` confirmed) → green.
  - `errors.ts`'s `this.result = result` removed → 3 tests red (`errors.test.ts` ×1, `http-client.test.ts` ×2) → restored → 52/52 green.
  - `execute.ts`'s `extractTruncated(error.result)` call disabled (forced `undefined`) → 2 tests red → restored → 48/48 green.
  - `execute.ts`'s zero-result guard condition short-circuited (`if (false && ...)`) → 3 tests red → restored → 48/48 green.
- `pnpm turbo run build test lint type-check`: 29/29 successful (one transient run hit a live-IRIS session-expiry race under concurrent package test execution — `@iris-mcp/dev#test` failed; re-ran in isolation (630/630 green) and re-ran the full turbo gate, which passed clean the second time with no code changes in between).
- `pnpm gen:governance-baseline:check`: OK — frozen 141 / live 201 / post-foundation 60, matching the story's stated frozen values.
- Incidental finding (out of scope, not acted on): the live probe revealed the Atelier `/work` unittest endpoint's `methods` filter matches by method name WITH the leading `Test` prefix stripped (e.g. `ExtractTablesSingleTable`, not `TestExtractTablesSingleTable`), even though the underlying OS method and `%Dictionary.MethodDefinition` both carry the `Test` prefix. The tool's own schema description example (`'MyApp.Tests.UtilsTest:TestSomething'`) and the README's `iris_execute_tests` output example (`"method": "TestAdd"`) both use the prefixed form. This is a pre-existing target-matching semantic unrelated to `34-4-R4`/`34-4-R10` and outside this story's ACs (Rule #52) — flagged for the lead/ledger rather than fixed here.

### Completion Notes List

- AC 34.5.1: `IrisApiError` (`packages/shared/src/errors.ts`) gained a 5th, optional, additive `result` constructor parameter. `http-client.ts`'s two envelope-bearing throw sites (HTTP error status; Atelier-level `status.errors[]` on HTTP 200) now pass `envelope?.result`/`envelope.result` through. `iris_execute_command` and `iris_execute_classmethod` (`packages/iris-dev-mcp/src/tools/execute.ts`) extract a boolean `truncated` from `error.result` via a small `extractTruncated()` helper and add `structuredContent: { truncated }` to the error response ONLY when the envelope carried it — omitted entirely (not `undefined`/`false`) otherwise. Verified live end-to-end.
- AC 34.5.2: README wording restored for both tools — the "not currently surfaced" sentence replaced with the accurate, now-true description, cross-referencing the mechanism verified live in this story. The unreleased `execute-classmethod-capture-byref` changeset's walked-back sentence was corrected in place (still pending, not yet published) with a pointer to the new `execute-tests-zero-result-guard` changeset. Also added a short doc note for the new `iris_execute_tests` zero-result guard shape (Rule #43 — new user-facing behavior gets minimal docs at the point of use).
- AC 34.5.3: `iris_execute_tests` gained a zero-result guard on `class`/`method` levels, mirroring the existing `package`-level guard's exact shape (content-only JSON with an `error` field naming the target and level; no `isError`/`structuredContent`, matching the pre-existing convention rather than inventing a new one).
- AC 34.5.4: Pinned all three levels with matching-run and non-matching-run tests. Fixture diversity per Rule #58: class exists/method doesn't (mocked + live), class doesn't exist (mocked + live), a genuinely-passing method (mocked + live), and both `ClassName:MethodName` parse edges (missing colon, trailing empty method part) — pinning the PRE-EXISTING parse behavior (whole-class run when no method filter is derivable) rather than changing it, since that parsing logic is untouched by this story.
- AC 34.5.5: Back-compat proven mechanically — `errors.test.ts` pins that `result` defaults to `undefined` when the 5th argument is omitted, `execute.test.ts` pins that an error response gets no `structuredContent` key at all when the envelope never carried `truncated`, and the full existing suites (dev: 630/630, shared: 1308/1308) pass unmodified except for the one pre-existing test that pinned the OLD (buggy) zero-result behavior, which was rewritten to pin the NEW correct behavior (see Issues Encountered).
- AC 34.5.6: Mutation evidence captured for all three production edits — see Debug Log References.
- AC 34.5.7: `pnpm turbo run build test lint type-check` green (29/29); `pnpm gen:governance-baseline:check` OK at the frozen values; no new tool/action added, so tool-array-length and preset-coverage tests (which run inside the turbo gate) were unaffected; changeset `execute-tests-zero-result-guard.md` added, plus a correction to the pending `execute-classmethod-capture-byref.md`.

### File List

- packages/shared/src/errors.ts
- packages/shared/src/http-client.ts
- packages/shared/src/__tests__/errors.test.ts
- packages/shared/src/__tests__/http-client.test.ts
- packages/iris-dev-mcp/src/tools/execute.ts
- packages/iris-dev-mcp/src/__tests__/execute.test.ts
- packages/iris-dev-mcp/README.md
- .changeset/execute-tests-zero-result-guard.md (new)
- .changeset/execute-classmethod-capture-byref.md (wording correction)
- _bmad-output/implementation-artifacts/deferred-work.md (terminal disposition for `34-4-R4`/`34-4-R10`)

## Change Log

- 2026-08-15: Story implemented — `IrisApiError.result` additive passthrough, `truncated` surfaced on `iris_execute_command`/`iris_execute_classmethod` error responses, `iris_execute_tests` zero-result guard added for `class`/`method` levels, README/changeset wording restored, deferred-work ledger closed out `34-4-R4`/`34-4-R10` as RESOLVED. All fixes verified live against HSCUSTOM and mutation-tested (revert → red → restore byte-identical).
- 2026-08-15: QA follow-up fix (same-story, Priority 1) — closed the root cause behind `34-4-R10`, one layer deeper than the dev's zero-result guard. See QA Results below.

### QA Results (2026-08-15, bmad-qa-generate-e2e-tests)

**Priority 1 — root cause fixed, not deferred.** The dev's Debug Log flagged (as out-of-scope/incidental) that the Atelier `/work` unittest endpoint's `methods` filter and result rows use the `Test`-prefix STRIPPED form, even though the OS method, this tool's schema, and the README all use the prefixed form. QA verified this live (`ExecuteMCPv2.Tests.AdvisorDataTest`, HSCUSTOM 2026.1 Build 235U) across 4 methods and confirmed it is the root cause of `34-4-R10`: the dev's own "genuine 1-method method-level run" live check had used the *unprefixed* workaround form, so the documented, prefixed form was never actually exercised end-to-end. Left unfixed, AC 34.5.3's new guard would have turned a silent `total:0` into a misleading "No tests found" for a genuinely correct, documented call — the same defect class the story exists to close. Fixed in `packages/iris-dev-mcp/src/tools/execute.ts`: added `toAtelierMethodFilter`/`fromAtelierMethodName` to strip the prefix on the outgoing `methods` filter and restore it on every result row (all three levels, since the endpoint strips it everywhere, not just the filtered case). Live evidence (probe script, built dist, deleted after use):
- `ExecuteMCPv2.Tests.AdvisorDataTest:TestExtractTablesSingleTable` (documented form): before fix `total:0`; after fix `total:1, passed:1`, `details[0].method:"TestExtractTablesSingleTable"`.
- Class-level run: 13/13 result rows now carry the restored `Test`-prefixed method name (previously all 13 were silently stripped in the tool's own output, contradicting its own README example).
- Guard still correctly fires on a genuine typo'd method and a nonexistent class.
- Mutation-verified: both helpers no-op'd → 5 tests red (`execute.test.ts`) → restored byte-identically (`diff` confirmed) → 50/50 green.
- 3 new tests added; all pre-existing raw-Atelier-response mock fixtures in `execute.test.ts` corrected from the unrealistic `Test`-prefixed shape to the real stripped shape (Rule #54). README updated with a short usage note.

**Priority 2 — independent verification, not taken on the dev's word:**
- `IrisApiError`'s 5th param: mechanically confirmed only 2 production files construct it (`atelier.ts` 4-arg, `http-client.ts` — both updated call sites now 5-arg) and 54 production files reference the type (catch/`instanceof`/property reads only — none construct it) — full monorepo `pnpm turbo run build test lint type-check` is 29/29 green, which would fail on any positional-arg regression.
- `truncated` reachability on the error path re-verified live independently, AND the story's own open question ("confirm the true case is reachable, or record why not") was resolved: forcing a ~4M-character `Write` capture overflow followed by a `Set x=1/0` through the freshly built dist returned `structuredContent:{"truncated":true}, isError:true` — the TRUE case is reachable, not just the FALSE case the dev had confirmed.
- AC 34.5.2 README wording re-verified against the same live evidence; accurate as written, no further narrowing needed.

**Priority 3:**
- Rule #58 fixture diversity already adequate (class exists/method doesn't, class doesn't exist, genuine pass, parse edges — mocked and/or live); no gaps found beyond the Priority 1 fix, which added its own diversity (prefixed/unprefixed input, class-level restoration).
- Rule #48: own mutation evidence captured above for the QA-authored fix.
- Rule #35: mechanical count of `Method Test*` in `AdvisorDataTest.cls` = 13 (grep); live `iris_execute_tests` class-level run reported `total:13` — matches.
- Rule #31: no tool/action added; only `execute.ts` changed among tool source files; full turbo gate (including `@iris-mcp/all` tool-array/preset-coverage tests) green.
- Rules #23/#25: `pnpm gen:governance-baseline:check` (`:check` only) OK — frozen `1e62c5ad5bf7` / 141 / 201 / 60, unchanged.
- Full gate: `pnpm turbo run build test lint type-check` 29/29; `@iris-mcp/dev` 632 tests / 38 files green (live IRIS); `@iris-mcp/all` 112/17 green.
- `deferred-work.md`'s `34-4-R10` RESOLVED entry annotated with the QA follow-up fix and its live/mutation evidence.

### Review Findings (2026-08-15, bmad-code-review)

**Close: NORMAL (not degraded).** All three adversarial layers (Blind Hunter, Edge Case
Hunter, Acceptance Auditor) DELIVERED explicit findings payloads inside the 20-minute
per-layer hard timeout measured against a real armed clock; `failed_layers` empty
(Rule #57 bounded close). Frozen-diff snapshot taken at review start and disposed at
close (Rule #57 FROZEN-DIFF).

**Independent live re-verification (Rule #36 — the review did not take the dev's or QA's
word for any claim).** Captured directly from the Atelier `/work` unittest endpoint on
HSCUSTOM (2026.1 Build 235U) via `curl`, independently of the tool:
- The endpoint's `methods` filter and every result row use the `Test`-prefix STRIPPED
  form — the prefixed form `TestExtractTablesSingleTable` drains ZERO method rows, the
  stripped form drains 1 passing row. QA's root-cause finding is confirmed, and the
  corrected mock fixtures in `execute.test.ts` match the real wire shape (Rule #54). The
  Acceptance Auditor independently corroborated from the IRIS library source:
  `%Api.Atelier.v8.cls` builds the filter as `…":Test"_tTestMethod` and emits
  `"method": ($EXTRACT(tMethod,5,*))`, making the two helpers exact inverses of the real
  contract.
- A class-level run returns 13/13 stripped rows, matching the mechanical count of
  `Method Test*` in `AdvisorDataTest.cls` = 13 (Rule #35).
- `truncated` is a genuine JSON boolean on the live error envelope
  (`"result":{"truncated":false}`), so `extractTruncated`'s strict-boolean gate matches
  the real wire shape.
- End-to-end through the freshly built dist: the error path returns
  `structuredContent:{"truncated":false}` with `isError:true` (AC 34.5.2's restored
  README claim verified against behavior, not intent), the documented prefixed
  method-level target returns `total:1, passed:1` with `details[0].method` restored, and
  a typo'd method and a nonexistent class both trip the guard.

**Fixed during review (2 defects, both live-confirmed):**

1. **HIGH — the new zero-result guard misreported a run-level FAILURE as a bad target
   name.** The Atelier runner reports a failure that stopped any method from executing
   via a CLASS-LEVEL row (no `method` key, `status: 0`, populated `error`). The result
   loop drops every row without a `method`, so `total` was 0 and the guard answered
   `"No tests found for '<class>' at level 'class'"` — telling the caller their class
   name was wrong when the class was found, ran, and failed in setup, while the runner
   had handed the tool the exact reason. Confirmed live with a disposable
   `%UnitTest.TestCase` subclass whose `OnBeforeAllTests` returns an error (created,
   captured, deleted and deletion verified during the review): the endpoint drained
   `{class, status:0, failures:[], error:"OnBeforeAllTests: ERROR #5001: …"}` and the
   tool answered "No tests found". This is the story's own defect class — a verification
   surface that lies — reintroduced by the fix for it. Class-level diagnostics are now
   captured and surfaced in the `error` field; a passing class-level summary row with
   zero methods still yields the plain not-found wording.
2. **MEDIUM (AC 34.5.4) — `package` level still returned a silent `total: 0`.** The
   guard was `level !== "package" && total === 0`; the package guard fires only at
   DISCOVERY time (zero classes matched the SQL). A package whose classes ARE discovered
   but whose run drains zero method rows kept the original `34-4-R10` shape —
   `{"total":0,"passed":0,"failed":0,"skipped":0,"details":[]}` with no error field —
   at the one level AC 34.5.4 claims to pin. Confirmed live over a package of two real
   `%UnitTest.TestCase` subclasses. The guard now applies at all three levels; the
   pre-existing discovery-time message is unchanged and pinned by a back-compat test.

**Docs corrected (AC 34.5.2, Rule #36/#54):** the README's and changeset's stated
omission example named "a connection error", a state the `IrisApiError` branch can never
produce (a connection failure raises `IrisConnectionError` and propagates, yielding no
tool error response at all — verified live). Reworded to the states that branch actually
reaches. The changeset now also discloses the `details[].method` value change on upgrade
(previously stripped, now the real prefixed name) and the two guard improvements above.
`sprint-status.yaml`'s dev-stage note claiming the `Test`-prefix finding was "NOT acted
on … not fixed here" was corrected — the same diff fixes it (Rule #55 doc-rot).
`deferred-work.md`'s hand-authored "(51 files)" tally was replaced with the mechanically
recounted figures (Rule #51): 2 source files construct `IrisApiError`, 52 further
reference it, 54 referencing files total.

**Tests added (6):** class-level setup-failure diagnostic surfaced (fixture is a verbatim
live capture); class-level `status: 0` with no error text; passing class-level summary row
still reads as not-found; package-level drain-zero guard; package-level drain-zero
surfacing a class diagnostic; back-compat for the package discovery-time message.

**Mutation evidence, the reviewer's own (Rule #48).** Three independent
revert → red → restore-byte-identically (`md5sum -c` confirmed each time) → green cycles:
- Both normalization helpers no-op'd (verifying QA's fix, not taking QA's word): **5 tests
  red**, restored → 632 green.
- Class-level diagnostic capture disabled (`else if (false)`): **3 tests red**, restored → green.
- `level !== "package"` re-added to the guard: **2 tests red**, restored → green.

**Triage:** 2 patched (1 HIGH, 1 MEDIUM) + 5 doc/ledger corrections; 5 deferred as
`34-5-R1`..`34-5-R5` in `deferred-work.md`; 8 dismissed after verification — chiefly a
speculative non-boolean `truncated` (the live wire value is a real JSON boolean), a
proposed idempotence guard on `fromAtelierMethodName` (which would be actively WRONG for a
method named `TestTestFoo`, since the endpoint strips exactly 4 characters
unconditionally — Rule #54 cuts against the defensive branch), a claimed poll-timeout
misreport (the timeout returns its own `isError` response before the guard), and a claim
that the guard's hard-coded zeros could diverge (`passed`/`failed`/`skipped` are only
incremented alongside `total`, so they are provably 0 when `total` is 0).

**Gates re-run at review close:** `pnpm gen:governance-baseline:check` (`:check` only)
exit 0 — frozen `1e62c5ad5bf7` / 141 / 201 / 60, baseline file unmodified;
`pnpm turbo run build test lint type-check` 29/29; `@iris-mcp/dev` 638 tests / 38 files;
no tool or action added, so tool counts and package tool-array length tests are unmoved
(Rule #31); Rule #15 grep (`\$Get\([a-zA-Z_]+\.`) clean. All live probe artifacts
(2 disposable classes) deleted and deletion verified (404 + empty dictionary query).

#### Findings ledger

- [x] [Review][Patch] Zero-result guard misreports a run-level FAILURE as a bad target name — class-level diagnostic rows are discarded, so an `OnBeforeAllTests` error is answered with "No tests found" [packages/iris-dev-mcp/src/tools/execute.ts:403] — HIGH, fixed
- [x] [Review][Patch] `package` level still returns a silent `total: 0` when classes are discovered but the run drains zero method rows (AC 34.5.4) [packages/iris-dev-mcp/src/tools/execute.ts:403] — MEDIUM, fixed
- [x] [Review][Patch] README/changeset name "a connection error" as the `structuredContent`-omitted example, a state the `IrisApiError` branch cannot produce [packages/iris-dev-mcp/README.md] — LOW, fixed
- [x] [Review][Patch] Changeset did not disclose the `details[].method` value change on upgrade (stripped → real prefixed name) at all three levels [.changeset/execute-tests-zero-result-guard.md] — LOW, fixed
- [x] [Review][Patch] `sprint-status.yaml` dev-stage note claims the `Test`-prefix finding was "NOT acted on … not fixed here" while the same diff fixes it [_bmad-output/implementation-artifacts/sprint-status.yaml:2] — LOW, fixed
- [x] [Review][Patch] Hand-authored "(51 files)" `IrisApiError` tally contradicts the story's "54" (Rule #51) [_bmad-output/implementation-artifacts/deferred-work.md] — LOW, fixed by mechanical recount
- [x] [Review][Defer] Guard is invisible to `isError`/`structuredContent` consumers — `34-5-R1` [packages/iris-dev-mcp/src/tools/execute.ts:403] — deferred, AC-conformant by design, needs a lead product decision
- [x] [Review][Defer] `target.split(":")` drops extra segments and does not trim whitespace — `34-5-R2` [packages/iris-dev-mcp/src/tools/execute.ts:257] — deferred, pre-existing
- [x] [Review][Defer] A method named exactly `Test` is unrunnable and misreported — `34-5-R3` [packages/iris-dev-mcp/src/tools/execute.ts:156] — deferred, pre-existing truthiness check
- [x] [Review][Defer] Prefix aliasing is many-to-one; drained rows are never matched against the requested method — `34-5-R4` [packages/iris-dev-mcp/src/tools/execute.ts:259] — deferred, inherent to the endpoint contract
- [x] [Review][Defer] `cycle-log-epic-34.md` `dev_complete` records `tests_added=18` (a final-diff figure) — `34-5-R5` — deferred, lead-owned artifact
