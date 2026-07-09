# Story 25.1: Prompt & Skill Content + Generators + Validation

Status: done

## Story

As an MCP client user of the IRIS servers,
I want a pack of 9 workflow **prompts** (correct tool names, safe ordering, safety notes) plus a generated installable `skills/` directory,
so that clients can discover and follow the suite's expert tool *sequences* — and a validation test guarantees the prompt/skill bodies never reference a renamed/removed tool.

This is the **content + tooling** story of Epic 25. It consumes the framework `PromptDefinition`/`prompts?` plumbing shipped by Story 25.0. It also folds in **CR 24.0-1** (the Rule #44 `readOnlyHint` cross-check test), which was routed to Epic 25 by the Epic 24 retro — it lands here (not 25.0) because it needs every package's tool annotations, which only the all-packages aggregation available in this story can import (`@iris-mcp/shared` cannot import leaf packages; see Dev Notes).

## Acceptance Criteria

- **AC 25.1.1** — Author the **9 non-gated** `PromptDefinition`s per spec §3, each in `packages/<owning-pkg>/src/prompts/`, wired into that server's `index.ts` via the Story-25.0 `prompts?` option (ops prompts on ops, dev on dev, interop on interop, admin on admin). Each prompt names EXACT, currently-existing tool names/params, safe ordering, and safety notes. Prompt-specific requirements:
  - `check-system-health` (ops, arg `server?`) — uses `iris_health_check` (Epic 23).
  - `diagnose-slow-query` (dev, args `query`, `namespace?`) — `iris_sql_analyze:explain` → `:indexUsage` → `:stats` → interpretation checklist; recommend, never auto-apply.
  - `trace-message-flow` (interop, args `sessionOrHeaderId`, `namespace?`) — `iris_production_messages` → `iris_message_diagram` → `iris_production_logs` for erroring items.
  - `provision-project-environment` (admin, arg `projectName`) — `iris_database_manage:create` → `iris_namespace_manage:create` → `iris_user_manage:create` → `iris_webapp_manage:create`, verify each step; rollback notes.
  - `audit-security-posture` (admin, arg `server?`) — `iris_user_get` → `iris_role_list` → `iris_service_manage:list` → `iris_ssl_list` → `iris_audit_manage` status → report default passwords, %All holders, insecure services.
  - `objectscript-review` (dev, no args) — distill `.claude/rules/iris-objectscript-basics.md` + testing rules into a **≤300-word** pre-write checklist ($$$ macros, Quit-in-try/catch, %OnNew/initvalue, no-underscore names, storage sections untouchable).
  - `deploy-and-test-class` (dev, arg `classOrPackage`) — `iris_doc_load` (**glob-path form**, Rule #17) → compile-error loop → `iris_execute_tests` → **compare returned `total` vs expected (Rule #35)** → rerun if short.
  - `recover-stuck-production` (interop, args `production?`, `namespace?`) — `iris_production_status` → `iris_production_summary` + `iris_production_queues` → `iris_production_logs` for stuck items → `iris_production_control:recover` FIRST → re-check → only if still wedged: `clean` → **NEVER suggest `killAppData` unless the user explicitly accepts persistent business-state loss (double-gate)** → verify healthy restart (the Epic-20 escalation ladder).
  - `run-external-backup` (ops, arg `server?`) — `iris_journal_info` pre-check → `iris_backup_manage` freeze → verify frozen → PAUSE for external snapshot → `iris_backup_manage` thaw **ALWAYS, even if the snapshot failed** (never end frozen) → `iris_journal_info` verify journaling resumed → history.
  - The 2 gated prompts (`resend-failed-messages`, `promote-environment-change`) are **OMITTED** (ship with Epics 26/27). Do not register them.
- **AC 25.1.2** — `scripts/gen-skills.mjs` generates `skills/<name>/SKILL.md` (YAML frontmatter `name`, `description`, then the prompt body) + `skills/README.md` install guide, each output carrying a **DO-NOT-EDIT** header (Rule #18). A `--check` mode passes in CI and **fails when a generated skill is hand-edited** (Rule #25 shape — no-write verification; mirror `gen-governance-baseline.mjs`'s `--check` structure). Single source of truth: content authored ONCE in `packages/*/src/prompts/`, `skills/` is generated from it.
- **AC 25.1.3** — `scripts/validate-prompts.mjs` + a **default-suite vitest test**: extract every `iris_[a-z0-9_]+` token from all prompt AND generated-skill bodies and assert each is a real tool name, validated against the five packages' `tools` arrays + framework tool name(s) (`iris_server_profiles`). A tool rename breaks CI, not users. Wired so `pnpm turbo run test` runs it (see Dev Notes for placement — `packages/iris-mcp-all`).
- **AC 25.1.4** — CR 24.0-1 / Rule #44 `readOnlyHint` cross-check: a **default-suite test** that, for every key in `BASELINE_ACTION_CLASSIFICATIONS` (`@iris-mcp/shared`) classified `"read"`, looks up the owning tool's `annotations.readOnlyHint` and **flags any `read` key whose tool declares `readOnlyHint: false`** — such a key must either carry a justification (the classification file already uses inline `// read: <why>` comments) or is a misclassification. Fail-safe direction: an unexplained `read` + `readOnlyHint:false` divergence FAILS the test (forcing a reclassify-to-`write` or a documented justification). It flags-for-review, not a full oracle (some reads legitimately diverge). Lives in `packages/iris-mcp-all` (needs every package's annotations).
- **AC 25.1.5** — Prompts are NOT tools (Rule #31): **no** tool-count / `getToolNames` / `toHaveLength` assertion moves in ANY package, no governance key is added, `gen:governance-baseline:check` exits 0, frozen baseline `1e62c5ad5bf7` untouched. The v1 prompt list is stakeholder-approved (2026-07-07); any add/rename/removal during dev is re-flagged (content is a product surface) — emit `## Clarification Needed` rather than silently changing the approved set.

## Tasks / Subtasks

- [x] **Task 1 — Prompt content** (AC: 25.1.1, 25.1.5)
  - [x] For each owning package, create `packages/<pkg>/src/prompts/<name>.ts` (or a single `prompts/index.ts` exporting the array) as `PromptDefinition[]`. Owners: ops → `check-system-health`, `run-external-backup`; dev → `diagnose-slow-query`, `objectscript-review`, `deploy-and-test-class`; interop → `trace-message-flow`, `recover-stuck-production`; admin → `provision-project-environment`, `audit-security-posture`. (data-mcp gets none in v1.)
  - [x] Export a `prompts` array from each package (e.g. `packages/<pkg>/src/prompts/index.ts`) and wire it into that server's `McpServerBase` construction in the package `index.ts` (`{ ..., prompts }`).
  - [x] **Verify EVERY `iris_*` tool/action name against `tool_support.md` (ground truth) and the live `tools` arrays BEFORE finalizing.** Some spec §3 names may need the exact action spelling (e.g. `iris_audit_manage` status action, `iris_service_manage:list`); use the real names. `validate-prompts` (Task 3) is the mechanical gate but author correctly first.
  - [x] Encode the safety invariants verbatim in the relevant prompt bodies: `recover-stuck-production` recover-FIRST / clean-last-resort / never-`killAppData`-without-explicit-data-loss-acceptance; `run-external-backup` thaw-ALWAYS-even-on-failure + verify journaling resumed; `deploy-and-test-class` glob-path (Rule #17) + total-count check (Rule #35); `objectscript-review` ≤300 words (verified: 169 words).
- [x] **Task 2 — `gen-skills.mjs` generator** (AC: 25.1.2)
  - [x] `scripts/gen-skills.mjs`: import the per-package prompt arrays (built-dist import via `scripts/lib/prompt-catalog.mjs`, mirroring `gen-governance-baseline.mjs`'s relative-file-URL technique — single source of truth, and avoids expanding `@iris-mcp/shared`'s public `exports` surface), render each to `skills/<name>/SKILL.md` (frontmatter `name`/`description` + body from `build({})`) and a `skills/README.md`. Stamp a DO-NOT-EDIT header on every generated file (Rule #18).
  - [x] Add a `--check` mode (no-write; re-derive and diff against on-disk `skills/`, exit non-zero on drift, incl. stale-file detection) mirroring `gen-governance-baseline.mjs`'s `--check` structure; write mode also removes stale skill directories so `--check` never flags a leftover the generator itself failed to clean up. Added `package.json` scripts `gen:skills` and `gen:skills:check`.
  - [x] Ran `gen:skills` to produce the committed `skills/` tree; confirmed `gen:skills:check` is idempotent (exit 0) right after. Live-verified: a hand-edit is caught as drift (exit 1) and cleared by regenerating; a synthetic orphaned skill directory is caught as stale (exit 1) and removed by the write path.
- [x] **Task 3 — `validate-prompts.mjs` + default-suite wiring** (AC: 25.1.3)
  - [x] `scripts/validate-prompts.mjs`: extracts `iris_[a-z0-9_]+` tokens from all prompt bodies + generated skill bodies; asserts each ∈ (union of the five `tools` arrays' names + the framework `iris_server_profiles` discovery tool). Non-existent token → non-zero exit naming the offending token + source. Added `package.json` script `validate:prompts`.
  - [x] Wired a vitest test (`packages/iris-mcp-all/src/__tests__/validate-prompts.test.ts`) that imports the SAME core validation module (`scripts/lib/validate-prompts-core.mjs`) the CLI script uses, so `pnpm turbo run test` fails on a rot. Gave `iris-mcp-all` a minimal `vitest.config.ts` + `test` script + `src/__tests__/`. Validation logic single-sourced (imported by both the script and the test) via `scripts/lib/{tool-catalog,prompt-catalog,validate-prompts-core}.mjs`.
- [x] **Task 4 — CR 24.0-1 `readOnlyHint` cross-check** (AC: 25.1.4)
  - [x] Added `packages/iris-mcp-all/src/__tests__/readonly-hint-crosscheck.test.ts`: builds a map of governance key → owning tool (`deriveKeysForTool` from `@iris-mcp/shared`'s built-dist `governance-baseline-derivation.js`, applied to each package's `tools`); for every `BASELINE_ACTION_CLASSIFICATIONS` key === `"read"`, asserts the owning tool's `annotations.readOnlyHint !== false` OR the classification carries a justification in the test's `JUSTIFIED_READONLYHINT_DIVERGENCES` allowlist. Documented in the test's own header comment as a flag-for-review oracle (Rule #44), not a runtime-complete oracle. Mutation-tested: temporarily removing one justification entry correctly failed the test (confirmed, then restored).
  - [x] The cross-check surfaced 15 divergences (all multi-action tools where the OWNING tool's `readOnlyHint:false` reflects a DIFFERENT write action, not the read action in question — an expected shape per each tool's own tool-scoped-annotation doc comments). Each was independently verified (TS handler branch +, for 7 keys dispatched via a single `ctx.http.post`+`action` body field, the backing ObjectScript REST handler's `If tAction = "..."` branch) to confirm NO IRIS-state mutation for that specific action, then added as a reviewed, commented justification entry. **Zero required reclassification** — no new CR-24.0-1-shaped bugs found; `baseline-classifications.ts` and `governance-baseline.ts` are both untouched (`git diff` clean on both).
- [x] **Task 5 — Build, full suite, hygiene** (AC: 25.1.2, 25.1.3, 25.1.4, 25.1.5)
  - [x] `pnpm turbo run build` (6/6) + `pnpm turbo run test` (13/13 tasks, incl. the new `@iris-mcp/all` 2 files/8 tests) green; `pnpm turbo run lint` + `pnpm turbo run type-check` clean; `pnpm gen:skills:check` exit 0; `pnpm validate:prompts` exit 0 (18 sources, 102 known tool names); `pnpm gen:governance-baseline:check` exit 0 (141 frozen / 194 live / 53 post-foundation — unchanged from Story 25.0); `git diff --exit-code` clean on both `governance-baseline.ts` and `baseline-classifications.ts`. Confirmed NO package's tool-count/`getToolNames` test moved (Rule #31) — every leaf package's test count is byte-for-byte identical to the pre-story baseline (shared 686, dev 365, admin 439, ops 335, interop 270, data 121).

## Dev Notes

### Consumes Story 25.0
- Story 25.0 shipped `PromptDefinition`/`PromptArgumentDefinition` (in `@iris-mcp/shared` `tool-types.ts`, exported from `index.ts`) and `prompts?: PromptDefinition[]` on `McpServerBaseOptions`, registered in the `McpServerBase` constructor. This story only AUTHORS content and wires each server's array — no framework changes needed. Recall the Story-25.0 quirks: no-arg prompts must have `arguments: []` (the framework registers them without an `argsSchema` so `prompts/get` works when a client omits `arguments`); `build(args: Record<string, string | undefined>)`.

### Cross-package placement (critical — why 25.1 hosts CR 24.0-1)
- `@iris-mcp/shared` does NOT (and must not — circular) depend on the leaf packages. So a test needing every tool's `annotations` (the `readOnlyHint` cross-check) or every tool's `name` (validate-prompts) CANNOT live in `shared/__tests__`. The only package depending on all five is **`packages/iris-mcp-all`** (`@iris-mcp/all`; deps: `@iris-mcp/dev/admin/interop/ops/data`). It is currently a stub with no `src`/tests — give it a minimal `vitest.config.ts` (mirror another package's), a `test` script in its `package.json` (`vitest run`), and `src/__tests__/`. Both the validate-prompts test and the readOnlyHint cross-check live here.
- Tool enumeration pattern (proven in `scripts/gen-governance-baseline.mjs`): import `SERVER_PACKAGES` from `@iris-mcp/shared`'s `governance-baseline-derivation`, then import each `packages/<pkg>/dist/tools/index.js`'s `tools` array; OR import the workspace packages' tool arrays via their package entry if exported. `deriveKeysForTool(tool, pkgLabel)` (same module) returns the governance key(s) for a tool — reuse it to map keys → tools for the cross-check. NOTE the built-dist approach requires `dependsOn: ["build"]` (turbo `test` already declares this, so dists exist at test time).

### Generators — mirror the existing pattern
- `gen-governance-baseline.mjs` is the reference for `--check` (no-write verify → exit non-zero on drift) and CLI-arg parsing (`process.argv.slice(2)`). `gen-skills.mjs` is NOT frozen (unlike the governance baseline), so its DEFAULT mode WRITES `skills/` (no refuse-without-force needed); `--check` is the CI verifier. `gen-bootstrap.mjs` shows the template-literal escaping + hash pattern if useful.
- `skills/` lives at repo ROOT (new top-level dir). `skills/README.md` explains installation (copy into `.claude/skills/` or reference via config). Every generated file starts with a DO-NOT-EDIT banner naming the regen command (Rule #18).

### Governance / counting invariants (Rule #31)
- Prompts carry NO `mutates`, NO governance key, and MUST NOT change any tool-count/`getToolNames`/`toHaveLength` assertion anywhere. `gen:governance-baseline:check` must stay exit 0; NEVER edit `governance-baseline.ts` or run the bare generator (Rule #23/#25). No ObjectScript, no bootstrap bump.
- Docs rollup (README/per-server READMEs/CHANGELOG/tool_support.md) is **Story 25.2**, not this story — do not do it here.

### Testing standards
- Default vitest suite; no `*.integration.test.ts` suffix (Rule #21). The validate-prompts + readOnlyHint tests must run under `pnpm turbo run test`.
- Rule #36 (observe don't assume): pin every tool/action name against `tool_support.md` + the live arrays; let `validate-prompts` be the mechanical proof.

### Project Structure Notes
- New/changed: `packages/{iris-ops,iris-dev,iris-interop,iris-admin}-mcp/src/prompts/*.ts` + each package `index.ts` (wire `prompts`); `scripts/gen-skills.mjs`; `scripts/validate-prompts.mjs`; `skills/**` (generated); `packages/iris-mcp-all/{package.json,vitest.config.ts,src/__tests__/*.test.ts}`; `package.json` (scripts `gen:skills`, `gen:skills:check`, `validate:prompts`); possibly a small correction to `packages/shared/src/baseline-classifications.ts` ONLY if the cross-check finds a real misclassification (frozen baseline untouched regardless).

### References
- [Source: research/feature-specs/03-skills-prompts-pack.md#3 Prompt & skill content, #4 Validation, #5 Story 2] — the 9 prompts, gen-skills, validate-prompts.
- [Source: research/feature-specs/00-conventions.md#4,#6] — testing + DoD.
- [Source: scripts/gen-governance-baseline.mjs] — `--check` pattern + `SERVER_PACKAGES`/dist tool enumeration.
- [Source: packages/shared/src/governance-baseline-derivation.ts:24,66] — `SERVER_PACKAGES`, `deriveKeysForTool`.
- [Source: packages/shared/src/baseline-classifications.ts:47] — `BASELINE_ACTION_CLASSIFICATIONS` shape for the readOnlyHint cross-check.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#Epic 25 retro-review gate] — CR 24.0-1 routing + Rule #16 rationale for 25.1 placement.
- [Source: .claude/rules/project-rules.md#44, #31, #18, #25, #17, #35] — the rules this story realizes/obeys.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `pnpm turbo run build` — 6/6 tasks green (shared + 5 leaf packages; `@iris-mcp/all` has no own `build` script, correctly skipped as a no-op by turbo while `^build` still transitively built its 5 `dependencies`).
- `pnpm turbo run test` — 13/13 tasks green. Per-package test counts (all byte-for-byte unchanged from the pre-story baseline except the new `@iris-mcp/all`): shared 686, dev 365, admin 439, ops 335, interop 270, data 121, **`@iris-mcp/all` 8 (new)**.
- `pnpm turbo run lint` / `pnpm turbo run type-check` — both clean (6/6 each; `@iris-mcp/all` has neither script, matching its minimal-footprint scope per the story's Dev Notes).
- `node scripts/gen-skills.mjs` → "Generated 10 file(s) under skills/ from 9 prompt(s)." `node scripts/gen-skills.mjs --check` → exit 0. Live-verified drift + stale-file detection: hand-appending text to a generated `SKILL.md` made `--check` exit 1 with a DRIFT message; regenerating restored exit 0. Creating a synthetic `skills/orphan-skill/SKILL.md` made `--check` exit 1 with a STALE message; running the generator (write mode) removed the orphaned directory and restored exit 0.
- `node scripts/validate-prompts.mjs` → "OK — 18 source(s) checked (9 prompt(s) + 9 generated skill(s)), 102 known tool name(s)." (102 = 100 real leaf-package tools as of this story + the framework `iris_server_profiles` discovery tool — reconciled against the ~100-tool count in `packages/iris-mcp-all/README.md`, which predates several Epic 21–24 tool additions.)
- `node scripts/gen-governance-baseline.mjs --check` → "141 frozen foundation keys (committed) / 194 live keys / 53 post-foundation new keys (allowed) — OK." Unchanged from the count recorded at Story 25.0 close.
- `git diff --exit-code packages/shared/src/governance-baseline.ts` and `...baseline-classifications.ts` — both clean (exit 0); neither file was touched.
- readOnlyHint cross-check (Task 4) probe: a standalone Node script cross-referencing `BASELINE_ACTION_CLASSIFICATIONS` against the live built tool surface found exactly 15 `read` + `readOnlyHint:false` divergences before any allowlist entries were added; an `Explore` sub-agent independently verified all 15 against the owning TS handler branch (and, for 7 keys whose tool dispatches every action through a single `ctx.http.post` distinguished only by an `action` body field, the backing ObjectScript REST handler's dispatch branch) and reported CONFIRMED-READ for all 15 with zero SUSPECT-MISCLASSIFICATION findings.
- Mutation test on the cross-check itself: temporarily deleted one `JUSTIFIED_READONLYHINT_DIVERGENCES` entry (`iris_analytics_cubes:list`) — the test correctly failed (`expected [ 'iris_analytics_cubes:list' ] to deeply equal []`); the entry was restored and the suite re-ran green.

### Completion Notes List

- Authored the 9 stakeholder-approved v1 prompts exactly as scoped (AC 25.1.5) — no add/rename/removal was needed; every `iris_*` tool/action name was verified against `tool_support.md` and the live built `tools` arrays (Task 1) before being embedded in prompt text, so no `## Clarification Needed` was triggered.
- Design decision: every `build(args)` implementation renders a bracketed `<argName>` placeholder for any omitted argument (via a small local `arg()` helper in each prompt file), so the SAME function serves both the real MCP `prompts/get` render (concrete values from a client) and `gen-skills.mjs`'s static `build({})` call (producing a readable parameterized template) — unifying the two consumers the Dev Notes flagged as options ("`build({})` or a body template") without needing a separate template mechanism.
- Design decision: `scripts/lib/{tool-catalog,prompt-catalog,validate-prompts-core}.mjs` were introduced as new shared helper modules (not previously present) so the tool/prompt enumeration and the core token-extraction/validation logic are single-sourced between `scripts/gen-skills.mjs`, `scripts/validate-prompts.mjs`, and the two new `packages/iris-mcp-all` vitest tests. These import each package's BUILT dist output via relative `file://` URLs (mirroring `scripts/gen-governance-baseline.mjs`'s established technique) rather than bare package-specifier imports, because every package's `package.json` `exports` map is restrictive (only `"."` plus a couple of test-helper subpaths) — a bare-specifier import of e.g. `@iris-mcp/shared/dist/baseline-classifications.js` would fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`. This also avoided any change to `@iris-mcp/shared`'s public barrel export surface (`packages/shared/src/index.ts` is untouched).
- `gen-skills.mjs`'s write mode actively removes stale skill directories (a prompt renamed/removed from source) via `rmSync(..., {recursive:true})`, rather than merely warning — this keeps `--check` never flagging a leftover the generator itself failed to clean up, and keeps `skills/` from silently accumulating orphaned content over time.
- CR 24.0-1 / Rule #44 cross-check (Task 4) found 15 divergences, ALL of which turned out to be the expected "tool-scoped annotation, action-specific classification" shape (not new misclassifications) — each was verified via source inspection (not merely assumed safe because the tool has other write actions) and recorded with an inline justification string in the test file's `JUSTIFIED_READONLYHINT_DIVERGENCES` map, matching the count (15) and shape described in Story 24.0's own retrospective note ("15 read keys outside the obvious-verb allowlist carry inline `// read: <why>` justification comments"). No change to `baseline-classifications.ts` was needed.
- Docs rollup (README/tool_support.md/CHANGELOG/per-server READMEs) is explicitly Story 25.2's scope per the Dev Notes and was NOT done here.
- The 2 gated prompts (`resend-failed-messages`, `promote-environment-change`) were NOT authored or registered, per AC 25.1.1/25.1.5 — verified by an explicit vitest assertion in `validate-prompts.test.ts` that neither name is registered.

### File List

- `packages/iris-ops-mcp/src/prompts/checkSystemHealth.ts` (new)
- `packages/iris-ops-mcp/src/prompts/runExternalBackup.ts` (new)
- `packages/iris-ops-mcp/src/prompts/index.ts` (new)
- `packages/iris-ops-mcp/src/index.ts` (modified — wired `prompts`)
- `packages/iris-dev-mcp/src/prompts/diagnoseSlowQuery.ts` (new)
- `packages/iris-dev-mcp/src/prompts/objectscriptReview.ts` (new)
- `packages/iris-dev-mcp/src/prompts/deployAndTestClass.ts` (new)
- `packages/iris-dev-mcp/src/prompts/index.ts` (new)
- `packages/iris-dev-mcp/src/index.ts` (modified — wired `prompts`)
- `packages/iris-interop-mcp/src/prompts/traceMessageFlow.ts` (new)
- `packages/iris-interop-mcp/src/prompts/recoverStuckProduction.ts` (new)
- `packages/iris-interop-mcp/src/prompts/index.ts` (new)
- `packages/iris-interop-mcp/src/index.ts` (modified — wired `prompts`)
- `packages/iris-admin-mcp/src/prompts/provisionProjectEnvironment.ts` (new)
- `packages/iris-admin-mcp/src/prompts/auditSecurityPosture.ts` (new)
- `packages/iris-admin-mcp/src/prompts/index.ts` (new)
- `packages/iris-admin-mcp/src/index.ts` (modified — wired `prompts`)
- `scripts/lib/tool-catalog.mjs` (new)
- `scripts/lib/prompt-catalog.mjs` (new)
- `scripts/lib/validate-prompts-core.mjs` (new)
- `scripts/gen-skills.mjs` (new)
- `scripts/validate-prompts.mjs` (new)
- `skills/README.md` (new, generated)
- `skills/check-system-health/SKILL.md` (new, generated)
- `skills/run-external-backup/SKILL.md` (new, generated)
- `skills/diagnose-slow-query/SKILL.md` (new, generated)
- `skills/objectscript-review/SKILL.md` (new, generated)
- `skills/deploy-and-test-class/SKILL.md` (new, generated)
- `skills/trace-message-flow/SKILL.md` (new, generated)
- `skills/recover-stuck-production/SKILL.md` (new, generated)
- `skills/provision-project-environment/SKILL.md` (new, generated)
- `skills/audit-security-posture/SKILL.md` (new, generated)
- `packages/iris-mcp-all/package.json` (modified — added `type`/`scripts.test`)
- `packages/iris-mcp-all/vitest.config.ts` (new)
- `packages/iris-mcp-all/src/__tests__/validate-prompts.test.ts` (new)
- `packages/iris-mcp-all/src/__tests__/readonly-hint-crosscheck.test.ts` (new)
- `package.json` (modified — added `gen:skills`, `gen:skills:check`, `validate:prompts` scripts)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — status ready-for-dev → review)
- `_bmad-output/implementation-artifacts/25-1-prompt-skill-content-and-generators.md` (this file — modified, status review)

## Review Findings

Code review (bmad-code-review, 2026-07-08) — adversarial three-layer (Blind Hunter / Edge Case Hunter / Acceptance Auditor) + lead independent verification (all gates re-run live: `validate:prompts`, `gen:skills:check`, `gen:governance-baseline:check` all exit 0; `@iris-mcp/all` suite 29/29; readOnlyHint oracle mutation-tested genuine; word-count re-measured). **0 HIGH.** 1 MED + 1 LOW-MED patched inline; 2 LOW deferred; 1 LOW dismissed.

Explicit checkpoints evaluated:
- **`objectscript-review` ≤300 words (AC 25.1.1):** SATISFIED by a wide margin. The `build({})` body renders 146 alphanumeric-token words / 169 naive whitespace-split words — far under 300 by every defensible measure. The guard test measures exactly the body surface (`prompt.build({})`), not gamed. The "270–309" figure in earlier notes counts the full generated `SKILL.md` (DO-NOT-EDIT banner + name + description frontmatter + body); the AC constrains the checklist body, which is 146/169.
- **Cross-package built-dist-import tests / `testTimeout: 20_000` (QA item):** ACCEPTABLE pattern. Importing built dist couples the test to a prior build, but turbo `test dependsOn build` guarantees dists exist, and the absent-dist failure mode is a clear thrown error (never a silent pass). The 20s ceiling gives ~4x margin over the observed worst case (5.2s). Critically, a timeout produces a FAILURE, not a false pass — so the capstone-genuineness (Rule #21-adjacent) concern does not apply. Residual flake risk under pathological CI load is low and non-silent. No finding.
- **Rule #44 readOnlyHint cross-check GENUINE (AC 25.1.4):** CONFIRMED. Mutation test (removing the `iris_analytics_cubes:list` justification) turns the oracle RED (`expected [ 'iris_analytics_cubes:list' ] to deeply equal []`), then restored to green. The 15-entry `JUSTIFIED_READONLYHINT_DIVERGENCES` allowlist is genuinely per-key (each a real multi-action tool whose tool-level `readOnlyHint:false` reflects a DIFFERENT write action), not a blanket suppression. CR 25.1-2 strengthened the second (stale-entry) test to actually assert `readOnlyHint === false`, matching its title.

- [x] [Review][Patch] CR 25.1-1 [MED] `check-system-health` (ops) instructed calling `iris_database_manage` — an admin-only tool absent from the ops server (validate-prompts can't catch it: it validates against the UNION of all 5 packages). [packages/iris-ops-mcp/src/prompts/checkSystemHealth.ts:46] — FIXED: reworded to note the tool is on the admin MCP server (not ops), keeping the correct remediation; skills/ regenerated; all gates re-green. (blind+edge+auditor)
- [x] [Review][Patch] CR 25.1-2 [LOW-MED] readOnlyHint cross-check second test's title promised a `readOnlyHint`-still-false assertion its body never made (only asserted classification==="read" + tool defined), so a stale allowlist entry whose tool flipped to `readOnlyHint:true` would go unflagged. [packages/iris-mcp-all/src/__tests__/readonly-hint-crosscheck.test.ts:153] — FIXED: added `expect(tool.annotations?.readOnlyHint).toBe(false)`; 29/29 green (confirms all 15 justified tools genuinely declare `readOnlyHint:false`). (blind)
- [x] [Review][Defer] CR 25.1-3 [LOW] `gen-skills.mjs --check` misses stray files inside a valid skill dir / orphan dir lacking `SKILL.md`; "fail on ANY drift" header mildly overstated. [scripts/gen-skills.mjs:109-122,174-181] — deferred (robustness-only; realistic drift vectors already caught; DO-NOT-EDIT header mitigates). See deferred-work.md § story-25.1. (blind+edge)
- [x] [Review][Defer] CR 25.1-4 [LOW] `arg()` collapses empty-string to placeholder while note-branches key on `!== undefined`, so an explicitly-empty provided/required arg renders a self-referential `<placeholder>` on the live path. [packages/iris-interop-mcp/src/prompts/recoverStuckProduction.ts:44-47,59; packages/iris-dev-mcp/src/prompts/diagnoseSlowQuery.ts:38,53] — deferred (cosmetic; unusual client input; generated-skills path unaffected). See deferred-work.md § story-25.1. (edge)
- [Review][Dismiss] CR 25.1-5 [LOW] readOnlyHint justifications live in the test-file allowlist rather than inline `// read:` comments in `baseline-classifications.ts` (AC 25.1.4's parenthetical). DISMISSED: AC 25.1.5 requires `baseline-classifications.ts` git-clean (frozen), so adding new inline comments there would VIOLATE 25.1.5. The test-file allowlist is the correct home given the frozen-file constraint; the oracle is proven fail-safe. Conflicting-AC resolved sensibly by the dev. (auditor)

**Verification of story claims:** all 9 prompts on correct owning servers with correct args; 2 gated prompts unregistered (mechanically asserted); safety invariants encoded verbatim (recover-first→clean→killAppData double-gate requiring BOTH `killAppData:true` AND `confirm:true` + explicit data-loss acceptance; thaw-ALWAYS-even-on-failure + journaling-resumed verify; glob-path Rule #17 + total-count Rule #35); per-server `prompts.test.ts` genuinely drives the REAL MCP SDK `prompts/list` handler via `new McpServerBase({...,prompts})` (Rule 3 satisfied); data-mcp proves no-prompts absence. All safety-critical tool-action references verified against the real tool schemas (`iris_production_control` recover/clean/killAppData/confirm; `iris_backup_manage` freeze/thaw/listHistory; `iris_audit_manage` status; `iris_service_manage` list; `iris_sql_analyze` explain/indexUsage/stats; `iris_message_diagram` sessionIds; `iris_health_check` 9 areas). Rule #31 held: no package tool-count/`getToolNames`/`toHaveLength` assertion moved, no governance key added, `gen:governance-baseline:check` exit 0, frozen baseline `1e62c5ad5bf7` + `baseline-classifications.ts` git-clean.

**Final:** 2 resolved (patched), 2 deferred, 1 dismissed, 0 decision-needed. No unresolved HIGH/MEDIUM → Status **done**.
