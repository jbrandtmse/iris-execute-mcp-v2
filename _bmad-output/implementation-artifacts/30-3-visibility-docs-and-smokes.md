# Story 30.3: Visibility Docs + Live Smokes

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **suite operator reading the docs to choose a preset, and a maintainer needing proof the feature works on the shipped build**,
I want **the complete "Tool Visibility Presets" documentation across every surface plus recorded live smokes on the built dist**,
so that **the visibility feature is discoverable and correctly explained everywhere the suite is documented, and its four headline behaviors are proven end-to-end on the real artifact — closing Epic 30**.

## Acceptance Criteria

- **AC 30.3.1 — Docs rollup (Rule #30, all surfaces).**
  - Root `README.md`: env-var rows for `IRIS_TOOLS_PRESET` / `IRIS_TOOLS_DISABLE` / `IRIS_TOOLS_ENABLE` (in the existing env-var table/section), AND the "Tool Visibility Presets" section (currently a Story-30.2 stub carrying only the measurement table) **completed** with: the per-server roster tables (or a compact summary + pointer to spec §2.5), the **visibility-vs-governance layering rules** (spec §2.1 — visibility = per-tool ergonomics "does the agent know this exists?"; governance = per-action safety "is this call allowed?"; visibility evaluated first; `IRIS_GOVERNANCE` keys naming hidden tools legal+inert; `read-only` safety is still `IRIS_GOVERNANCE_PRESET`, never a visibility preset), the resolution precedence (`ENABLE > DISABLE > preset > default-visible`, wildcards, reserved `iris_server_profiles`), and the measurement table (keep 30.2's numbers). Remove the "Stub section (Story 30.2)" marker.
  - `tool_support.md`: a note on tool visibility (presets exist; hidden tools are absent from `tools/list`; default `full` = today's behavior).
  - All three `docs/client-config/*.md` (`claude-code.md`, `claude-desktop.md`, `cursor.md`): the visibility env vars shown in each guide's `env` block/example (at least `IRIS_TOOLS_PRESET`), with a one-line pointer to the README section.
  - Per-server READMEs (`packages/{iris-dev,iris-admin,iris-interop,iris-ops,iris-data}-mcp/README.md` + `packages/iris-mcp-all/README.md` as applicable): a short "Tool Visibility" note stating this server's `full`/`core`/`developer` runtime counts (from the 30.2 measurement table) and that `core` is the small-model subset.
  - `CHANGELOG.md`: an Epic 30 entry under `[Unreleased]` summarizing the visibility feature (additive; default `full` unchanged).
  - **Default-state at point of use (Rule #30):** state that unset visibility env ⇒ byte-for-byte today's `tools/list` (default `full`) wherever the env vars are introduced.
- **AC 30.3.2 — Prompt-pack sweep (spec §2.6).** Sweep every registered prompt's text (`packages/*/src/prompts/*.ts`) for references to tools that `core` or `developer` hides (e.g. `auditSecurityPosture` → security admin tools hidden under both presets; `diagnoseSlowQuery` → `iris_sql_analyze` hidden under `core`; `promoteEnvironmentChange` → `iris_env_diff`/`iris_env_promote` hidden under `core`). Where found, EITHER soften the prompt wording OR record the limitation in the README ("prompts may reference tools your preset hides — switch to `full` or enable the specific tool"). Prefer the README note (a single documented limitation) over editing many prompts, unless a specific prompt is trivially reworded; do NOT change prompt behavior/argument shape (Rule #31-adjacent: no prompt-count change).
- **AC 30.3.3 — Live smokes on the built dist (Rules #22/#26), recorded.** With a prior `pnpm turbo run build`, run each of the 4 scenarios against the BUILT server in a real Node process (stdio MCP process OR built-dist server construction driving the real `tools/list`/`tools/call`), and record the results (paste evidence into the story Completion Notes):
  - (a) **Default launch** ⇒ `tools/list` identical to pre-feature (all package tools + `iris_server_profiles`; no visibility env set).
  - (b) **`IRIS_TOOLS_PRESET=core`** ⇒ `tools/list` equals that server's core roster (+ `iris_server_profiles`) exactly, AND a `tools/call` to a hidden tool name returns the SDK's standard **unknown-tool error** (not a governance error).
  - (c) **`IRIS_TOOLS_DISABLE=iris_global_*` + `IRIS_TOOLS_ENABLE=iris_global_get`** (on iris-dev-mcp) ⇒ the `iris_global_*` family is hidden EXCEPT `iris_global_get` (hole punched).
  - (d) **Invalid `IRIS_TOOLS_PRESET=bogus`** ⇒ startup crash naming the valid values (`full`, `core`, `developer`).
  - Disposable smoke scripts are **deleted before staging** (Rule #22 — the smoke files must not be committed).
- **AC 30.3.4 — Epic gate (spec §4 ACs 1-11 + conventions §6).** Confirm spec §4's 11 acceptance criteria all hold across Stories 30.0-30.3 (a short checklist in the story notes mapping each spec-AC to its proof — test name, smoke, or doc), and the `00-conventions.md` §6 checklist is complete. `pnpm turbo run build test lint type-check` green; `pnpm gen:governance-baseline:check` exit 0; frozen `1e62c5ad5bf7` + `BOOTSTRAP_VERSION` untouched; no tool/governance/bootstrap change (docs + smokes only).

### Integration ACs

This is a docs + verification story (no new service/module). It consumes the entire Epic 30 surface (engine 30.0, rosters 30.1, surfacing+measurement 30.2). No downstream consumer. The live smokes (AC 30.3.3) are the epic's end-to-end integration proof on the shipped artifact.

## Tasks / Subtasks

- [x] **Task 1 — Complete the root README section + env rows** (AC: 30.3.1)
  - [x] Add the three visibility env vars to the README's env-var reference (rows with default/description; default `full`).
  - [x] Complete the "Tool Visibility Presets" section: layering rules (spec §2.1), precedence + wildcards + reserved tool, roster summary (counts per server per preset — from the 30.2 measurement table / spec §2.5 "Roster summary"), keep the measurement table. Remove the stub marker.
- [x] **Task 2 — Secondary doc surfaces** (AC: 30.3.1)
  - [x] `tool_support.md` visibility note.
  - [x] `docs/client-config/{claude-code,claude-desktop,cursor}.md`: env var in each `env` example + README pointer.
  - [x] Per-server READMEs (5 + iris-mcp-all): short "Tool Visibility" note with this server's full/core/developer counts.
  - [x] `CHANGELOG.md` `[Unreleased]` Epic 30 entry.
- [x] **Task 3 — Prompt-pack sweep** (AC: 30.3.2)
  - [x] Grep `packages/*/src/prompts/*.ts` for tool-name references; list which reference a tool hidden under `core`/`developer`. Record the README limitation note (preferred) and/or soften trivially. Do not change prompt args/behavior.
- [x] **Task 4 — Live smokes** (AC: 30.3.3)
  - [x] `pnpm turbo run build`, then run scenarios (a)-(d) against the built dist in disposable scripts; capture output into the story Completion Notes. Delete the disposable scripts before finishing.
- [x] **Task 5 — Epic gate + verify** (AC: 30.3.4)
  - [x] Spec §4 ACs 1-11 checklist (each → its proof). Conventions §6 checklist.
  - [x] `pnpm turbo run build test lint type-check` green; `pnpm gen:governance-baseline:check` exit 0; confirm no code/governance/bootstrap change (docs-only diff besides deleted smoke scripts).

## Dev Notes

- **This is the Epic 30 capstone story: docs rollup + live smokes + the epic gate.** No production code change is expected (docs + the recorded smokes). If a smoke reveals a real defect, that is a HIGH — fix it (widening scope to the offending story's code) and pin a regression, do not paper over it in docs.
- **README seam (Rule #43/#52):** Story 30.2 shipped the MINIMAL stub (measurement table + pointer). This story ENRICHES it — do NOT re-measure (reuse 30.2's numbers) and do NOT first-create the section. Remove the "Stub section (Story 30.2)" marker when complete.
- **Layering rules to state (spec §2.1):** visibility (per-tool, registration-time, "does the agent know this exists?") vs governance (per-action, call-time, "is this call allowed?"); visibility evaluated first; an `IRIS_GOVERNANCE` key naming a hidden tool is legal + inert; `read-only` SAFETY is still `IRIS_GOVERNANCE_PRESET`, NEVER a visibility preset; per-profile visibility is impossible (one `tools/list` per process). These are the guardrails that keep an operator from mistaking visibility for a safety control.
- **Prompt-pack sweep (spec §2.6):** the registered prompts reference tool names in their rendered text. Candidates to check (grep confirms): `auditSecurityPosture`/`provisionProjectEnvironment` (admin), `deployAndTestClass`/`diagnoseSlowQuery`/`objectscriptReview`/`promoteEnvironmentChange` (dev), `recoverStuckProduction`/`resendFailedMessages`/`traceMessageFlow` (interop), and any ops/data prompts. A prompt that names a tool hidden under a preset isn't a bug — it is a documented limitation (the README note). Prefer ONE README note over editing many prompts.
- **Live smokes are the epic's Rule #22/#26 gate** — built dist in a real Node process, not the vitest suite. The lead will ALSO run an independent smoke at the gate; your recorded evidence + the lead's smoke together close the epic. Delete disposable scripts before staging (they must not be committed).
- **Rule #35 note** (if any smoke drives `tools/list` counts): compare against the expected roster counts from the 30.2 measurement table (full 29/27/23/22/8 runtime; core 13/13/10/10/8; developer 29/11/23/10/8).
- **Out of scope:** any engine/roster/surfacing code change (30.0-30.2 own those); runtime toggling / per-action / per-profile visibility (spec §5). This story does not add tools, governance keys, ObjectScript, or a bootstrap bump.

### Project Structure Notes

- Edited: `README.md` (complete the section + env rows), `tool_support.md`, `docs/client-config/*.md` (3), `packages/*/README.md` (per-server + iris-mcp-all), `CHANGELOG.md`. Possibly a prompt `.ts` if trivially softened (else README note only).
- Ephemeral: disposable smoke scripts (created, run, DELETED before staging — never committed).
- Untouched: all Epic 30 engine/roster/surfacing code (30.0-30.2), package `tools[]` arrays, count assertions, frozen baseline, `BOOTSTRAP_VERSION`.

### References

- [Source: research/feature-specs/11-tool-visibility-presets.md#2.1] — visibility-vs-governance layering rules (README).
- [Source: research/feature-specs/11-tool-visibility-presets.md#2.5] — roster tables + summary counts (README).
- [Source: research/feature-specs/11-tool-visibility-presets.md#2.6] — prompt-pack sweep.
- [Source: research/feature-specs/11-tool-visibility-presets.md#3] — Story 4 scope; [#4] — the 11 epic-gate ACs (AC 30.3.4 checklist).
- [Source: research/feature-specs/00-conventions.md#6] — the conventions §6 checklist.
- [Source: epics.md#Story-30.3] — AC 30.3.1-30.3.3.
- [Source: architecture.md#I1] — visibility layer summary for the docs.
- [Source: README.md#L370] — the Story-30.2 stub section to complete.
- [Source: packages/*/src/prompts/*.ts] — the prompt pack to sweep.
- [Source: .claude/rules/project-rules.md#30] — docs rollup surfaces + default-state at point of use; [#43/#52] rollup enriches / documented seam; [#22/#26] built-dist live smokes; [#31] no tool/prompt counts move.

## Review Findings

Code review 2026-07-19 (3-layer adversarial: Blind Hunter + Edge Case Hunter + Acceptance Auditor, consolidated by lead). **0 HIGH / 1 MEDIUM resolved / 2 LOW resolved / 2 dismissed (0 deferred).** All findings verified against live source (Rule #14/#16) before action. Post-fix gates: `pnpm turbo run test lint type-check` 25/25 tasks green; `pnpm gen:governance-baseline:check` exit 0 (frozen `1e62c5ad5bf7` / 141 keys / 201 live / 60 post-foundation, unchanged); no tool/governance/bootstrap/prompt-count change (Rule #31 held); docs + one test only.

Applied patches:
- [x] [Review][Patch] MED-1 — doc-rot guard extended to the previously-unguarded count surfaces [packages/iris-mcp-all/src/__tests__/docs-visibility-roster-sync.test.ts]. The 30.2/30.3 guard covered only the root README's two tables; the `packages/iris-mcp-all/README.md` cross-server summary table, each per-server README's Tool Visibility prose counts, and the `CHANGELOG.md` Epic-30 roster-summary line hard-code the same numbers and were unguarded (same doc-rot class the guard exists to prevent). Added 3 new blocks (iris-mcp-all table vs live runtime counts; CHANGELOG `full`/`core`/`developer` N/N/N/N/N line vs live in dev/admin/interop/ops/data order; each per-server README's stated runtime/package counts must all be live-valid). 17 tests pass; mutation-verified genuine (broke one number on each of the 3 surfaces → each corresponding test went red → reverted). `tool_support.md` intentionally out of scope (it hard-codes no visibility counts) — documented in the test comment.
- [x] [Review][Patch] LOW-3 — removed `iris_ecp_status` from the `check-system-health` "names" list [packages/iris-ops-mcp/README.md:44]. Verified against `packages/iris-ops-mcp/src/prompts/checkSystemHealth.ts`: the prompt references `ecp` only as a health AREA (line 46), never the `iris_ecp_status` tool. The other named tools (`iris_journal_info`/`iris_database_check`/`iris_mirror_status` hidden both presets; `iris_license_info`/`iris_metrics_alerts` developer-only) are all correct against `presets.ts`.
- [x] [Review][Patch] LOW-4 — admin `developer` prose reconciled with its 10-tool count [packages/iris-admin-mcp/README.md:42]. The developer `include` (presets.ts) has 10 tools incl. `iris_permission_check`, but the prose "namespace/database/mapping/webapp config" enumerated only 9; added "plus permission checks" (consistent with the core-prose wording).

Dismissed (false positive / cosmetic — not carried as patches):
- [x] [Review][Dismiss] MED-2 (Blind-Hunter, no source access) — claimed the admin core prompt-pack note wrongly omits `iris_role_list` as core-hidden. **False positive**: `auditSecurityPosture.ts` step 2 calls `iris_role_list`, which is in admin **core `include`** (presets.ts line 32 — VISIBLE under core; only `iris_role_manage` is excluded). The note's "3 of 5 hidden under core (service_manage/ssl_list/audit_manage), cannot complete steps 4-6; all 5 hidden under developer" is exactly correct — the prompt's steps 4/5/6 call those three. Applying the suggested patch would have INJECTED a factual error. Recorded in deferred-work.md for Epic 31 retro-review coherence.
- [x] [Review][Dismiss] LOW-5 — cosmetic `#2.5` in a link's display text (href intentionally targets the spec file, no anchor). Not a broken link; common section-reference style. No change.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via a `general-purpose` sub-agent.

### Debug Log References

- Live smoke script (disposable, run against the BUILT `dist/` output, never committed — created at
  and deleted from `C:\Users\Josh\AppData\Local\Temp\claude\...\scratchpad\smoke-30-3.mjs`, outside
  the repo tree): constructed a real `McpServerBase` per package from `packages/<pkg>/dist/**`,
  drove the real `tools/list` and `tools/call` SDK request handlers (same technique as
  `scripts/lib/measure-tools-payload-core.mjs`'s `callRequest`/`fetchAllTools`, and
  `packages/shared/src/__tests__/tool-visibility.e2e.test.ts`).
- One assumption corrected mid-smoke: initial scenario (b) expected `tools/call` on a hidden tool
  to *throw*. It does not — `@modelcontextprotocol/sdk@1.29.0`'s own `CallToolRequestSchema`
  handler (`server/mcp.js`, read directly in `node_modules/.pnpm/...`) wraps EVERY thrown
  `McpError` from its internal dispatch (including its own "Tool X not found" `ErrorCode.InvalidParams`
  throw for an unregistered name) into a `CallToolResult { content, isError: true }` via
  `createToolError()`, rather than letting it propagate as a JSON-RPC exception. This is the SDK's
  own unconditional behavior, not something `server-base.ts` adds. Confirmed by contrast: a
  `GOVERNANCE_DISABLED` refusal always carries `structuredContent.code === "GOVERNANCE_DISABLED"`;
  the unknown-tool result carries no `structuredContent` at all — only `isError:true` + a text
  message containing `"Tool <name> not found"` and `-32602`. The smoke script's assertion was
  corrected to check this exact shape (see Completion Notes scenario (b) evidence below). This is a
  documentation/test-fidelity note only — no code was changed; the underlying spec claim ("no
  custom error body") still holds exactly.

### Completion Notes List

**Docs rollup (AC 30.3.1, Rule #30) — all named surfaces enriched, none first-created:**
- Root `README.md`: added `IRIS_TOOLS_PRESET`/`IRIS_TOOLS_DISABLE`/`IRIS_TOOLS_ENABLE` rows to the
  env-var table (+ the back-compat summary sentence) and completed the "Tool Visibility Presets"
  section (previously the Story-30.2 stub) with the §2.1 layering rules, the §2.2 resolution
  precedence + edge semantics, the `toolVisibility` surfacing block shape, a compact roster summary
  table + per-server design-intent bullets (pointing to each package's `src/tools/presets.ts` as
  the authoritative per-tool source, in lockstep-tested with the spec), and the pre-existing 30.2
  measurement table left byte-for-byte (NOT re-measured, per Rule #43/#52). The "Stub section
  (Story 30.2)" marker is removed.
- `tool_support.md`: added an Epic 30 note clarifying this catalog is package-level (every tool
  that EXISTS) and independent of any one running server's current visibility config — a hidden
  tool still has a row here; no tool count in the document moves.
- `docs/client-config/{claude-code,claude-desktop,cursor}.md`: identical new "Tool Visibility
  Presets (optional)" section in all three (same pattern as the pre-existing "Audit Log" section
  that is already verbatim-identical across the three files), showing `IRIS_TOOLS_PRESET` in a
  worked `env` block + a README pointer.
- Per-server READMEs: new "### Tool Visibility (`IRIS_TOOLS_PRESET`)" subsection in each of the 5
  package READMEs stating that server's `full`/`core`/`developer` runtime counts and design intent,
  plus `packages/iris-mcp-all/README.md` got a summary table across all 5 servers. Default-state
  ("unset ⇒ full ⇒ byte-for-byte today's behavior") stated at every point of use.
- `CHANGELOG.md`: new TOP `## [Unreleased] — Epic 30` entry (did not edit the pre-existing Epic 29
  entry below it, matching the file's established "new top entry per epic" pattern from Stories
  26.3/27.4/28.3/29.2).

**Prompt-pack sweep (AC 30.3.2, spec §2.6):** grepped all 15 prompt files across
`packages/*/src/prompts/*.ts`. Cross-referenced every tool name each prompt calls against all 5
packages' `core`/`developer` rosters. Findings (README limitation note preferred over editing
prompts, per Dev Notes — zero prompt files changed, zero prompt count/argument-shape change):
- `iris-dev-mcp`: `diagnose-slow-query` calls `iris_sql_analyze` (hidden under `core`);
  `promote-environment-change` calls `iris_env_diff`/`iris_env_promote` (both hidden together under
  `core`, per `TOOL_PAIRS`). `deploy-and-test-class` and `objectscript-review` are unaffected under
  every preset. → limitation note added to `packages/iris-dev-mcp/README.md`'s Tool Visibility
  subsection.
- `iris-admin-mcp`: `audit-security-posture` calls `iris_user_get`/`iris_role_list`/
  `iris_service_manage`/`iris_ssl_list`/`iris_audit_manage` — 3 of 5 hidden under `core`, ALL 5
  hidden under `developer` (the prompt cannot run at all under `developer`).
  `provision-project-environment` calls `iris_user_manage`, hidden under `developer` only. →
  limitation note added to `packages/iris-admin-mcp/README.md`.
- `iris-interop-mcp`: all 3 prompts (`recover-stuck-production`, `resend-failed-messages`,
  `trace-message-flow`) call only tools that stay visible under `core` (interop's roster
  deliberately keeps the whole troubleshoot-a-production loop) — no limitation needed; a
  one-line "no limitation applies" note was added instead so this is a checked, not silent, gap.
- `iris-ops-mcp`: `run-external-backup` calls `iris_journal_info`/`iris_backup_manage`, BOTH hidden
  under BOTH `core` and `developer` (the prompt only works under `full`, or with
  `IRIS_TOOLS_ENABLE` naming both). `check-system-health`'s interpretation guidance names several
  tools hidden under one or both presets (`iris_journal_info`/`iris_database_check`/
  `iris_mirror_status`/`iris_ecp_status` under both; `iris_license_info`/`iris_metrics_alerts`
  under `developer` only) — the composite `iris_health_check` call itself always works; only the
  follow-up drill-down tool for some findings may be hidden. → limitation note added to
  `packages/iris-ops-mcp/README.md`.

**Live smokes (AC 30.3.3, Rules #22/#26) — all 4 scenarios PASS, run against the real BUILT
`dist/` output via `packages/shared/dist/index.js`'s real `McpServerBase`, real `tools/list`/
`tools/call` SDK request handlers (no vitest mocks):**

```
=== Scenario (a): default launch (no IRIS_TOOLS_* set), ALL 5 SERVERS ===
[iris-dev-mcp]     tools/list count = 29 (28 package tools + iris_server_profiles) — set-equal to pre-feature. PASS
[iris-admin-mcp]   tools/list count = 27 (26 + 1) — set-equal. PASS
[iris-interop-mcp] tools/list count = 23 (22 + 1) — set-equal. PASS
[iris-ops-mcp]     tools/list count = 22 (21 + 1) — set-equal. PASS
[iris-data-mcp]    tools/list count = 8  (7 + 1)  — set-equal. PASS

=== Scenario (b): IRIS_TOOLS_PRESET=core (iris-dev-mcp) ===
tools/list count = 13 (core roster + iris_server_profiles) — EXACT match to devPresets.core.include. PASS
tools/call("iris_doc_delete") [excluded from dev core] ->
  {"content":[{"type":"text","text":"MCP error -32602: Tool iris_doc_delete not found"}],"isError":true}
  -> SDK standard unknown-tool error (isError:true, "not found", -32602). PASS
  -> NOT a GOVERNANCE_DISABLED envelope (no structuredContent.code). PASS
  -> no structuredContent at all (no custom error body). PASS

=== Scenario (c): IRIS_TOOLS_DISABLE=iris_global_* + IRIS_TOOLS_ENABLE=iris_global_get (iris-dev-mcp) ===
iris_global_get   -> VISIBLE (punched hole). PASS
iris_global_set   -> HIDDEN. PASS
iris_global_kill  -> HIDDEN. PASS
iris_global_list  -> HIDDEN. PASS
every non-iris_global_* tool remains visible. PASS

=== Scenario (d): IRIS_TOOLS_PRESET=bogus (invalid) ===
Constructor threw: "IRIS_TOOLS_PRESET is invalid: must be one of: full, core, developer. Received: \"bogus\"."
  -> names the offending variable IRIS_TOOLS_PRESET. PASS
  -> names all 3 valid values (full, core, developer). PASS

=== SUMMARY: ALL PASS (0 failures) ===
```

Disposable smoke script created OUTSIDE the repo tree (OS scratchpad temp dir) and deleted after
the run; `git status --porcelain` before/after confirms it was never tracked/staged.

**Epic gate (AC 30.3.4) — spec §4's 11 ACs mapped to proof, all hold:**

| Spec §4 AC | Proof |
|---|---|
| 1. No visibility env ⇒ byte-for-byte pre-feature tool set (all 5 packages, default suite) | `tool-visibility-backcompat.test.ts` (30.0, 6 tests) + this story's live smoke (a), all 5 servers against BUILT dist |
| 2. Hidden tool absent from `tools/list`; calling it returns SDK unknown-tool error, no custom envelope, no governance error | `tool-visibility.e2e.test.ts` (30.0) + live smoke (b) |
| 3. Precedence ENABLE>DISABLE>preset>default-visible; wildcard expansion; literal dup warns (ENABLE wins); unknown names warn not fail | `tool-visibility.test.ts` unit suite (30.0, `resolveVisibleTools`) + live smoke (c) |
| 4. `iris_server_profiles` visible under every config; literal disable fails startup; wildcard skips it silently | `tool-visibility.test.ts` reserved-tool tests (30.0) |
| 5. Unknown `IRIS_TOOLS_PRESET` fails startup naming valid values | `tool-visibility.test.ts` `parseToolVisibilityConfig` tests (30.0) + live smoke (d) |
| 6. `assertPresetCoverage` throws naming tool+preset; per-package coverage tests | `tool-visibility.test.ts` (30.0) + `presets.test.ts` × 5 (30.1) |
| 7. Rosters match §2.5 exactly; every `core` ≤13 runtime; `TOOL_PAIRS` co-visible in every preset | `presets.test.ts` × 5 (30.1, independently re-derived set-equality per Story 30.1's own code review) + `TOOL_PAIRS` co-visibility assertion |
| 8. `iris_server_profiles` reports `toolVisibility` (preset + counts, not names); governance report + `iris-governance://` resource omit hidden tools' keys | `tool-visibility-surfacing.test.ts` (30.2) |
| 9. Package `tools[]` arrays + count tests unchanged; `gen:governance-baseline:check` exits 0; frozen baseline untouched | this story: `git diff` shows zero changes to any `tools[]` array or `index.test.ts`/count assertion; `pnpm gen:governance-baseline:check` exit 0 (141 frozen / 201 live / 60 post-foundation, unchanged from post-30.2) |
| 10. Measurement table recorded in README + story notes | 30.2's `measure-tools-payload.mjs` output, carried verbatim into this story's completed README section (not re-measured) |
| 11. All four live smokes recorded; conventions §6 checklist complete | recorded above; conventions §6 checklist below |

**Conventions §6 (`00-conventions.md`) checklist:**
- [x] All spec ACs pass (table above).
- [x] `pnpm turbo run build` and `pnpm turbo run test`: 25/25 turbo tasks green (build 6 + test/lint/type-check 19 in the second invocation), zero regressions across all 7 packages.
- [~] ObjectScript compiled clean on live IRIS / `%UnitTest` full count — **N/A this story**: no ObjectScript touched in Epic 30 (TS-only feature, confirmed via `git status` — nothing under `src/ExecuteMCPv2/**` changed).
- [~] `pnpm run gen:bootstrap` idempotent — **N/A**: no ObjectScript touched; `BOOTSTRAP_VERSION` unchanged.
- [x] `gen:governance-baseline:check` exits 0 (frozen `1e62c5ad5bf7` untouched; 141/201/60, unchanged from post-30.2).
- [x] Live smokes done including rejection paths (scenario (b)'s hidden-tool-call refusal, scenario (d)'s invalid-preset startup crash); results recorded above.
- [x] Docs rollup complete (root README, `tool_support.md`, all 3 client-config guides, 5 per-server READMEs + `iris-mcp-all`, `CHANGELOG.md` — every surface states default-state-at-point-of-use).
- [x] All disposable smoke scripts deleted (created outside the repo tree; confirmed via `git status --porcelain`); no `ExecuteMCPv2.Temp.*` probe classes created (none needed — TS-only story).

**Scope discipline verified:** `git diff --stat` shows ONLY doc files (`README.md`, `CHANGELOG.md`, `tool_support.md`, `docs/client-config/*.md` ×3, `packages/*/README.md` ×6) plus the story/sprint-tracking files — zero changes to any `.ts`/`.mjs`/`.cls` source, zero changes to `governance-baseline.ts`/`baseline-classifications.ts`/`bootstrap-classes.ts`. This closes Epic 30.

### File List

- `README.md` (modified — env-var rows + completed "Tool Visibility Presets" section, stub marker removed)
- `tool_support.md` (modified — Epic 30 visibility note)
- `docs/client-config/claude-code.md` (modified — new "Tool Visibility Presets (optional)" section)
- `docs/client-config/claude-desktop.md` (modified — same)
- `docs/client-config/cursor.md` (modified — same)
- `packages/iris-dev-mcp/README.md` (modified — new "Tool Visibility" subsection + prompt-pack limitation note)
- `packages/iris-admin-mcp/README.md` (modified — new "Tool Visibility" subsection + prompt-pack limitation note)
- `packages/iris-interop-mcp/README.md` (modified — new "Tool Visibility" subsection, no-limitation note)
- `packages/iris-ops-mcp/README.md` (modified — new "Tool Visibility" subsection + prompt-pack limitation note)
- `packages/iris-data-mcp/README.md` (modified — new "Tool Visibility" subsection)
- `packages/iris-mcp-all/README.md` (modified — new "Tool Visibility" summary table)
- `CHANGELOG.md` (modified — new top `[Unreleased] — Epic 30` entry)
- `_bmad-output/implementation-artifacts/30-3-visibility-docs-and-smokes.md` (this story file — tasks/status/Dev Agent Record/File List/Change Log)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — `30-3-visibility-docs-and-smokes`: ready-for-dev → review)
- (ephemeral, not committed) disposable live-smoke script, created and deleted outside the repo tree during Task 4

No `.ts`/`.mjs`/`.cls` source file was created or modified. No `ExecuteMCPv2.Temp.*` probe class was created.

## Change Log

- 2026-07-20 — Story created (lead, /epic-cycle 30). Docs rollup (all surfaces) + prompt-pack sweep + 4 live smokes + epic-gate checklist. Ready for dev. Closes Epic 30.
- 2026-07-20 — Dev complete — status ready-for-dev → review. Docs rollup across all named surfaces (root README env rows + completed "Tool Visibility Presets" section enriching the Story-30.2 stub, `tool_support.md`, all 3 `docs/client-config/*.md`, 5 per-server READMEs + `iris-mcp-all`, `CHANGELOG.md` top entry) — all state default-state-at-point-of-use (unset ⇒ `full` ⇒ byte-for-byte today's `tools/list`). Prompt-pack sweep of all 15 registered prompts across 5 packages: 4 prompts (2 dev, 2 admin, 2 ops — `diagnose-slow-query`/`promote-environment-change`/`audit-security-posture`/`provision-project-environment`/`run-external-backup`/`check-system-health`) reference a tool hidden under `core` and/or `developer`; documented as README limitation notes per-package (preferred over editing prompts per Dev Notes) — zero prompt files changed, zero prompt count/argument change. 4 live smokes run against the BUILT `dist/` output via a disposable Node script (created outside the repo tree, deleted after the run, never tracked): (a) default launch on all 5 servers — byte-for-byte pre-feature tool sets; (b) `IRIS_TOOLS_PRESET=core` on iris-dev-mcp — exact core roster + `iris_server_profiles`, and `tools/call` on a hidden tool (`iris_doc_delete`) returns the SDK's own unknown-tool `CallToolResult` (`isError:true`, "Tool ... not found", `-32602`, no `structuredContent` — confirmed distinct from a `GOVERNANCE_DISABLED` envelope by reading the SDK source directly); (c) `IRIS_TOOLS_DISABLE=iris_global_*` + `IRIS_TOOLS_ENABLE=iris_global_get` on iris-dev-mcp — family hidden except the punched hole; (d) `IRIS_TOOLS_PRESET=bogus` — constructor throws naming `IRIS_TOOLS_PRESET` and all 3 valid values. All 4 scenarios PASS, 0 failures — full transcript in Completion Notes. Epic gate: spec §4's 11 ACs mapped to proof (all hold, table in Completion Notes) and the conventions §6 checklist completed. `pnpm turbo run build test lint type-check`: 25/25 tasks green, zero regressions. `pnpm gen:governance-baseline:check` exit 0 (141 frozen / 201 live / 60 post-foundation, unchanged from post-30.2; frozen baseline `1e62c5ad5bf7` untouched). No ObjectScript/bootstrap change (`BOOTSTRAP_VERSION` untouched — confirmed via `git status`, nothing under `src/ExecuteMCPv2/**` touched). No tool/governance/prompt-count change anywhere (docs + smokes only, mechanically verified via `git diff --stat`). Changes left UNCOMMITTED for the lead to commit after the smoke gate. Closes Epic 30.
