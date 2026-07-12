# Story 29.3: Deferred-Work Ledger Burn-Down

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the **project's quality steward**,
I want **every carried deferred-work item driven to a TERMINAL disposition (resolved / closed-with-evidence / closed-by-decision)**,
so that **Rule #37's ≥3-consecutive-re-defer threshold (tripped at Epic 29 for the Epic-26-own batch) is honored and the ledger carries ZERO open items into Epic 30 — no silent accumulation.**

## Acceptance Criteria

(Binding: Epic 28 retro §6 / Action #2. Rule #37: re-deferral is NOT an allowed outcome for any carried item. Rule #48: a "resolved" code fix carries a HIGHER bar — LIVE-proven or mutation-verified; a green suite is not evidence.)

- **AC 29.3.1 — Terminal disposition for EVERY carried item.** Each of the ~41 carried items (inventory below) receives exactly one terminal disposition — **resolved** (code/doc fix applied), **closed-with-evidence** (verified no-repro / already-fixed / not-live-reachable, evidence cited), or **closed-by-decision** (by-design / accepted-limitation / spec-faithful / ambiguous-design-call / disproportionate-risk, rationale cited). A disposition table (Item | File | Disposition | Rationale/Evidence) is appended to `deferred-work.md` under a "## Story 29.3 — DEFERRED-WORK LEDGER BURN-DOWN" heading, mirroring the Story 22.1 / 26.4 precedent. **Zero re-deferrals.**
- **AC 29.3.2 — Resolved fixes meet Rule #48.** Any item dispositioned **resolved** via a code fix is proven LIVE on the real surface OR mutation-verified (revert → red test → restore), with a regression test pinned from real behavior. Cite the proof per resolved item.
- **AC 29.3.3 — Additive / no-bootstrap-bump (Rule #19).** The burn-down is **TS + docs only**. No `src/ExecuteMCPv2/**` (ObjectScript) change, so `BOOTSTRAP_VERSION` stays unchanged and `gen:bootstrap` is not re-run. Frozen governance baseline `1e62c5ad5bf7` (141 keys) UNCHANGED (`pnpm gen:governance-baseline:check` exit 0); no new tool/governance key. Every existing tool's default-enabled output is byte-for-byte unchanged (only additive robustness guards on shouldn't-happen/edge paths + doc corrections). Where a resolved robustness guard changes an edge-path envelope (e.g. a shouldn't-happen malformed body now yields a clean `isError` instead of an uncaught throw), that is a strict improvement, covered by a regression test, and never alters the success path.
- **AC 29.3.4 — Ledger cleared + Rule #49/#50 lens.** After this story, `deferred-work.md` shows ZERO open carried Epic-26/27/28/29-own items (all disposed). For any resolved item touching comparison/diff/key logic (the env-diff/env-promote items), apply the Rule #49 (oracle) / #50 (item-identity key) lenses. Full monorepo suite green (`pnpm turbo run test`).

## Disposition policy (the burn-down's decision framework)

Apply per item; the code review will audit that each is genuinely terminal (Rule #37) and each resolved fix meets Rule #48.

- **OS-class items → CLOSED-BY-DECISION (no bootstrap bump).** Every carried item whose fix would touch a bootstrapped, live-deployed ObjectScript class (`MessageResend.cls`, `Compressor.cls`, `SqlAdvisor.cls`, `EnvSync.cls`) is LOW/MED, **graceful-today, fails-safe, and NOT an active shipping defect** (each is a version-dependent forward hazard, a defense-in-depth gap on a shouldn't-happen path, or a diagnostic-only thinness). A `BOOTSTRAP_VERSION` bump + redeploy + `%UnitTest` rerun for such a non-defect carries MORE regression risk than the item it fixes — so the terminal disposition is **closed-by-decision** with the accepted-limitation rationale recorded in the table. (If, on live probe per Rule #16, any OS item turns out to be an ACTIVE correctness bug on the pinned IRIS 2026.1 — not a forward hazard — escalate to the lead before disposing; none is expected to be.)
- **TS/docs low-risk, high-value items → RESOLVE** (Rule #48 proof + regression test). Additive robustness guards on edge/shouldn't-happen paths and doc corrections that never change a success path.
- **By-design / spec-faithful / ambiguous-design-call items → CLOSED-BY-DECISION**, recording the rationale; where the original finding requested an in-code doc note, ADD that note (a resolve of the doc-note sub-part is fine and cheap).
- **Needs-live-capture / needs-running-production coverage items → CLOSED-BY-DECISION** (documented accepted coverage gap) OR **closed-with-evidence** if a cheap live read/probe confirms no-repro.

## Carried-item inventory (41 items)

**Epic-26-own (10 LOW):** CR 26.1-1 (dryRun coercion, `MessageResend.cls`), 26.1-2 (bare-date `to`, OS), 26.1-3 (JSON-object headerIds, OS), 26.1-4 (filtered-execute composition untested, OS/coverage), 26.1-5 (non-integer maxMessages, OS), 26.1-6 (swallowed fetch-failure, OS), 26.2-1 (`message-resend.ts` unguarded `summary`/`dryRun`, **TS**), 26.4-1 (Compressor guard also gates arrow, OS), 26.4-2 (missing in-code doc note at `health.ts` evaluate, **TS doc**), 26.4-3 (gen-skills `--check` flags any non-generated file, `gen-skills.mjs`, by-design).

**Epic-27-own (18 LOW):** CR 27.0-1 (wide-spec gate partial, OS+docs ambiguous), 27.0-2 (`resolveProfileClient` errors escape envelope, **TS** env-diff.ts), 27.0-4 (single unreadable doc aborts diff, OS), 27.0-5 (explicit `namespace:""` bypass, **TS** env-diff.ts schema), 27.0-6 (SwitchNamespace error text truncated, OS diagnostic), 27.1-4 (unguarded `response.result` in fetchers, **TS**), 27.1-5 (defaultSettings compares only `value`, **TS** spec-faithful), 27.1-7 (mapping row missing `database` type-lie, **TS**), 27.1-8 (`Promise.all` mixed-rejection, **TS** rare), 27.1-9 (raw-args `domains:[]` vacuous, **TS**), 27.1-10 (config `onlyInTarget` annotation missing, **TS** cosmetic), 27.1-11 (domains sequential not concurrent, **TS** by-design), 27.1-12 (within-mappings partial failure discards, **TS** rare), 27.3-1 (documents batch under-reports `skipped`, **TS** conservative-by-design), 27.3-2 (`updateMapping` delete+create non-atomic, **TS** inherent-to-IRIS), 27.3-3 (webapps "create" label vs `modify` op, **TS** spec-faithful — lead scope call), 27.3-4 (empty namespace misattributing error, **TS**), 27.4-1 (`docs/migration-v1-v2.md` "100 tools" stale → 104, **docs**).

**Epic-28-own (12; 2 MED):** CR 28.0-1 (parsePlanIndexes conflates temp-file tokens, **TS** sqlAnalyze.ts), 28.0-2 (subquery not separately captured, coverage/live-capture), 28.1-1 (**MED** ResolveClassForTable bare-catch, OS SqlAdvisor.cls), 28.1-2 (ExtractTables zero tables for bitmap, OS), 28.1-3 (ExtractTables mis-splits quoted tokens, OS), 28.1-4 (whitespace namespace switch, OS), 28.2-1 (**MED** multi-table JOIN attribution, **TS** sqlAdvisor.ts), 28.2-2 (missing-index confidence plan-order-dependent, **TS**), 28.2-3 (INFORMATION_SCHEMA branch untested, coverage), 28.2-4 (FULL_SCAN_RE under-detects composite idkey, **TS** false-negative), 28.3-1 (query-mode malformed test mislabeled, **TS** test+docs), 28.3-2 (workload total-outage benign no-findings, **TS** sqlAnalyze.ts).

**Epic-29-own (1 LOW):** CR 29.1-1 (`deriveAuditAction` reads pre-Zod `rawArgs.action` vs `computeGovernanceKey`'s post-Zod `validatedArgs.action`; a future `action:z.enum().default()` tool called with `action` omitted would log `null` while governance keys on the default — no shipped tool triggers it, **TS** server-base.ts).

## Tasks / Subtasks

- [x] **Task 1 — Read + probe (Rule #16/#48).** Read every carried-item section in `deferred-work.md` (lines ~892-1139 for the source text). For each, open the cited file and confirm the item still exists with the claimed shape at the claimed location (line numbers may have drifted). Classify per the Disposition policy above.
- [x] **Task 2 — Resolve the TS/docs fixes (AC 29.3.2).** Apply the low-risk, high-value TS + docs fixes. For each: additive/edge-path only (never change a success path); a regression test pinned from real behavior; mutation-verify (revert → red → restore) or live-prove. Strong resolve candidates: 26.2-1, 26.4-2 (doc note), 27.0-2, 27.0-5, 27.1-4, 27.1-7, 27.1-9, 27.1-10, 27.3-4, 27.4-1 (docs count), 28.0-1, 28.2-2, 28.2-4, 28.3-1 (test+doc), 28.3-2, 29.1-1. (Use judgment — resolve where the fix is clearly safe+additive; close-by-decision the spec-faithful/by-design ones: 27.1-5, 27.1-8, 27.1-11, 27.1-12, 27.3-1, 27.3-2, 27.3-3, 26.4-3.) For 27.3-3 (webapps create-vs-modify label) and 27.0-1/27.0-5 (ambiguous design calls) — if the resolution is genuinely ambiguous per the finding, close-by-decision with the recorded rationale rather than guessing; do NOT silently pick a contested behavior.
- [x] **Task 3 — Close-by-decision the OS-class + by-design items (AC 29.3.1).** Record each with its accepted-limitation/by-design/version-dependent rationale. No `src/ExecuteMCPv2/**` change; no bootstrap bump.
- [x] **Task 4 — Disposition table + ledger clear (AC 29.3.1, 29.3.4).** Append the full disposition table to `deferred-work.md` under "## Story 29.3 — DEFERRED-WORK LEDGER BURN-DOWN" with a tally (resolved / closed-with-evidence / closed-by-decision / re-deferred=0). Ensure NO carried item remains open.
- [x] **Task 5 — Regression + back-compat (AC 29.3.3, 29.3.4).** `pnpm turbo run test` green; `pnpm gen:governance-baseline:check` exit 0; frozen baseline `1e62c5ad5bf7` + `BOOTSTRAP_VERSION` unchanged (verify via `git diff` on `governance-baseline.ts` + `bootstrap-classes.ts` — both clean).

## Dev Notes

**This is a BURN-DOWN, not a feature.** The deliverable is the terminal-disposition TABLE in `deferred-work.md` + the subset of resolved code/doc fixes. Model it on the existing Story 22.1 (line ~624) and Story 26.4 (line ~918) burn-downs in `deferred-work.md` — same structure, same "resolved / closed-with-evidence / closed-by-decision" vocabulary, same tally.

**Rule #48 is the bar for "resolved".** A green suite is NOT evidence (Epic 26's burn-down "fix" was itself defective and only a live HTTP smoke caught it). For each resolved code fix: mutation-verify (revert the fix → the new regression test must go RED → restore) OR prove live. Record which per item.

**Why OS items are closed-by-decision (the load-bearing rationale).** Every OS-class carried item is LOW/MED, graceful-today, fails-safe, and version-dependent or defense-in-depth — none is an active shipping defect on the pinned IRIS 2026.1 (the deferrals say so explicitly, and several were live-verified working at their original review). A `BOOTSTRAP_VERSION` bump + redeploy + `%UnitTest` rerun to fix a non-defect LOW/MED item injects more regression risk than it removes, and Epic 29 is a TS-only epic with no OS-deploy in its pipeline. Closed-by-decision with recorded rationale is the correct terminal disposition (Rule #37 explicitly permits it). **Probe first anyway (Rule #16):** open each OS file and confirm the item is indeed graceful/fails-safe as claimed before closing it — if any is an ACTIVE bug, STOP and surface to the lead (do not silently close a real defect, and do not bump the bootstrap without lead sign-off).

**Do NOT re-open Epic 29 feature scope.** 29.0/29.1/29.2 are done. CR 29.1-1 is the only Epic-29-own item; resolve it if the fix is safe+additive (make `deriveAuditAction` read the same post-Zod args shape as `computeGovernanceKey`, or document the pre-Zod read as intentional with a test pinning current behavior) — else close-by-decision.

**Files likely touched (TS + docs only):** `packages/iris-dev-mcp/src/tools/message-resend.ts`, `packages/iris-dev-mcp/src/tools/env-diff.ts`, `packages/iris-dev-mcp/src/tools/env-promote.ts`, `packages/iris-dev-mcp/src/tools/sqlAdvisor.ts`, `packages/iris-dev-mcp/src/tools/sqlAnalyze.ts`, `packages/iris-ops-mcp/src/tools/health.ts` (one-line doc note), `packages/shared/src/server-base.ts` (CR 29.1-1), `docs/migration-v1-v2.md`, plus co-located `*.test.ts` regression tests and `deferred-work.md`. NO `src/ExecuteMCPv2/**`.

### Project Structure Notes

- Tests are `*.test.ts` (discoverable), co-located under each package's `src/__tests__/` or `src/tools/__tests__/` per existing convention.
- `deferred-work.md` is the ledger — the disposition table is the primary artifact. Preserve all prior sections; append the new burn-down section.
- Rule #19 gate is a RELEASE gate: `git diff` on `packages/shared/src/governance-baseline.ts` and any `bootstrap-classes.ts` must be EMPTY at the end.

### References

- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — all carried-item source text (§ lines ~892-1139) + the Story 22.1 (~624) and 26.4 (~918) burn-down precedents to mirror
- [Source: .claude/rules/project-rules.md #37] — burn-down mandatory at ≥3 re-deferrals; terminal disposition; re-deferral not allowed
- [Source: .claude/rules/project-rules.md #48] — "resolved" code fix needs LIVE/mutation proof; green suite is not evidence
- [Source: .claude/rules/project-rules.md #16] — probe-first (verify the claim live) before disposing
- [Source: .claude/rules/project-rules.md #19] — additive back-compat; frozen baseline + BOOTSTRAP_VERSION unchanged
- [Source: .claude/rules/project-rules.md #49/#50] — oracle + item-identity-key lenses for the env-diff/env-promote comparison items
- [Source: _bmad-output/implementation-artifacts/epic-28-retro-2026-07-11.md §6, Action #2] — the binding directive scheduling this burn-down at Epic 29

## Review Findings (Story 29.3 code review, 2026-07-12)

Adversarial burn-down audit (Rule #37 terminal-disposition audit + Rule #48 resolved-fix mutation sampling + Rule #19 release-gate + OS closed-by-decision soundness). Outcome: **0 HIGH · 0 MEDIUM · 2 patches applied inline · 0 deferred · 0 dismissed.**

- [x] [Review][Patch] Disposition tally arithmetic wrong — table said "20 resolved · 4 CWE · 17 CBD" but a mechanical recount of the 41-row disposition column is **14 resolved · 4 closed-with-evidence · 23 closed-by-decision**. Fixed the tally line in `deferred-work.md` and the matching story Completion Note; also corrected a "Three items"→"Two items" narrative typo. [_bmad-output/implementation-artifacts/deferred-work.md:1199]
- [x] [Review][Patch] `actionFieldHasDefault` JSDoc referenced a non-existent "registration-time assertion (McpServerBase.registerTool)" — the actual enforcement mechanism is the cross-package pin test in `iris-mcp-all`. Corrected the JSDoc to describe the real mechanism (comment-only; TSC clean). [packages/shared/src/governance.ts:159]

**Audit results (all PASS):**
- **Rule #37:** all 41 carried items present (numbered 1-41, no gaps/dupes), each with exactly ONE terminal disposition, ZERO re-deferrals. Two "recommend a future smoke" notes (CR 26.1-4, CR 28.2-1) are advisory riders on genuinely-terminal accepted-limitation/disproportionate-risk dispositions, not disguised re-deferrals.
- **Rule #48:** mutation-verified 4 resolved fixes NOT covered by QA — CR 27.1-7 (env-diff mapping normalization), CR 27.3-4 (env-promote blank-ns refuse), CR 28.3-2 (sqlAnalyze all-error isError), CR 28.2-4 (sqlAdvisor FULL_SCAN_RE) — each went RED on revert for the exact expected reason, restored from backup (not `git checkout`). Combined with QA's 4/4, 8/8 sampled resolved fixes are genuine.
- **Rule #19:** zero `src/ExecuteMCPv2/**` changes; `git diff` empty on `governance-baseline.ts` + every `bootstrap-classes.ts`; `BOOTSTRAP_VERSION` (6422caf6ec31) unchanged; `gen:governance-baseline:check` exit 0 (141 frozen keys intact). The `governance.ts` CR 29.1-1 change is a purely-additive exported helper consumed ONLY by tests — not wired into `registerTool`, so no runtime/governance behavior change.
- **Success-path preservation:** the env-diff/env-promote/sqlAdvisor/sqlAnalyze guards affect only edge/shouldn't-happen paths; the mapping `database` normalization preserves the present-string success path byte-for-byte (Rule #50 key = schema+table item-identity only, clean). CR 27.1-10's config-section annotation is a deliberate, tested cosmetic render fix resolving that very deferred item.
- **OS closed-by-decision:** spot-checked CR 26.1-1 (MessageResend confirm double-gate blocks any dryRun-coercion bypass) and CR 28.1-1 MED (SqlAdvisor bare-catch → empty className → "index list unknown" → no false positive, works on pinned 2026.1). Both genuinely graceful/fails-safe forward-hazards, not active shipping defects.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

- Live IRIS probes (HSCUSTOM, IRIS for Windows (x86-64) 2026.1) via `iris_sql_execute`/`iris_execute_classmethod`: confirmed CR 27.0-2/27.0-5 already-fixed (Story 27.1); captured 5 fresh EXPLAIN plans for CR 28.0-1 (unused-index dotted-token non-collision — confirmed via existing test), CR 28.0-2 (correlated subquery), CR 28.2-2 (3 probes proving the mixed equality+range predicate collapses to a single `=` test line on this IRIS version — synthetic test used instead), CR 28.2-4 (`INFORMATION_SCHEMA.TABLES` composite-idkey full-scan).
- Mutation-verify runs (revert fix → confirm new test(s) RED for the expected reason → restore → confirm green) performed individually for every RESOLVED code fix: CR 26.2-1, CR 27.1-4 (both fetchers), CR 27.1-7, CR 27.1-9, CR 27.1-10, CR 27.3-4, CR 27.4-1, CR 28.2-2, CR 28.2-4, CR 28.3-2, CR 29.1-1.
- One approach change recorded: CR 29.1-1's first attempt (a registration-time throw banning any `.default()`-wrapped `action` field) broke 2 pre-existing Story 15.0 tests (`governance-classification.test.ts`'s `iris_wrapped_manage` synthetic fixture, which deliberately exercises `.default()`-wrapped action enums as a supported governance shape) — reverted that approach and replaced it with a pure helper (`actionFieldHasDefault`) plus a mechanical cross-package pin (`packages/iris-mcp-all`) asserting no REAL shipped tool uses the pattern, which is both correct and additive.

### Completion Notes List

- Probed (Rule #16) all 41 carried items against their cited source before disposing; no item's claimed shape had materially changed, though 2 (CR 27.0-2, CR 27.0-5) were discovered ALREADY FIXED in Story 27.1 (the ledger's carried-item listing simply hadn't been updated) and were closed-with-evidence rather than re-resolved.
- Resolved 14 items with mutation-verified (or, for CR 26.4-2/28.3-1, doc/test-only) fixes; closed 4 with fresh live evidence (CR 27.0-2, 27.0-5, 28.0-1, 28.0-2); closed 23 by decision (14 bootstrapped-OS-class-touching items + 9 by-design/spec-faithful/ambiguous TS/script items), all with recorded rationale. Zero re-deferrals. (Tally mechanically recounted from the disposition column at code review: 14 resolved · 4 closed-with-evidence · 23 closed-by-decision = 41.) Full disposition table + tally appended to `deferred-work.md` under "## Story 29.3 (2026-07-12) — DEFERRED-WORK LEDGER BURN-DOWN".
- One correction surfaced during disposition: CR 26.1-4's original deferral claimed downstream coverage by the Story 26.3 live smoke; re-reading that story's actual AC 26.3.2 plan shows it exercises `resendFiltered` REFUSALS + a plain `resend`, never a successful `resendFiltered` execute — the claim was optimistic. Corrected and closed-by-decision as an accepted, now-accurately-documented coverage gap (not silently left mis-documented).
- Rule #19 gate: zero `src/ExecuteMCPv2/**` changes; `BOOTSTRAP_VERSION` and frozen governance baseline `1e62c5ad5bf7` (141 keys) unchanged (`git diff` empty on `governance-baseline.ts` + every `bootstrap-classes.ts`; `gen:governance-baseline:check` exit 0, no new tool/governance key). Every resolved fix is additive/edge-path only — verified via the full existing suites staying green (incl. `sqlAnalyze-rule19-snapshot.test.ts`'s byte-for-byte pin on the four pre-existing `iris_sql_analyze` actions).
- Full monorepo suite green: `pnpm turbo run test` 13/13 tasks (shared 765 + dev 592 + ops 340 + admin 443 + interop 326 + all 51 + data 124 = 2641 tests, all passing). `pnpm turbo run lint` 6/6 green (iris-mcp-all has no lint script).

### File List

- `_bmad-output/implementation-artifacts/deferred-work.md` (modified — appended the Story 29.3 burn-down disposition table + tally)
- `_bmad-output/implementation-artifacts/28-3-advise-tool-docs-smokes.md` (modified — corrected the CR 28.3-1 Dev Agent Record claim about malformed-query behavior)
- `docs/migration-v1-v2.md` (modified — CR 27.4-1, "100 tools" → "104 tools", 2 occurrences)
- `packages/iris-interop-mcp/src/tools/message-resend.ts` (modified — CR 26.2-1)
- `packages/iris-interop-mcp/src/__tests__/message-resend.test.ts` (modified — CR 26.2-1 regression tests)
- `packages/iris-ops-mcp/src/tools/health.ts` (modified — CR 26.4-2 doc note)
- `packages/iris-dev-mcp/src/tools/env-diff.ts` (modified — CR 27.1-4, 27.1-7, 27.1-9, 27.1-10)
- `packages/iris-dev-mcp/src/__tests__/env-diff-domains.test.ts` (modified — regression tests for the above + CR 27.0-2/27.0-5 already-fixed evidence)
- `packages/iris-dev-mcp/src/tools/env-promote.ts` (modified — CR 27.3-4)
- `packages/iris-dev-mcp/src/__tests__/env-promote-execute.test.ts` (modified — CR 27.3-4 regression tests)
- `packages/iris-dev-mcp/src/tools/sqlAdvisor.ts` (modified — CR 28.2-2, CR 28.2-4)
- `packages/iris-dev-mcp/src/__tests__/sqlAdvisor.test.ts` (modified — CR 28.2-2, 28.2-3, 28.2-4, 28.0-2 regression tests)
- `packages/iris-dev-mcp/src/__tests__/sqlAdvisor.fixtures.ts` (modified — new live-captured Fixture 9 correlated-subquery + INFORMATION_SCHEMA composite-idkey fixture)
- `packages/iris-dev-mcp/src/tools/sqlAnalyze.ts` (modified — CR 28.3-2)
- `packages/iris-dev-mcp/src/__tests__/sqlAnalyze-advise.test.ts` (modified — CR 28.3-1 test rename, CR 28.3-2 regression tests)
- `packages/shared/src/governance.ts` (modified — CR 29.1-1, new `actionFieldHasDefault` helper)
- `packages/shared/src/__tests__/action-default-registration-guard.test.ts` (new — CR 29.1-1 pure-helper unit tests)
- `packages/iris-mcp-all/src/__tests__/action-default-audit-pin.test.ts` (new — CR 29.1-1 cross-package mechanical pin)
- `packages/iris-mcp-all/src/__tests__/docs-prompt-sync.test.ts` (modified — CR 27.4-1 mechanical doc-count guard for `docs/migration-v1-v2.md`)
