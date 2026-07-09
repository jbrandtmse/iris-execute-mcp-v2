# Story 26.3: Resend Docs + Smokes + Gated Prompt

Status: done

<!-- Epic 26 Story 3 (closing). Docs rollup (Rule #30) + the Epic-25-gated resend-failed-messages prompt + the live resend smokes (lead-executed as the per-story smoke gate). TS/content/docs only — no ObjectScript, no bootstrap change. -->

## Story

As a **user of the interop MCP server + the Agent Skills pack**,
I want **`iris_message_resend` documented on every doc surface (with its duplication hazard + default-disabled writes) and a `resend-failed-messages` workflow prompt shipped**,
so that **I can discover and safely operate the resend capability, and the docs never overstate what governance allows by default**.

## Acceptance Criteria

From `_bmad-output/planning-artifacts/epics.md` Epic 26 → Story 26.3 and binding specs `04-message-resend.md` §§5-7 + `03-skills-prompts-pack.md` §3.

- **AC 26.3.1** — Docs rollup (Rule #30) across ALL FOUR surfaces: (a) **root README** — add `iris_message_resend` to the interop tool catalog (interop count 21→22) + note the write actions are default-disabled; (b) **`packages/iris-interop-mcp/README.md`** — tool-section entry for `iris_message_resend` stating each action, the DUPLICATION HAZARD, and which actions ship **default-disabled** vs enabled-by-default (`preview` read = enabled; `resend`/`resendFiltered` write = disabled) with the `IRIS_GOVERNANCE` enable snippet; (c) **CHANGELOG.md** — Epic 26 Added entry; (d) **`tool_support.md`** (or the authoritative catalog) — `iris_message_resend` row + the default-disabled callout (Rule #30 default-state discipline). Rule #31: `iris_message_resend` is a PACKAGE tool, so package tool counts move (interop 21→22 / suite advertised +1); the prompt is a protocol capability (no tool-count change).
- **AC 26.3.2** — Live smokes (Rules #26/#34 — LEAD-EXECUTED as the per-story smoke gate; dev's job is to make them passable + document the plan): on a scratch production — a single real `resend` of a disposable test message, the new header verified via `iris_production_messages`; live refusals each verified NO-WRITE — `resendFiltered` without `confirm`, over-cap, unbounded window, and a governance-disabled `resend` (when the tool's write is not enabled); a second interop-enabled namespace smoke (Rule #34) OR an explicit residual-risk note if none is available.
- **AC 26.3.3** — The `resend-failed-messages` prompt (interop; params `item`, `since`; content per spec 03 §3 — dry-run-first resend workflow with the duplication-hazard + default-disabled caveats) added to `packages/iris-interop-mcp/src/prompts/` + the `prompts` array in `prompts/index.ts` (removing the "does NOT ship resend-failed-messages (gated on Epic 26)" note). `gen-skills.mjs` regenerated (new `skills/resend-failed-messages/SKILL.md`); `validate-prompts.mjs` green (every `iris_*` token in the prompt body is a real tool name); `docs-prompt-sync.test.ts` `EXPECTED_COUNTS` interop 2→3 + root README "9 prompts"→"10 prompts" + `tool_support.md` per-server interop tally 2→3.
- **AC 26.3.4** — Spec `04-message-resend.md` §7 acceptance criteria 1–9 pass; conventions §6 checklist complete. Frozen governance baseline `1e62c5ad5bf7` untouched (`gen:governance-baseline:check` exit 0); no bootstrap change (`BOOTSTRAP_VERSION` stays `1f3afba4ac52`); full suite green (incl. `validate-prompts`, `docs-prompt-sync`, `readonly-hint-crosscheck`, `skills-generated-frontmatter`).

## Dev Notes

### The gated prompt (AC 26.3.3)

- Model on `packages/iris-interop-mcp/src/prompts/recoverStuckProduction.ts` (same `PromptDefinition` shape, `arg()` helper). New file `resendFailedMessages.ts`; export `resendFailedMessagesPrompt`; add it to `prompts/index.ts` `prompts` array + delete the "does NOT ship resend-failed-messages" comment.
- Params: `item` (required — the source/target config item whose failed messages to resend), `since` (required — the time floor, ISO/date). Body encodes the DRY-RUN-FIRST workflow: `iris_message_resend` `action:"resendFiltered"` `dryRun:true` (preview count + sample) → review with the user → `resendFiltered` `dryRun:false, confirm:true` (or targeted `resend` of specific `headerIds`) → verify new headers via `iris_production_messages`. MUST state the duplication hazard + that the write is governance-default-disabled (enable via `IRIS_GOVERNANCE`).
- Every `iris_*` token in the body must be a REAL tool name (`validate-prompts.mjs` enforces): `iris_message_resend`, `iris_production_messages` are valid. Do NOT invent tool names.
- Note: the existing prompts' `arg()` note-branch has a known LOW bug (CR 25.1-4, being fixed in Story 26.4) — follow the EXISTING pattern for consistency (26.4 harmonizes all prompts uniformly); do not solo-fix it here.

### Docs rollup surfaces (Rule #30 / #43)

- Counts to move: interop tools 21→22 (root README catalog + interop README); suite advertised tool total +1; prompts 9→10 (root README "N prompts" heading + `tool_support.md` interop tally 2→3 + `docs-prompt-sync.test.ts` `EXPECTED_COUNTS.interop` 2→3).
- Default-state callout (Rule #30): every surface documenting `iris_message_resend` must state `preview` is a read enabled by default and `resend`/`resendFiltered` are writes DEFAULT-DISABLED (with the enable snippet). This is the recurring gap Rule #30 exists to close.

### Constraints

- TS/content/docs only — NO ObjectScript, NO bootstrap change. `bootstrap-classes.ts`/`BOOTSTRAP_VERSION` (1f3afba4ac52) must NOT change.
- Frozen baseline `1e62c5ad5bf7` untouched (`gen:governance-baseline:check` exit 0). NEVER the bare generator (Rule #25).
- `gen-skills.mjs` outputs carry the DO-NOT-EDIT header (Rule #18); run with `--check` after regen to confirm idempotence.
- Cross-package tests (docs-prompt-sync, validate-prompts, readonly-hint-crosscheck) live in `packages/iris-mcp-all` (Rule #45) — that's where `EXPECTED_COUNTS` lives.
- Tests in the DEFAULT suite (Rule #21).

### References

- [Source: _bmad-output/planning-artifacts/research/feature-specs/04-message-resend.md §§5-7; 03-skills-prompts-pack.md §3 (resend-failed-messages row) + §4 (validate-prompts)]
- [Source: packages/iris-interop-mcp/src/prompts/recoverStuckProduction.ts (analog), prompts/index.ts (registration), packages/iris-mcp-all/src/__tests__/docs-prompt-sync.test.ts (EXPECTED_COUNTS)]
- [Source: scripts/gen-skills.mjs, scripts/validate-prompts.mjs; README.md (prompts section), packages/iris-interop-mcp/README.md, CHANGELOG.md, tool_support.md]

## Tasks / Subtasks

- [x] Task 1 (AC 26.3.3): Author `resendFailedMessages.ts` (item, since; dry-run-first workflow + hazard + default-disabled note); add to `prompts/index.ts`; remove the gated-omission comment. Run `pnpm gen:skills` (regenerate `skills/resend-failed-messages/`); `gen:skills --check` idempotent.
- [x] Task 2 (AC 26.3.3): Update `docs-prompt-sync.test.ts` `EXPECTED_COUNTS.interop` 2→3; run `validate-prompts` green; `skills-generated-frontmatter` green.
- [x] Task 3 (AC 26.3.1): Docs rollup — root README (catalog + interop 21→22 + prompts 9→10 + default-disabled note), interop README (tool entry + hazard + default-state + enable snippet), CHANGELOG Epic 26 entry, tool_support.md (row + callout + interop prompt tally 2→3).
- [x] Task 4 (AC 26.3.4): `pnpm test` full suite green; `pnpm gen:governance-baseline:check` exit 0; type-check + lint clean; `BOOTSTRAP_VERSION` unchanged. Document the live-smoke PLAN (AC 26.3.2) precisely for the lead to execute (endpoints, expected refusals, cleanup).

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via `bmad-dev-story` skill.

### Debug Log References

None. This is a TS/content/docs-only story — no `^ClineDebug` global, no ObjectScript changed. All verification was via `pnpm turbo run build`, `pnpm gen:skills` / `--check`, `pnpm test`, `pnpm gen:governance-baseline:check`, `pnpm lint`.

### Completion Notes List

- **Prompt authored** (`packages/iris-interop-mcp/src/prompts/resendFailedMessages.ts`) — modeled on `recoverStuckProduction.ts`'s `PromptDefinition` shape + local `arg()` helper. Params `item`/`since` are BOTH required (per spec 03 §3's table), so this prompt has no optional-arg conditional-note branch — the CR 25.1-4 `arg()` note-branch bug (deferred to Story 26.4 for a uniform fix) applies only to prompts with an OPTIONAL argument and does not exist in this file. Body encodes the dry-run-first workflow (steps 1–5: preview → review → cap/window-refusal awareness → execute on explicit approval → verify via `iris_production_messages`), states the `GOVERNANCE_DISABLED` refusal + enable snippet, and the duplication hazard. Registered in `prompts/index.ts` (removed the "does NOT ship resend-failed-messages" doc comment); the array's 3rd entry.
- **`iris-mcp-all` cross-package tests updated** (Rule #45 — these tests import BUILT dist output, so they live in `iris-mcp-all`, not `@iris-mcp/shared`):
  - `docs-prompt-sync.test.ts`: `EXPECTED_COUNTS["iris-interop-mcp"]` 2→3; the "101 tools"/"9 registered prompts" literal-string assertions and doc comments updated to 102/10 (this is a REAL tool-count change from the new `iris_message_resend` tool, not a prompt-inflation regression of the Rule #31 guard the test polices).
  - `validate-prompts.test.ts`: `toHaveLength(9)`→`toHaveLength(10)`; replaced the "gated prompts NOT registered" assertion (which asserted BOTH `resend-failed-messages` and `promote-environment-change` absent) with a split assertion — `resend-failed-messages` IS now registered, `promote-environment-change` (dev, Epic 27) remains the sole gated prompt.
  - `skills-generated-frontmatter.test.ts`: `EXPECTED_SKILL_NAMES` grew to 10 (added `resend-failed-messages`); the "lists all 9 skills" test title/assertion moved to 10.
  - `packages/iris-interop-mcp/src/__tests__/prompts.test.ts` (package-local, imports `../prompts/index.js` directly rather than the dist loader — NOT covered by the `iris-mcp-all` edits above): `OWN_PROMPT_NAMES` grew to 3; the "gated prompt NOT registered" test flipped to "previously-gated prompt IS now registered" plus a new assertion that the OTHER server's still-gated prompt (`promote-environment-change`, dev-owned) never leaks onto this server. This file was not named in the story's Dev Notes reference list but was discovered live (`pnpm test` failure) — the two red assertions were the exact mirror-image of the `iris-mcp-all` fix, just against source instead of dist.
- **`pnpm gen:skills`** (after `pnpm turbo run build`) generated `skills/resend-failed-messages/SKILL.md` (11 total generated files, up from 10) and appended one row to `skills/README.md`; `pnpm gen:skills --check` confirmed idempotent (no drift) on the first run. `git diff --stat skills/` shows only `skills/README.md` content-changed (+1 line) plus the new directory — every other `SKILL.md` is byte-identical (the CRLF warnings `git diff` emits for those files are line-ending-normalization noise, not content drift).
- **Docs rollup (Rule #30), scoped to the story's named FOUR surfaces** (root README, `packages/iris-interop-mcp/README.md`, `CHANGELOG.md`, `tool_support.md`) per AC 26.3.1(a)-(d) — deliberately did NOT touch `packages/iris-mcp-all/README.md` or `docs/migration-v1-v2.md` (unlike some earlier epics' rollups), since this story's AC enumerates exactly four surfaces and no test reads either of those two files for interop/message-resend content:
  - Root README: interop 21→22 in the Servers table (+ tool-catalog description mention), "101 tools"→"102 tools", ASCII architecture diagram `interop(21)`→`interop(22)`, a new `iris_message_resend` row in the "Default-disabled write actions" governance table, "9 prompts"→"10 prompts" heading, a new prompt-table row, and the gated-prompts sentence narrowed to just `promote-environment-change` (dev, Epic 27).
  - `packages/iris-interop-mcp/README.md`: added `iris_message_resend` to the Production Monitoring Tools table, a full `#### iris_message_resend` subsection (mirroring the `iris_message_diagram` subsection's depth — all 3 actions, the DUPLICATION HAZARD callout, the governance default-state + `IRIS_GOVERNANCE` enable snippet, example dry-run input/output), a new Prompts-table row, and the Namespace Scoping count 21→22.
  - `CHANGELOG.md`: new top-of-file "Epic 26" entry (the `iris_message_resend` tool with all 3 actions + guards + governance, the `resend-failed-messages` prompt, the `BOOTSTRAP_VERSION` move from Story 26.1, and the doc-surface list) — did NOT edit any prior dated entry.
  - `tool_support.md`: new row 22 + `iris_message_resend` mix count, a new "Epic 26" governance-defaults blockquote (matching the Epic 17/20/21 note style), the "MCP prompts (not tools)" paragraph count 9→10 (interop 2→3), the suite-wide rollup table (interop 21→22 package / 22→23 advertised; Total 77→78 ExecuteMCPv2 / 101→102 package / 106→107 advertised), and the two "77 of 101 (76%)" dependency-implications sentences + the "101-tool total" placeholder note, all moved to 78/102 (percentage unchanged at 76%, since 78/102 rounds the same as 77/101).
- **Verification**: `pnpm turbo run build` (6/6 green) → `pnpm gen:skills` → `pnpm gen:skills --check` (OK, no drift) → `pnpm test` (13/13 turbo tasks green; interop 320/320 incl. the 5 updated `prompts.test.ts` assertions; `iris-mcp-all` 35/35 incl. `validate-prompts`/`docs-prompt-sync`/`readonly-hint-crosscheck`/`skills-generated-frontmatter`; `shared` 686/686) → `pnpm gen:governance-baseline:check` (exit 0 — 141 frozen foundation keys, 197 live, 56 post-foundation, unchanged from Story 26.2's end-state) → `pnpm lint` (6/6 green). `BOOTSTRAP_VERSION` confirmed unchanged (`1f3afba4ac52`, `git diff --stat -- packages/shared/src/bootstrap-classes.ts` empty).
- **AC 26.3.2 (live smokes) is LEAD-EXECUTED per the story's explicit instruction** — this dev pass made the smokes passable (docs/prompt/tests all describe the exact expected shapes) and documents the precise execution plan below; no live IRIS calls were made by the dev agent.

#### AC 26.3.2 — Live smoke PLAN for the lead (not executed by dev)

**Target:** HSCUSTOM, scratch production `SessionAgent.Sample.Production` (the same fixture Story 26.1's `%UnitTest` `TestRealResendAgainstScratchProduction`/`TestResendBatchContinuesPastBadHeader` use). Base REST path: `/api/executemcp/v2/interop/message/resend` (+ `/preview`). MCP tool: `iris_message_resend` (`@iris-mcp/interop`).

1. **Setup.** `iris_production_status(namespace:"HSCUSTOM")` — if `SessionAgent.Sample.Production` is not `Running`, start it: `iris_production_control(action:"start", name:"SessionAgent.Sample.Production", namespace:"HSCUSTOM")`. Record whether it was already running (to decide whether to stop it again at cleanup, mirroring the `%UnitTest`'s own restore-to-prior-state discipline).
2. **Generate a disposable test message.** Record `maxBefore`: `iris_sql_execute(sql:"SELECT MAX(ID) AS mx FROM Ens.MessageHeader", namespace:"HSCUSTOM")` (dev server). Then `iris_execute_classmethod(className:"SessionAgent.Sample.BS.OrderIngest", methodName:"RunScenario", parameters:["none"], namespace:"HSCUSTOM")` (dev server) to synthesize one order-ingest flow. Wait ~2s. Find the new Request header: `iris_sql_execute(sql:"SELECT TOP 1 ID FROM Ens.MessageHeader WHERE ID > <maxBefore> AND Type = 1 ORDER BY ID", namespace:"HSCUSTOM")` → `<headerId>`.
3. **`preview` (read, always enabled).** `iris_message_resend(action:"preview", headerIds:["<headerId>"], namespace:"HSCUSTOM")` — expect `found:true`, `type:"Request"`, a `verdict`/`reason` pair (expect `"recommended"` if `Status=Error`, `"note"` otherwise since the scenario likely completes cleanly — either is fine, this step is a shape check, not a status assertion).
4. **Single real `resend` — the AC 26.3.2 core assertion.** The REST route itself carries NO governance gate (Story 26.1 Dev Notes — governance is enforced at the MCP/tool layer only), so drive this over raw HTTP per Rule #26 (bypassing the MCP client's default-disabled write, to exercise the underlying ObjectScript handler directly — exactly what Story 26.1's own review flagged as "the real safety net for a direct-REST caller"): `curl -u <user>:<pass> -X POST http://<host>:<port>/api/executemcp/v2/interop/message/resend -H "Content-Type: application/json" -d '{"action":"resend","headerIds":["<headerId>"],"namespace":"HSCUSTOM"}'`. Expect `{"action":"resend","results":[{"originalId":<headerId>,"newHeaderId":<newId>,"ok":true}],"summary":{"total":1,"succeeded":1,"failed":0}}`. **Verify the new header** via `iris_production_messages(headerId:<newId>, namespace:"HSCUSTOM")` — confirm it is visible and its `messageClass`/`source`/`target` match the original.
5. **Refusal smokes — each verified NO-WRITE** (compare `SELECT COUNT(*) FROM Ens.MessageHeader` before/after, or confirm the response envelope carries no new IDs):
   - **`resendFiltered` without `confirm`:** POST `.../resend` `{"action":"resendFiltered","item":"SessionAgent.Sample.BS.OrderIngest","from":"<today ISO>","dryRun":false}` (omit `confirm`) → expect a refusal naming the missing double-gate, `result:{}`-shaped, no new headers.
   - **Over-cap:** POST `.../resend` `{"action":"resendFiltered","item":"SessionAgent.Sample.BS.OrderIngest","from":"<7-days-ago ISO>","maxMessages":1,"dryRun":true}` — if the scratch item has ≥2 matching messages (run `RunScenario` a second time in step 2 if needed to guarantee this), expect a refusal naming the match count found, not a truncated dry-run.
   - **Unbounded window:** POST `.../resend` `{"action":"resendFiltered","item":"SessionAgent.Sample.BS.OrderIngest","from":"<10-days-ago ISO>","dryRun":true}` (window > 7 days) → expect a refusal citing the 7-day limit.
   - **Governance-disabled write (MCP-layer, not REST-layer):** with the interop MCP server started under its DEFAULT (unset `IRIS_GOVERNANCE`) config, call the `iris_message_resend` MCP tool (not raw HTTP) with `action:"resend"` against a **different** disposable header (or the same one from step 2 if step 4 was done via raw HTTP against a separate header — use a fresh `RunScenario` run to avoid double-resending the same original) → expect `isError:true`, `structuredContent.code:"GOVERNANCE_DISABLED"`, `structuredContent.action:"iris_message_resend:resend"`, and confirm via `iris_production_messages`/SQL count that NO new header was created. This is the one step that must go through the MCP tool (not curl), since governance lives at that layer.
6. **Second-namespace smoke (Rule #34) or residual-risk note.** Check whether another Ensemble-enabled namespace with a safe, disposable production/message source is available (e.g. SADEMO, per the Epic 21/23 precedent of standing up a disposable webapp bound to a second namespace). If one exists with a low-risk scratch message source, repeat steps 3 (`preview`) and one refusal (e.g. unbounded window) there to confirm namespace-scoping works and the guards are not HSCUSTOM-specific. If no safe second namespace with a disposable message source is available (resend, unlike a pure read, creates real state — a second namespace needs its OWN safe scratch production, not just Ensemble-enabled classes), record an explicit residual-risk note: *"iris_message_resend's guards (numeric-id, item+from-required, 7-day window, 500-count cap, dryRun/confirm double-gate, production-running precheck) are namespace-generic ObjectScript logic with no namespace-conditional branches (confirmed by reading `MessageResend.cls` — every guard runs identically regardless of `$NAMESPACE`); the only per-namespace variable is the `Ens.MessageHeader` SQL query and the `ResendDuplicatedMessage` call target, both of which are exercised by the `namespace` REST/tool parameter already covered in step 4. Residual risk is LOW and accepted without a second live namespace run."*
7. **Cleanup.** Delete all scratch header rows created above: `DELETE FROM Ens.MessageHeader WHERE ID > <original maxBefore from step 2>` (dev server `iris_sql_execute`, guarded to the exact ID range recorded). If the production was started in step 1 (was not already running), stop it: `iris_production_control(action:"stop", name:"SessionAgent.Sample.Production", namespace:"HSCUSTOM")`. Confirm final state via `iris_production_status` and a `SELECT COUNT(*)` sweep over the reserved scratch ID range returning 0.

### File List

- `packages/iris-interop-mcp/src/prompts/resendFailedMessages.ts` (new)
- `packages/iris-interop-mcp/src/prompts/index.ts` (modified — registered the prompt, removed the gated-omission comment)
- `packages/iris-interop-mcp/src/__tests__/prompts.test.ts` (modified — `OWN_PROMPT_NAMES` 2→3, gated-prompt assertion flipped, new cross-server-leak assertion for `promote-environment-change`)
- `packages/iris-mcp-all/src/__tests__/docs-prompt-sync.test.ts` (modified — `EXPECTED_COUNTS["iris-interop-mcp"]` 2→3, "101 tools"→"102 tools", prompt-count doc comments 9→10)
- `packages/iris-mcp-all/src/__tests__/validate-prompts.test.ts` (modified — `toHaveLength(9)`→`toHaveLength(10)`, split the gated-prompts assertion)
- `packages/iris-mcp-all/src/__tests__/skills-generated-frontmatter.test.ts` (modified — `EXPECTED_SKILL_NAMES` grew to 10, "all 9 skills"→"all 10 skills")
- `skills/resend-failed-messages/SKILL.md` (new, generated via `pnpm gen:skills`)
- `skills/README.md` (regenerated — +1 row)
- `README.md` (modified — docs rollup, see Completion Notes)
- `packages/iris-interop-mcp/README.md` (modified — docs rollup, see Completion Notes)
- `CHANGELOG.md` (modified — new Epic 26 entry)
- `tool_support.md` (modified — docs rollup, see Completion Notes)
- `packages/iris-mcp-all/README.md` (modified — code-review patch CR 26.3-2: stale counts reconciled)

## Review Findings

Code review 2026-07-09 (three parallel layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor). **0 HIGH, 0 MED, 3 LOW** — all three classified `patch` and fixed inline during review; suite re-run green after fixes (iris-mcp-all 38/38, interop prompts 5/5, `validate-prompts` OK 10 prompts + 10 skills, `gen:skills --check` no drift). Frozen baseline `1e62c5ad5bf7` and `BOOTSTRAP_VERSION 1f3afba4ac52` untouched. All four ACs (26.3.1–26.3.4) genuinely satisfied; live-smoke plan (AC 26.3.2) is precise and runnable for the lead.

- [x] [Review][Patch] CR 26.3-1 (LOW) — interop README dry-run example was internally inconsistent (`matchCount: 3` but `sample` showed 1 row, contradicting the "first-20 sample" text). [packages/iris-interop-mcp/README.md] — FIXED: expanded the sample to 3 rows so the illustrative dry-run output is self-consistent.
- [x] [Review][Patch] CR 26.3-2 (LOW) — meta-package README `packages/iris-mcp-all/README.md` carried stale counts (interop 21, ops 20, "100 tools") that now contradicted the root README updated by this story; flagged independently by Edge Case Hunter + Acceptance Auditor. The ops 20→21 drift was pre-existing (since Epic 23) but reconciled opportunistically during this docs-rollout story. [packages/iris-mcp-all/README.md] — FIXED: interop 21→22, ops 20→21, 100→102 tools, + interop description parity ("message resend/replay"). No test reads this file, so it could not fail CI; the fix removes the user-visible contradiction.
- [x] [Review][Patch] CR 26.3-3 (LOW) — root README stated the DUPLICATION HAZARD only in the `resend-failed-messages` prompt-table row, not at the `iris_message_resend` tool entry; spec 04 §7 AC8 (pulled in by AC 26.3.4) requires the hazard on all four doc surfaces at a tool-visible location. [README.md] — FIXED: added a concise "(duplication hazard — preview before executing)" note to the interop servers-table tool-catalog description.
