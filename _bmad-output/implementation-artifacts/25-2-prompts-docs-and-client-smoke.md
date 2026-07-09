# Story 25.2: Docs Rollup + Live Client Smoke

Status: done

## Story

As a user evaluating and installing the IRIS MCP suite,
I want the prompts/skills pack documented across the README surfaces and proven end-to-end through a real MCP client on live IRIS,
so that I can discover the workflow prompts, install the skills, and trust that a full prompt-driven workflow actually works.

This is the **docs + smoke** closing story of Epic 25. It documents the capability shipped by Stories 25.0/25.1 and verifies it end-to-end. **No new prompt content or framework code** — docs + verification only.

## Acceptance Criteria

- **AC 25.2.1** — Docs rollup (Rule #30), framing prompts as a **framework surface** (Rule #31 — prompts are NOT tools; tool counts UNCHANGED everywhere):
  - Root `README.md`: a new "Workflow Prompts & Agent Skills" capability section — what MCP prompts are, the 9 v1 prompts (grouped by owning server), that they are discoverable via `prompts/list` and installable as `skills/` (point to `skills/README.md`), that the 2 gated prompts ship with Epics 26/27, and that **prompts do not change the 101-tool count** (they are a separate protocol capability).
  - Per-server `packages/<pkg>/README.md`: a "Prompts" section listing that server's prompts with a one-line description each (ops: 2, dev: 3, interop: 2, admin: 2; data-mcp: explicitly none in v1). Match the existing "Tool Reference" section style.
  - `CHANGELOG.md`: a new dated Epic-25 entry (Added — Prompts capability + skills pack) noting strictly-additive/TS-content-only, no tool-count change, no governance key, frozen baseline `1e62c5ad5bf7` untouched, no `BOOTSTRAP_VERSION` change.
  - `tool_support.md`: a short note that the suite also ships MCP **prompts** (not tools; not counted in the per-server tool tables) with a pointer to the README section — keep the tool tables/counts unchanged.
  - **Assert tool counts did NOT move**: every package `index.test.ts` `toHaveLength`/`getToolNames` count and the suite/advertised counts are unchanged from before Epic 25 (Rule #31). State this in the story notes with the numbers.
- **AC 25.2.2** — Live client smoke on the BUILT dist through a real MCP client (lead-executed per-story smoke; Rules #22/#26): (a) `prompts/list` shows the pack on the relevant server(s); (b) `prompts/get diagnose-slow-query` renders with a `query` argument; (c) **ONE full workflow executed end-to-end following ONLY the prompt text** — `deploy-and-test-class` against a disposable scratch class on live IRIS (HSCUSTOM): load a scratch `.cls` (glob-path form), compile, run its unit test, compare the returned `total` vs expected, and clean up the scratch class. Record evidence in the story.
- **AC 25.2.3** — Spec 03 §6 acceptance criteria 1–7 all pass; conventions §6 Definition-of-Done checklist complete (build+test green; `gen:skills:check`, `validate:prompts`, `gen:governance-baseline:check` all exit 0; frozen baseline untouched; docs rollup complete; all disposable probe/smoke artifacts deleted).

## Tasks / Subtasks

- [x] **Task 1 — Root README prompts section** (AC: 25.2.1)
  - [x] Add a "Workflow Prompts & Agent Skills" section (near the capability/governance sections). List the 9 prompts grouped by server, explain `prompts/list`/`prompts/get` discoverability + `skills/` install (link `skills/README.md`), note the 2 gated prompts (Epics 26/27), and state explicitly that prompts are a framework capability that does NOT change the 101-tool count.
- [x] **Task 2 — Per-server README prompt sections** (AC: 25.2.1)
  - [x] ops (`check-system-health`, `run-external-backup`), dev (`diagnose-slow-query`, `objectscript-review`, `deploy-and-test-class`), interop (`trace-message-flow`, `recover-stuck-production`), admin (`provision-project-environment`, `audit-security-posture`): add a "Prompts" section, one-line each. data-mcp: a one-line "No prompts in v1." (or omit its section — but be explicit if adding one elsewhere).
- [x] **Task 3 — CHANGELOG + tool_support note** (AC: 25.2.1)
  - [x] CHANGELOG dated Epic-25 entry (additive, TS/content-only, counts unchanged, baseline untouched). `tool_support.md` short prompts note (not counted as tools).
- [x] **Task 4 — Count-invariance assertion** (AC: 25.2.1, 25.2.3)
  - [x] Run `pnpm turbo run test`; confirm NO package `index.test.ts` count moved and the suite advertised counts are unchanged. Record the per-package tool counts (dev 26, admin, interop, ops, data, + `iris_server_profiles`) in the story notes and confirm they match pre-Epic-25.
- [x] **Task 5 — DoD verification** (AC: 25.2.3)
  - [x] `pnpm turbo run build` + `test` green; `pnpm gen:skills:check` exit 0; `pnpm validate:prompts` exit 0; `pnpm gen:governance-baseline:check` exit 0; `git diff --exit-code packages/shared/src/governance-baseline.ts` clean. Walk spec 03 §6 AC 1–7 and check each off in the story notes.
  - [x] (Lead executes the AC 25.2.2 live-IRIS workflow smoke at the smoke gate; dev records the smoke PLAN + expected outcome here so the lead can execute it deterministically.)

### Review Findings (code review 2026-07-08)

Adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor). Docs verified accurate: all 9 prompt names and owning-server assignments are an EXACT match to the registered prompts in `packages/*/src/prompts/`; both gated prompts (`resend-failed-messages` → interop/Epic 26, `promote-environment-change` → dev/Epic 27) match the authoritative spec 03 §5 and are documented as not-yet-registered; frozen baseline `1e62c5ad5bf7`, `baseline-classifications.ts`, and `BOOTSTRAP_VERSION` all git-clean (CHANGELOG claims TRUE); all relative links + anchors resolve; "101 tools" intact; no package `index.test.ts` count moved. Smoke PLAN (AC 25.2.2) is deterministic and correct (glob-path Rule #17, `total: 2` Rule #35, dual IRIS-side + disk-side cleanup).

- [x] [Review][Patch] Doc-rot guard did not catch cross-server prompt mis-attribution (the CR 25.1-1 failure mode) [packages/iris-mcp-all/src/__tests__/docs-prompt-sync.test.ts] — FIXED: added a negative "no server's README claims a foreign server's prompt" assertion (5 tests now pass, was 4). Both hunters flagged this MED independently; the actual docs were already correct, so this hardens the guard rather than fixing a docs bug.
- [x] [Review][Patch] Story File List omitted the QA test file + cycle-log and the "touched no test files" claim was stale [25-2 story File List] — FIXED: File List reconciled; the dev-stage-only scope of the "no test files" note clarified.
- [x] [Review][Defer] Prose count numbers ("9 prompts" heading; `tool_support.md` per-server tallies) are not mechanically asserted against `EXPECTED_COUNTS` [packages/iris-mcp-all/src/__tests__/docs-prompt-sync.test.ts] — deferred, LOW test-hardening; the name-presence + per-server count assertions already catch the primary drift vectors. Logged to `deferred-work.md`.
- Dismissed (2): "101 tools" literal guard brittle vs a future legitimate count change (by-design Rule #31 guard, intended coupling); gated prompts could inflate catalog counts (verified NOT registered — not present in any `src/prompts/` source; `EXPECTED_COUNTS` correct; suite green).

## Dev Notes

### Scope
- **Docs + verification ONLY.** No new prompts, no framework/tool/ObjectScript changes, no bootstrap bump, no governance-baseline touch. If a docs task seems to require a code change, STOP (`## Clarification Needed`).
- Prompts are a **framework surface** (Rule #31): package tool-array counts and `getToolNames`/`toHaveLength` assertions MUST stay unchanged. The suite is currently documented as **101 tools** (package totals; each server also advertises the framework `iris_server_profiles`). Do NOT alter these counts. (Note: a pre-existing README "100 vs 102 known names" drift was observed in Story 25.1 dev notes; reconciling that is OUT of scope here unless trivially a prompts-doc adjacency — do not expand scope.)

### Live smoke (AC 25.2.2) — the lead executes this against live IRIS

**Method:** build dist, drive a real MCP client against the built `packages/iris-dev-mcp/dist/index.js` (or the in-process `McpServerBase` + real `Client`/`InMemoryTransport` pattern used in the Story 25.0/25.1 lead smokes) for parts (a)/(b), then FOLLOW the `deploy-and-test-class` prompt text literally for part (c), using the `iris-execute-mcp` MCP tools available in the session against **HSCUSTOM**.

**(a) `prompts/list`** — connect to the built `iris-dev-mcp` server (or any of the four with prompts) and call `prompts/list`. Expect `deploy-and-test-class`, `diagnose-slow-query`, `objectscript-review` in the dev server's response (3 prompts on dev). Optionally repeat against `iris-ops-mcp`/`iris-interop-mcp`/`iris-admin-mcp` dist to confirm their 2 prompts each, and against `iris-data-mcp` dist to confirm **no** `prompts` capability is advertised (empty pack, Rule #19 back-compat — already proven by Story 25.0's unit tests, but a live spot-check is cheap here).

**(b) `prompts/get diagnose-slow-query`** — call `prompts/get` with `name: "diagnose-slow-query"` and `arguments: { query: "SELECT * FROM Sample.Person" }`. Expect a single `role:"user"` text message whose body names `iris_sql_analyze` with actions `explain` → `indexUsage` → `stats`, embeds the literal query text, and ends with a "recommend, never auto-apply" note. Confirm the `namespace?` optional argument renders its bracketed placeholder when omitted (per Story 25.1's `arg()` helper design).

**(c) `deploy-and-test-class` end-to-end workflow** — the deterministic scratch-class plan:

1. **Create the scratch class on disk** at `src/ExecuteMCPv2/Temp/PromptSmokeTest.cls` (package `ExecuteMCPv2.Temp`, camelCase class name — no underscores per the ObjectScript basics rule) with exactly 2 test methods, so the expected `iris_execute_tests` `total` is deterministic:

   ```objectscript
   Class ExecuteMCPv2.Temp.PromptSmokeTest Extends %UnitTest.TestCase
   {

   Method TestAlwaysPassOne()
   {
       Do $$$AssertTrue(1=1, "Smoke assertion one — always true")
   }

   Method TestAlwaysPassTwo()
   {
       Do $$$AssertEquals(2+2, 4, "Smoke assertion two — arithmetic sanity")
   }

   }
   ```

2. **Deploy (prompt step 1)** — call `iris_doc_load` with the **glob-prefixed path** form (Rule #17 — a bare path mis-maps the class name):
   ```
   iris_doc_load path="c:/git/iris-execute-mcp-v2/src/**/PromptSmokeTest.cls" compile=true namespace=HSCUSTOM
   ```
   Expect zero compile errors (the class above is deliberately minimal/valid — no compile-fix loop iteration should be needed for this smoke, though the prompt text covers that branch if it were).
3. **Test level (prompt step 3)** — a single class, so `level: "class"`.
4. **Run tests (prompt step 4)** — call `iris_execute_tests` with `target: "ExecuteMCPv2.Temp.PromptSmokeTest"`, `level: "class"`.
5. **Compare `total` vs expected (prompt step 5, Rule #35)** — **expected `total` = 2** (the two `TestXxx` methods above). If the returned `total` is short (the documented early-partial-snapshot caveat), rerun per prompt step 6 before trusting the result.
6. **Expected final result**: `total: 2`, `passed: 2`, `failed: 0`, `skipped: 0` (or the equivalent shape `iris_execute_tests` returns on this build).
7. **Cleanup (mandatory, both sides):**
   - IRIS-side: delete the compiled class, e.g. `iris_doc_delete name="ExecuteMCPv2.Temp.PromptSmokeTest.cls" namespace=HSCUSTOM` (or `iris_execute_command` `Do $System.OBJ.Delete("ExecuteMCPv2.Temp.PromptSmokeTest.cls","d")`).
   - Disk-side: delete `src/ExecuteMCPv2/Temp/PromptSmokeTest.cls` (and the now-empty `src/ExecuteMCPv2/Temp/` directory if nothing else uses it) so no scratch artifact is left in the working tree.
   - Confirm `iris_doc_list` (or a follow-up `iris_execute_classmethod`) no longer shows the class in HSCUSTOM.

Record pass/fail for (a)/(b)/(c) plus the observed `total`/pass/fail counts in this story's Dev Agent Record once executed.

### Doc placement references
- Root README capability sections live around "Multiple Servers & Governance" / "Read-only mode" (README.md ~178–299) — add the prompts section in that neighborhood. Servers table + "101 tools" note at README ~13–21 must stay numerically unchanged.
- Per-server READMEs have a "## Tool Reference" (e.g. `packages/iris-ops-mcp/README.md:106`) — add "## Prompts" adjacent, matching style.
- CHANGELOG format: dated `## [Pre-release — YYYY-MM-DD]` + `### Added — Epic N:` (see the Epic-24 entry at CHANGELOG head).

### References
- [Source: research/feature-specs/03-skills-prompts-pack.md#2 (counting/docs), #5 story 3, #6 AC 1-7] — docs framing + smoke.
- [Source: research/feature-specs/00-conventions.md#5 Documentation rollup, #6 DoD].
- [Source: .claude/rules/project-rules.md#30 (docs rollup default-state), #31 (framework-surface counting)].
- [Source: skills/README.md] — the install guide generated in Story 25.1 (link from the root README).

### Count-invariance record (Task 4, Rule #31)

`pnpm turbo run build` (6/6 tasks green) and `pnpm turbo run test` (13/13 tasks green, 0 regressions) confirm no tool-count assertion moved. Per-package `tools/index.ts` array length (`toHaveLength`/`.length` assertions in each package's `index.test.ts`), unchanged from pre-Epic-25:

| Package | Package tool count | Advertised (+1 `iris_server_profiles`) |
|---|---:|---:|
| `@iris-mcp/dev` | 26 | 27 |
| `@iris-mcp/admin` | 26 | 27 |
| `@iris-mcp/interop` | 21 | 22 |
| `@iris-mcp/ops` | 21 (asserted `>= 20`) | 22 |
| `@iris-mcp/data` | 7 | 8 |
| **Suite total** | **101** | **106** |

These match `tool_support.md`'s "Suite-wide rollup" table exactly (untouched by this story). Full-suite test-file counts (all tests, not just tool-array assertions) did move relative to Story 25.1's recorded baseline — but that movement is entirely `+prompts.test.ts`/`+prompt-safety-invariants.test.ts`/`+skills-generated-frontmatter.test.ts` files added by Stories 25.0/25.1 (already present in the working tree before this story started), NOT anything added or changed by this docs-only story: shared 686 (unchanged), dev 368 (+3 `prompts.test.ts`), admin 443 (+4), interop 274 (+4), ops 338 (+3), data 124 (+3), `@iris-mcp/all` 29 (+21, two new files). This story touched zero test files and zero source files — File List below is exclusively documentation.

### DoD verification (Task 5, spec 03 §6 AC 1-7 walkthrough)

- `pnpm turbo run build` — 6/6 tasks green.
- `pnpm turbo run test` — 13/13 tasks green, 0 regressions (see count-invariance record above).
- `pnpm gen:skills:check` → exit 0 ("10 generated file(s) match source, no drift").
- `pnpm validate:prompts` → exit 0 ("18 source(s) checked (9 prompt(s) + 9 generated skill(s)), 102 known tool name(s)").
- `pnpm gen:governance-baseline:check` → exit 0 ("141 frozen foundation keys (committed) / 194 live keys / 53 post-foundation new keys (allowed)").
- `git diff --exit-code packages/shared/src/governance-baseline.ts` → exit 0 (clean); same for `packages/shared/src/baseline-classifications.ts`.

Spec 03 §6 acceptance criteria:
1. **All 5 servers advertise `prompts` and serve the pack correctly** — SATISFIED (Stories 25.0/25.1; re-confirmed green in this story's full test run: `prompts.test.ts` present and passing on dev/admin/interop/ops, absent on data).
2. **Every tool name in every prompt/skill validates against the live catalog (CI test)** — SATISFIED (`validate:prompts` exit 0; also wired as a default-suite vitest test in `@iris-mcp/all`).
3. **`skills/` is generated, header-stamped, `gen-skills --check` passes; hand-editing fails the check** — SATISFIED (`gen:skills:check` exit 0; hand-edit drift detection proven live in Story 25.1).
4. **No-prompts back-compat snapshot green** — SATISFIED (Story 25.0's capability-snapshot tests still pass; `@iris-mcp/data` registers no prompts).
5. **Live client smoke per Story 3, including one end-to-end workflow execution** — PLAN written above for the lead to execute at the smoke gate (dev does not execute live IRIS calls per this story's scope).
6. **Docs rollup complete; tool counts UNCHANGED everywhere** — SATISFIED (Tasks 1-3 + count-invariance record above).
7. **Conventions §6 Definition-of-Done checklist complete** — SATISFIED for every dev-scoped item; the live-smoke line item is the lead's per-story gate (Rules #22/#26) per this story's own Dev Notes.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via bmad-dev-story.

### Debug Log References

- `pnpm turbo run build` — 6/6 tasks green (1 cache hit on `@iris-mcp/shared`, 5 fresh; no source changed by this story).
- `pnpm turbo run test` — 13/13 tasks green: shared 686, dev 368, admin 443, ops 338, interop 274, data 124, `@iris-mcp/all` 29. Zero regressions; the movement vs Story 25.1's recorded baseline (365→368 dev, 439→443 admin, 335→338 ops, 270→274 interop, 121→124 data, 8→29 all) is entirely pre-existing `prompts.test.ts`/`prompt-safety-invariants.test.ts`/`skills-generated-frontmatter.test.ts` files from Stories 25.0/25.1 already in the working tree — this story added/changed no test or source file.
- `pnpm gen:skills:check` → exit 0 ("10 generated file(s) match source, no drift").
- `pnpm validate:prompts` → exit 0 ("18 source(s) checked (9 prompt(s) + 9 generated skill(s)), 102 known tool name(s)").
- `pnpm gen:governance-baseline:check` → exit 0 ("141 frozen foundation keys (committed) / 194 live keys / 53 post-foundation new keys (allowed)").
- `git diff --exit-code packages/shared/src/governance-baseline.ts` and `...baseline-classifications.ts` — both exit 0 (clean, untouched).
- `git diff --stat` on the 8 touched doc files — 141 insertions, 0 deletions across `README.md`, `CHANGELOG.md`, `tool_support.md`, and the 5 per-server `packages/*/README.md` files. Purely additive.

### Completion Notes List

- **Root README** ([README.md](../../README.md)): added a new "Workflow Prompts & Agent Skills" section between "Backward Compatibility" and "Architecture" — what MCP prompts are, a table of all 9 v1 prompts grouped by owning server (with `@iris-mcp/data` called out as shipping none), the 2 gated prompts (`resend-failed-messages`/Epic 26, `promote-environment-change`/Epic 27) explicitly named as not-yet-registered, discoverability via `prompts/list`/`prompts/get`, `skills/` install pointer to `skills/README.md`, and an explicit "prompts do not change the 101-tool count" statement (Rule #31) cross-linked to Backward Compatibility.
- **Per-server READMEs**: added a "## Prompts" section to each, placed after "## Tool Reference" and before "## Tool Examples" (matching the existing section flow/style) — ops (2), dev (3), interop (2), admin (2) each list their prompts with a one-line description and a pointer to `skills/README.md`; `iris-data-mcp/README.md` states "No prompts in v1" with a pointer back to the root README section.
- **CHANGELOG.md**: new dated `## [Pre-release — 2026-07-08] — Epic 25` entry (placed above the existing same-dated Epic-24 entry, consistent with the file's newest-first ordering) covering the framework `prompts` capability (25.0), the 9-prompt pack + `skills/` generator + `validate-prompts.mjs` rot-prevention (25.1), and the CR 24.0-1/Rule #44 readOnlyHint cross-check fold-in (25.1) — explicitly states strictly-additive/TS-content-only, no tool/governance-key change, frozen baseline `1e62c5ad5bf7` untouched, no `BOOTSTRAP_VERSION` change.
- **tool_support.md**: new short "## MCP prompts (not tools)" section (placed after the "Framework tools" section, before "Suite-wide rollup") stating the 9-prompt breakdown by server and that prompts are not counted in any tool table, with a pointer to the root README section and `skills/README.md`. No existing table/count in this file was touched.
- **Count-invariance (Task 4, Rule #31)**: verified via `pnpm turbo run build` + `pnpm turbo run test` (13/13 green) that every package's `tools/index.ts` array-length assertion (`toHaveLength`/`.length` in each `index.test.ts`) is unchanged: dev 26, admin 26, interop 21, ops 21 (asserted `>=20`), data 7 — package total 101, advertised (incl. framework `iris_server_profiles`) 106, matching `tool_support.md`'s existing rollup table exactly. See the "Count-invariance record" Dev Notes subsection for the full breakdown and an explanation of why the raw full-suite test counts moved (pre-existing files from Stories 25.0/25.1, not this story).
- **DoD verification (Task 5)**: `pnpm turbo run build`/`test` green, `gen:skills:check`/`validate:prompts`/`gen:governance-baseline:check` all exit 0, frozen baseline + `baseline-classifications.ts` both git-clean. Walked spec 03 §6 AC 1-7 — all SATISFIED except AC 5 (live client smoke), which is the lead's per-story execution gate; see the "DoD verification" Dev Notes subsection for the full per-criterion walkthrough.
- **AC 25.2.2 live smoke — PLAN only, not executed by dev** (per this story's explicit scope: "the LEAD executes it at the smoke gate... Do NOT execute the live-IRIS deployment yourself"). Wrote a fully deterministic plan into Dev Notes → "Live smoke (AC 25.2.2)": (a) `prompts/list` expectations per server, (b) `prompts/get diagnose-slow-query` expected render shape, (c) a complete `deploy-and-test-class` end-to-end walkthrough using a disposable `ExecuteMCPv2.Temp.PromptSmokeTest` scratch class (2 deterministic test methods → expected `total: 2`), the exact glob-path `iris_doc_load` command (Rule #17), the `iris_execute_tests` call, and explicit IRIS-side + disk-side cleanup steps (Rule #38/hygiene). No live IRIS calls were made and no scratch class was created by this dev session.
- Confirmed no docs task required a code change — no `## Clarification Needed` was triggered. Scope stayed strictly docs + verification: no new prompts, no framework/tool/ObjectScript changes, no bootstrap bump, no governance-baseline touch (`git diff --exit-code` clean on both frozen files).

### File List

- `README.md` (modified — new "Workflow Prompts & Agent Skills" section)
- `CHANGELOG.md` (modified — new dated Epic-25 entry)
- `tool_support.md` (modified — new "MCP prompts (not tools)" section)
- `packages/iris-ops-mcp/README.md` (modified — new "## Prompts" section)
- `packages/iris-dev-mcp/README.md` (modified — new "## Prompts" section)
- `packages/iris-interop-mcp/README.md` (modified — new "## Prompts" section)
- `packages/iris-admin-mcp/README.md` (modified — new "## Prompts" section)
- `packages/iris-data-mcp/README.md` (modified — new "## Prompts" section, "No prompts in v1")
- `_bmad-output/implementation-artifacts/25-2-prompts-docs-and-client-smoke.md` (this file — modified, tasks checked, Dev Notes smoke plan + count-invariance/DoD records added, Dev Agent Record filled in, status review)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — status ready-for-dev → in-progress → review)
- `packages/iris-mcp-all/src/__tests__/docs-prompt-sync.test.ts` (**added, QA/review stage** — default-suite doc-rot guard asserting the docs stay in sync with the registered prompt catalog: every registered prompt name present in the root README, each owning server's README lists exactly its own prompts at the expected count, `iris-data-mcp` claims none, the root "101 tools" claim intact, and no server's README claims a foreign server's prompt (cross-attribution guard, CR 25.1-1). Added after the dev record above was written — the "touched no source or test files" note in the Dev Notes / Debug Log refers to the DEV stage only.)
- `_bmad-output/implementation-artifacts/cycle-log-epic-25.md` (modified — cycle log)
