---
title: 'Story 41.2: Always-On ObjectScript Pre-Write Rule'
type: 'feature'
created: '2026-10-19'
status: 'done'
baseline_revision: '751b736f0583f7f0c8b3afa41f63f2d8946aad86'
baseline_commit: '751b736f0583f7f0c8b3afa41f63f2d8946aad86'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings:
  - oversized
deferred: []
---

<intent-contract>

## Intent

**Problem:** Today the pre-write checklist reaches agents only as the `objectscript-review` MCP prompt. A user has to invoke the prompt, so the checklist is never in context when an agent writes a class through `iris_doc_put` or `iris_doc_edit`. Its claims were never verified live, and several are wrong or name project internals. The pack has no always-on rule, and 41.6's installer has no defined `AGENTS.md` block to insert.

**Approach:**

- **One source.** Write one hand-authored, probe-verified checklist: `skills-pack-src/rules/iris-mcp-objectscript-pre-write.md`. It is at most 300 words, has no frontmatter and names no tool.
- **Two forms.** `gen:pack` emits it twice:
  - `rules/claude-code/iris-mcp-objectscript-pre-write.md` holds the source bytes, as the Claude Code rule.
  - `rules/agents-md/iris-mcp-objectscript-pre-write.md` holds the same bytes between two stable marker lines, as the `AGENTS.md` section.
- **Retire the prompt.** Retire `objectscript-review` and its generated skill, as AD-15 sanctions, so the rule is the only copy of the checklist (decision 1).

## Boundaries & Constraints

**Always:**

- **One source.** The checklist text lives only in the rule source.
  - Both pack forms come from it through `gen:pack`.
  - No prompt, skill or doc holds a second copy.
- **Verified claims.** Every factual claim in the rule matches a row of the probe log in Design Notes, verified on IRIS 2026.2 Build 221U.
  - Probe any new or reworded claim before it lands. Use disposable `ExecuteMCPv2.Temp.Probe412*` classes on `server:"default"`, `namespace:"HSCUSTOM"`.
  - Delete the probe classes before the stage returns. `iris_doc_list filter:"Probe412" generated:true` must return `[]`.
- **User-facing wording.** The rule names nothing internal:
  - no internal rule number, DW or AD id, or repository path;
  - no project class (`ExecuteMCPv2.*`, `SanitizeError`);
  - no `iris_*` token. The rule is tool-agnostic, so it needs no preset declaration.
- **Text discipline.**
  - The rule source is ASCII, LF line endings, with a final LF (Rule 14). Write non-ASCII in `.mjs`/`.ts` as escapes.
  - Write file content with the file tools, never through a shell heredoc (#55).
- **Byte-exact forms.** Build both forms from `Buffer`s:
  - the `claude-code` form is the source bytes;
  - the body of the `agents-md` form is the source bytes.
- **Generated files (AD-14).** `skills/` changes only through `gen:skills`, and the pack only through `gen:pack`.
- **Shared logic (AD-2).** The logic lives in `scripts/lib/skills-pack.mjs`, which `gen-pack.mjs` and the tests share.

**Never:**

- **Frontmatter.** No frontmatter of any kind (so no `paths:`) in the rule source or in either form.
- **Other surfaces.** Change no tool, action, governance key, preset, refusal code, route or bootstrapped class.
  - The other 12 prompts keep their names, titles, arguments and bodies.
- **Other stories' scope.** No installer code (41.6), no catalog (41.5), no pack-wide internal-reference or preset checks (41.5), no plugin (42.8).
- **Files this story must not edit:**
  - The repository's own `.claude/rules/*`, `CLAUDE.md`, the spine, `epics.md`, `irislib/` and `irissys/`. The live check's throwaway project lives in the scratchpad. The lead applies the drafted spine and epics text, and the source-rule corrections go to the retro.
  - The installer-managed `.claude/skills/bmad-*` files.
- **IRIS.**
  - No HSCUSTOM global writes, `^ClineDebug` included.
  - Never stop or restart IRIS, and never start a production.
  - Never target an `ocupilot-slot-*` profile.
- **Git.** No `git commit`, `git push`, `git reset` or `git rebase`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Real tree | The committed rule source | `gen:pack` writes both forms. A second run changes nothing. `gen:pack:check` reports `16 pack file(s)` | No error expected |
| Tarball (Integration) | `npm pack --dry-run --json --ignore-scripts --offline` in `packages/client-config` | It lists `skills-pack/rules/claude-code/iris-mcp-objectscript-pre-write.md` and `skills-pack/rules/agents-md/iris-mcp-objectscript-pre-write.md`, and nothing under `skills-pack/skills/objectscript-review/` | The provenance check names a pack file missing from the tarball |
| Validator (Integration) | `pnpm validate:prompts` | `39 source(s) checked (12 prompt(s) + 27 content file(s): 12 workflow, 14 pack, 0 knowledge, 1 rule)` | Exit 1 names a bad token per file |
| Section form | Source bytes `S`, stem `n` | `<!-- IRIS-MCP-RULE:n:BEGIN -->\n` + `S` + `<!-- IRIS-MCP-RULE:n:END -->\n` | No error expected |
| No final newline | `S` lacks a final LF | The `claude-code` form is `S`. The `agents-md` form gets one `\n` between `S` and the END line | No error expected |
| Byte variants (#58) | CRLF, BOM, non-ASCII and invalid UTF-8 sources in a temp root | The `claude-code` form is a byte-identical `Buffer`, and so are the `agents-md` bytes between the marker lines | No error expected |
| Frontmatter | The source's first line, after an optional BOM, is `---` (for example `paths: ["**/*.cls"]`) | `gen:pack` exits 1: `skills-pack-src/rules/<f> has frontmatter; an always-on rule takes none (no paths:)` | Nothing is written |
| Unknown rule entry | Under `skills-pack-src/rules/`: a subdirectory, a non-`.md` file, or a name not matching `^[a-z0-9]+(-[a-z0-9]+)*\.md$` | `gen:pack` exits 1, naming the entry | Nothing is written |
| Prompt retired (Integration) | A real SDK `Client` on the dev dist server | `listPrompts` returns `diagnose-slow-query`, `deploy-and-test-class`, `promote-environment-change` and `edit-and-test-class`, in that order. `getPrompt({name:"objectscript-review"})` fails with -32602, naming the prompt | -32602 |
| Generated skills | After the retirement | `skills/objectscript-review/` and its pack copy are gone. `skills/README.md` has 12 rows. `gen:skills:check` reports `13 generated file(s)` | No error expected |
| Bad rule text | The rule holds `Rule #7`, `DW-1`, `AD-28`, `packages/`, `ExecuteMCPv2`, `SanitizeError` or an `iris_` token, or has more than 300 words | The rule test fails, naming the match or the count | The test goes red |

</intent-contract>

## Code Map

**Pack build** (`scripts/`):

- `scripts/lib/skills-pack.mjs` -- the one place to extend.
  - `:1-16` is the module comment ("renders nothing except the pack README"), and `:24` is `RULES_SOURCE_DIR`.
  - `:88-169` is `assemblePack`. The rules mapping at `:157-159` is a placeholder byte copy of `rules/**`; this story replaces it.
  - Reuse the unknown-entry style (`:95-110`, `:149-155`) and the collision guard `add` (`:116-123`).
  - `:183-216` is `listAgentContentFiles`, which stays unchanged. It walks the pack's `rules/` recursively, so the two forms are labelled `pack:rules/claude-code/<f>` and `pack:rules/agents-md/<f>`, and the source `rule:<f>`.
- `scripts/gen-pack.mjs:46,66,71` -- check, OK line and write. Unchanged. `scripts/lib/generated-tree.mjs` stays unchanged too (41.1 seam).
- `scripts/lib/validate-prompts-core.mjs` -- `extractIrisTokens`, reused for the rule's no-tool pin.

**The prompt being retired** (decision 1):

- `packages/iris-dev-mcp/src/prompts/objectscriptReview.ts` -- delete.
- `packages/iris-dev-mcp/src/prompts/index.ts:12` (import) and `:18-24` (the array).
- `packages/iris-dev-mcp/package.json` -- `build` is `tsc --project`, which never deletes outputs. A stale `dist/prompts/objectscriptReview.js` would ship in dev's tarball unless `dist/` is cleaned.
- Comments naming it as the no-argument example: `packages/shared/src/server-base.ts:1020` and `packages/shared/src/__tests__/prompts-guardrails.test.ts:140`.
- Generated copies: `skills/objectscript-review/SKILL.md` and `skills/README.md:25` (gen:skills), and `packages/client-config/skills-pack/skills/objectscript-review/SKILL.md` (gen:pack).

**Tests that pin the prompt or the counts** (all under `packages/iris-mcp-all/src/__tests__/` unless a path says otherwise):

- `packages/iris-dev-mcp/src/__tests__/prompts.test.ts:35,95-99` -- the dev name list, sorted, 5 names.
- Foreign-name lists, which assert the name is absent: `packages/iris-interop-mcp/src/__tests__/prompts.test.ts:69`, `packages/iris-ops-mcp/src/__tests__/prompts.test.ts:32` and `packages/iris-admin-mcp/src/__tests__/prompts.test.ts:38`.
- `story-38-6-qa-edit-prompt-sdk-wire.test.ts`:
  - `:44` is `DEV_PROMPT_NAMES`, and `:166-170` checks it in order under the title "five dev prompts";
  - `:264-265` is the happy-path no-arguments `getPrompt` (Rule #46).
  
  After the retirement, Rule #46 stays covered by the dev refusal at `:239` and by interop's happy-path omitted-arguments call at `story-39-6-qa-forensics-prompts-sdk-wire.test.ts:362`.
- `prompt-safety-invariants.test.ts:306-344` -- the objectscript-review word cap (counter at `:320-323`) and the marker list. These move to the rule test.
- `validate-prompts.test.ts:112,202-203` -- 13 prompts and 13 workflow files.
- `skills-generated-frontmatter.test.ts:46` (names), `:80-86` (directories) and `:119-128` (README).
- `docs-prompt-sync.test.ts:48-53` -- `EXPECTED_COUNTS` has dev at 5. `:149-157` checks `\b${prompts.length}\s+prompts\b` in the README (it derives the count, so the README must say "12 prompts"), and `:159-189` reads tool_support's first `` `dev` N ``.
- Doc-claims literals:
  - `story-38-6-doc-claims.test.ts:289,303` and `story-39-6-doc-claims.test.ts:263,441,445`;
  - the heading `### The v1 pack . 13 prompts …`;
  - the text `a pack of 13 **MCP prompts** (`ops` 2, `dev` 5, …)`.
- Workflow-directory counts: `skills-pack.test.ts:291`, `pack-provenance.test.ts:582` and `story-41-1-qa-pack-tarball.test.ts:112` (13).
- `story-41-1-qa-validate-prompts-pack.test.ts:52,142` -- validator OK lines. `:60` stays at 39.
- `story-41-1-qa-pack-scratch-cli.test.ts:134,278,313,338` -- pack and gen-skills file counts.
- `story-41-1-qa-provenance-cli.test.ts:99,105,111` -- agent-file counts.

**41.1 fixtures that assume the placeholder rules byte copy** (move them to the two-form shape):

- `skills-pack.test.ts:56-66,112,135-138,204-214`. Of these, `:57`'s nested `rules/nested/form.md` becomes a refusal case.
- `story-41-1-qa-pack-scratch-cli.test.ts:263-274,306,342`.
- `story-41-1-qa-validate-prompts-pack.test.ts:124-126,138-142`.
- These stay valid as written: `validate-prompts.test.ts:145-167` (files placed directly in the pack's `rules/`) and `:211-217` (a source rule label).

**Docs:**

- `README.md:806` -- the heading "13 prompts". `:813` is the dev row.
- `packages/iris-dev-mcp/README.md:260-269` -- the Prompts table, with the row at `:267`.
- `tool_support.md:450` -- the only per-server tally line.
- `skills-pack-src/README.md:10` -- the rules row. `:52` is the validator line.
- `CHANGELOG.md:5` -- the newest heading format. No section has used `### Removed` yet.
- `.changeset/story-41-1-skills-pack-layout.md` -- the naming precedent.

**Precedents:**

- Markers: `packages/client-config/scripts/render-certification-table.mjs:32-35`, with `splice()` at `:201-209`.
- The `%UnitTest` constructor and macros: `irislib/%UnitTest/TestCase.cls:86` and `irislib/%outUnitTest.inc:6-31`.

## Tasks & Acceptance

**Execution:**

- `skills-pack-src/rules/iris-mcp-objectscript-pre-write.md` -- NEW: the golden rule text in Design Notes, byte for byte (ASCII, LF, a final LF, no frontmatter). Any rewording follows the probe discipline in Always -- AC 41.2.1, 41.2.4.
- `scripts/lib/skills-pack.mjs` -- extend `assemblePack`. Replace `:157-159` with the two-form rendering:
  - **New exports:**
    - `RULE_FORM_DIRS = { claudeCode: 'rules/claude-code', agentsMd: 'rules/agents-md' }`;
    - `RULE_SOURCE_NAME` (the matrix regex);
    - `ALWAYS_ON_RULE_FILENAME = 'iris-mcp-objectscript-pre-write.md'`;
    - `agentsMdMarkers(stem) -> {begin, end}`;
    - `renderAgentsMdSection(stem, bytes) -> Buffer`, built with `Buffer.concat`.
  - **Refusals:** each entry of the rules source must be a regular file matching `RULE_SOURCE_NAME` and must have no frontmatter. Otherwise throw the matrix messages.
  - **Comments:** update the module and `assemblePack` doc comments, stating the contract only.
  
  The rule is AD-28's (decision 2).
- `skills-pack-src/README.md` -- the rules row becomes "`rules/<name>.md`, one flat file per rule, no frontmatter → `rules/claude-code/<name>.md` and `rules/agents-md/<name>.md`". Add one paragraph on the marker lines -- contributor doc.
- `packages/iris-dev-mcp/src/prompts/objectscriptReview.ts` -- DELETE. In `packages/iris-dev-mcp/src/prompts/index.ts`, drop the import and the array entry -- AC 41.2.2 (decision 1).
- `packages/shared/src/server-base.ts:1020`, `packages/shared/src/__tests__/prompts-guardrails.test.ts:140` -- reword the comments so they no longer name a retired prompt.
- Clean rebuild of dev: delete `packages/iris-dev-mcp/dist` and `packages/iris-dev-mcp/tsconfig.tsbuildinfo`, then run `pnpm --filter @iris-mcp/dev build`. Then run `pnpm gen:skills`, which deletes `skills/objectscript-review/` and re-renders `skills/README.md`, and then `pnpm gen:pack`. The generated output is part of the story's diff; the stage itself never runs `git commit` -- AD-14, no stale dist file.
- `packages/iris-mcp-all/src/__tests__/skills-pack-rule.test.ts` -- NEW, default suite:
  - **Real tree, both forms against the source:**
    - the `claude-code` form equals the source bytes;
    - the `agents-md` form equals BEGIN + source + END, with the markers typed literally in the test as the oracle;
    - neither form starts with `---`, and `/^paths\s*:/m` does not match.
  - **Real tree, the rule text:**
    - the word count is at most 300, using the counter moved from `prompt-safety-invariants.test.ts:320-323`;
    - the internal-reference scan finds nothing (`/\bRule #\d+/i`, `/\bDW-\d+/`, `/\bAD-\d+/`, `packages/`, `src/`, `.claude/`, `_bmad`, `ExecuteMCPv2`, `SanitizeError`);
    - `extractIrisTokens` returns `[]`;
    - there are exactly 16 bullets, and each probe-row anchor in Design Notes appears.
  - **Fixtures, in a temp root:** the section-form, no-final-newline, byte-variant, frontmatter and unknown-entry rows, each driven through `assemblePack` and through the real `node scripts/gen-pack.mjs` CLI -- AC 41.2.1 and 41.2.3.
  - **Reuse, don't copy (Rule 2):**
    - `pack-fixture.ts` (`makeTempRoot`, `put`, `runNode`) for `assemblePack` fixtures;
    - `story-41-1-qa-fixture.ts` (`makeScratchRepo`, `runScript`, `toCrlf`, `BOM`) for the CLI cases on a scratch copy of the repository.

    The real tree is never written.
- Existing tests -- update every pin in the Code Map to the new shape and counts. The expected values come from the CLI output and are cross-checked by hand derivation (#51). Search every `packages/*/src/__tests__/` tree for `objectscript-review`, `RULES_SOURCE_DIR`, `rules/`, `toHaveLength(13)`, `13 prompt`, `` `dev` 5 `` and `pack file(s)` (Rule 19). Remove the objectscript-review block of `prompt-safety-invariants.test.ts`; its word guard and markers live in the new test.
- `README.md`, `packages/iris-dev-mcp/README.md`, `tool_support.md`:
  - delete the two `objectscript-review` rows;
  - make the heading "12 prompts" and the tally "a pack of 12 **MCP prompts** (`ops` 2, `dev` 4, `interop` 4, `admin` 2; `data` none in v1)";
  - add one sentence in the root README and the dev README: "`objectscript-review` was retired in Story 41.2: its checklist is now the always-on rule in the skills pack (`rules/claude-code/` for Claude Code, `rules/agents-md/` for `AGENTS.md`). The installer arrives in Story 41.6."
  
  This is the minimal docs that #43 requires.
- `CHANGELOG.md` -- add a top section titled `## [Pre-release — YYYY-MM-DD] — Story 41.2: Always-on ObjectScript pre-write rule`, dated the UTC day the stage writes it.
  - `### Added`: the rule, its two forms, the markers and the build refusals.
  - `### Removed`: the `objectscript-review` prompt and its generated skill, with the reason (decision 1, AD-15 sanctioned).
  - `### Tests` and `### Known limits`: no installer until 41.6; the live check covers the Claude Code form only.
  - It also says that `BOOTSTRAP_VERSION` stays at `5296a1c836f4`, that the tool count stays at 110 package / 115 advertised, and that prompts go from 13 to 12.
- `.changeset/story-41-2-objectscript-pre-write-rule.md` -- NEW: `"@iris-mcp/dev": minor` (a prompt is removed) and `"@iris-mcp/client-config": minor` (the pack gains the rule forms) -- AD-29.
- The live check -- run the Design Notes procedure once, then record the commands (with no secrets), the CLI version, the hook-log excerpts, `total_cost_usd` and the cleanup result under `## Verification` -- AC 41.2.5 (decision 3).

**Acceptance Criteria:**

- **The checklist content (AC 41.2.1).** Given the committed rule source, when `skills-pack-rule.test.ts` runs, then:
  - the word count is at most 300;
  - the internal-reference and `iris_*` scans are empty;
  - all 16 bullets and their probe anchors are present;
  - the source is ASCII with a final LF.
- **The retirement (AC 41.2.2).** Given the clean-built dev server, when a real SDK `Client` lists and gets prompts, then the four remaining dev prompts are listed in order, and `objectscript-review` fails with -32602. Also:
  - `skills/objectscript-review/` and the pack copy are absent;
  - `packages/iris-dev-mcp/dist/prompts/` has no `objectscriptReview.*`, and dev's `npm pack --dry-run` lists none;
  - `validate:prompts` counts 12 prompts;
  - the CHANGELOG's `### Removed` names the prompt, Story 41.2 and the reason;
  - `rg -n objectscript-review` outside `_bmad-output/`, `CHANGELOG.md`'s older sections and `.changeset/epic35-defect-gate.md` finds only the retirement notes.
- **The two forms (AC 41.2.3).** Given the tree, when `pnpm gen:pack` runs twice, then:
  - the second run changes nothing;
  - the `claude-code` form equals the source bytes and has no frontmatter;
  - the first line of the `agents-md` form is `<!-- IRIS-MCP-RULE:iris-mcp-objectscript-pre-write:BEGIN -->`, its last line is `<!-- IRIS-MCP-RULE:iris-mcp-objectscript-pre-write:END -->`, and the bytes between them equal the source;
  - client-config's dry-run tarball lists both forms.
- **The probes (AC 41.2.4).** Given the probe log in Design Notes, when the reviewer maps each rule bullet to its row, then:
  - every bullet has a row whose verdict is "holds";
  - the probe leftovers are `[]`;
  - the corrections to source rules are listed for the retro.
- **The live check (AC 41.2.5).** Given the docs re-check recorded in Design Notes (URL, date, quotes), when the live procedure runs, then:
  - the positive leg's hook log shows `InstructionsLoaded` for `.claude/rules/iris-mcp-objectscript-pre-write.md` with `load_reason` `session_start`, a `PreToolUse` for `mcp__iris-dev__iris_doc_put` in the same session, and no `Read`, `Write`, `Edit` or `Bash` call;
  - the contrast leg (a `paths:`-scoped copy) shows no `InstructionsLoaded` for the rule while `iris_doc_put` still runs;
  - if neither leg logs any `InstructionsLoaded` line (the hook does not fire under `-p`), the fallback quote oracle in Design Notes decides instead, and the record says so;
  - `ExecuteMCPv2.Temp.Probe412Live` is deleted, and the leftovers are `[]`.
- **Unchanged counts.** Given the suite, when the `(once)` checks run, then:
  - `gen:governance-baseline:check` reports `1e62c5ad5bf7`/141;
  - `gen:tools-list-snapshot:check` reports no drift (it pins tools only);
  - the tool counts stay at 110 package / 115 advertised;
  - `git diff --stat packages/shared/src/bootstrap-classes.ts` is empty.

### Review Findings

Code review 2026-10-19 (`bmad-code-review`, review tier full-opus; layers: Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor; all four delivered). 27 raw rows, grouped into 15 entries (high 0, medium 3, low 12), plus 6 rejected.

- [x] [Review][Patch] A rule body holding a marker line made an `agents-md` section an exact-line reader finds ambiguous, and QA's two rows pinned that as the contract. Fix: `gen:pack` now refuses a rule source with any line that starts with `<!-- IRIS-MCP-RULE:`, and the two rows are refusal rows (low; fix-risk low: one refusal branch plus its rows; Rule 15 two-way door) [scripts/lib/skills-pack.mjs:230]
- [x] [Review][Patch] `outsideIsUntouched` is true by construction (it compares the two slices `replaceBlock` just copied), so the "changes no byte outside it" rows could not fail (low; fix-risk low: delete the helper and its two calls, and retitle the rows) [packages/iris-mcp-all/src/__tests__/story-41-2-qa-agents-md-consumer.test.ts:220]
- [x] [Review][Patch] The unknown-rule message says "(lowercase letters, digits and hyphens)" while it refuses `double--hyphen.md`, `-lead.md` and `trail-.md`, and the 41.1 row title still says "lower-case words joined by hyphens" (low; fix-risk low: wording only) [scripts/lib/skills-pack.mjs:225]
- [x] [Review][Patch] The retirement sweep reads less than AC 41.2.2's `rg` does (no `docs/`, `scripts/`, `extensions/`, `ipm/`, `.changeset/`, package `scripts/` or `package.json`), and its `tool_support.md` exemption hid any other mention on that one-line paragraph (low; fix-risk low: more walks, and remove the note text before matching) [packages/iris-mcp-all/src/__tests__/story-41-2-doc-claims.test.ts:131]
- [x] [Review][Patch] Dev's `npm pack --dry-run` ran in an `it` bounded by the 20 s default while `runNpmPack` allows 120 s and the sibling tarball test gives it 120 s (low; fix-risk low: one timeout argument; measured 0.33 s today) [packages/iris-mcp-all/src/__tests__/story-41-2-qa-prompts-stdio-wire.test.ts:266]
- [x] [Review][Patch] Rule 19 hermeticity: "is clean again after the refusals" checks other rows' leftovers, so its meaning depends on run order, and QA's two marker rows left their sources in the shared scratch for the row after them (medium; fix-risk low: the clean-again row seeds, refuses and removes its own inputs, and the marker rows clean up in `finally`) [packages/iris-mcp-all/src/__tests__/skills-pack-rule.test.ts:469]
- [x] [Review][Patch] The Story 41.2 CHANGELOG section did not name QA's three test files, and its build refusals did not include the new marker-line refusal (low; fix-risk low: docs) [CHANGELOG.md:20]
- [x] [Review][Patch] Rule 19: three AC pins had no `mutation:` line (AC 41.2.3 "the tarball lists both forms" and "a second run changes nothing", and "Unchanged counts"). Closed in this pass with M28, M29, M30 and M30b under `## Verification`, "Code-review pass" (low; fix-risk low) [_bmad-output/implementation-artifacts/spec-41-2-always-on-objectscript-pre-write-rule.md:604]
- [x] [Review][Defer] The 41.6 installer has no owner for the `AGENTS.md` marker-reading contract defined here: report a missing or repeated own marker and never guess; a BOM before line 1; end the last line before appending. The consumer test's reader rows run only a test-local reader [packages/iris-mcp-all/src/__tests__/story-41-2-qa-agents-md-consumer.test.ts:78] — deferred: DW-616 `routed owner=41-6-skills-and-rules-installer` (medium, in-epic, fix-risk low). The lead inserts its DW bullet under Story 41.6 (Rule 17 (1b))
- [x] [Review][Defer] A `prompts/get` that omits `arguments` is refused with -32602 for the four prompts whose arguments are all optional. After the retirement, no shipped prompt renders from that request, and the 39.6 and 41.2 wire tests accept either outcome [packages/shared/src/server-base.ts:1103] — deferred: pre-existing (CR 25.1-6 closed it as an SDK v1 limitation). DW-617 `routed owner=43-1-framework-migration-to-sdk-v2` (medium, out-of-footprint, fix-risk med). 43.1 rewrites prompt registration (AC 43.1.1) and pins `prompts/get` (AC 43.1.3), so the cost reason behind the closure no longer holds there. The lead or orchestrator inserts the DW bullet under Story 43.1
- [x] [Review][Defer] `.changeset/epic35-defect-gate.md:11` still names the retired prompt in a wording fix [.changeset/epic35-defect-gate.md:11] — deferred: DW-618 `by-design` (AC 41.2.2 exempts this file; it records a true Epic 35 change)
- [x] [Review][Defer] A Finder `.DS_Store` (gitignored) in `skills-pack-src/rules/` makes `gen:pack` exit 1 [scripts/lib/skills-pack.mjs:218] — deferred: DW-619 `by-design` (the matrix row "Unknown rule entry" refuses any non-`.md` file, and the message names it)
- [x] [Review][Defer] The typed-out section oracle is written three times (Rule 2, weak reason) [packages/iris-mcp-all/src/__tests__/skills-pack-rule.test.ts:231] — deferred: DW-620 `wontfix-accepted` (about 40 lines across four files, not a two-way door)
- [x] [Review][Defer] The changeset check skips when the changeset is missing, a shared doc-claims precedent [packages/iris-mcp-all/src/__tests__/story-41-2-doc-claims.test.ts:92] — deferred: DW-621 `wontfix-accepted` (cross-cutting, 10 files)
- [x] [Review][Defer] `validate-prompts.test.ts:146,168` and `pack-provenance.test.ts:208,216,250` keep the flat `rules/<f>` packRel that the pack no longer has [packages/iris-mcp-all/src/__tests__/validate-prompts.test.ts:168] — deferred: occurrence on DW-614 (the same root cause; the Code Map keeps these fixtures)

All 8 patches were applied and verified: `@iris-mcp/all` 111 files (2363 passed, 4 skipped) in three calls; `gen:pack:check` 16, `gen:skills:check` 13, `validate:prompts` 39 sources, `check:provenance` 27 agent files, and both governance and tools-list checks OK. Outcome: CLEAN, story `done`. The two MEDs DW-616 and DW-617 are routed with owners and do not block.

**Rejected** (one line each):

- low: an empty or whitespace-only rule source is accepted. Theoretical: the real rule's content tests require words and 16 bullets, no second rule is planned, and the fix adds a guard.
- low: the content checks (size, internal references, `iris_*` tokens) read only the always-on rule. No second rule is planned. `validate:prompts` checks tool names in every rule source, 41.5 owns the pack-wide internal-reference check, and the new marker guard covers every rule.
- low: no documented manual install of the rule until 41.6. Nothing publishes before Epic 42 (AD-29), and AC 41.7.1 owns the pack docs.
- low: bullet 3's "so the class does not compile" for a class name, which P3 shows is refused at save. The instruction is right, and a refused class never compiles. A rewording would have to fit the 299/300-word budget again.
- false: `expect(refusedCount).toBeGreaterThanOrEqual(requiredCount)` cannot fail on its own. The property is pinned by the in-loop `expect(hasRequired).toBe(false)`.
- spec edit: amend Code Map line 116 (the 39.6 call accepts either outcome) and record the sweep's narrowing. The fix edits the spec under review; Residual risks already record the weaker claim, and the sweep is widened above.

## Spec Change Log

- **2026-10-19, lead spec gate.** Wave-7 decisions #4, #5 and #6 were taken as recommended (Design Notes). Applied:
  - **Spine (Rule 20).** AD-28's Sources and Shape bullets, plus a rule-source bullet. AD-15's sanctioned list now says the retirement happened. The conventions table gains "Marked blocks".
  - **`epics.md`.** AC 41.5.1 now reads "the 12 prompts that remain after Story 41.2 retired `objectscript-review`", marked `[AMENDED 2026-10-19]`.
  - **Constraints on the live check (decision #6).** It runs only in the stage's scratchpad project, never in the repository. Its only write is `ExecuteMCPv2.Temp.Probe412Live`. The copied credentials are deleted with the directory, and the recorded `total_cost_usd` must stay within the USD 1 cap per session.

## Review Triage Log

### 2026-10-19 — Review pass
- verdicts: 29 findings — high 0, medium 4, low 18, false 7, maybe-false 0
- findings:
  - Blind Hunter
    - `[low]` `[patch]` The generated pack README still said "`rules/`: the always-on rule, in the forms each client reads" and never named the two form directories or the markers — `renderPackReadme` now names `rules/claude-code/<name>.md` and `rules/agents-md/<name>.md` with the marker lines, and the pack was regenerated.
    - `[low]` `[reject]` No guard against a rule source that holds its own marker line — a maintainer-authored, single reviewed rule; the guard is a new refusal branch beyond a direct correction, and the 41.6 installer must treat duplicate or nested markers in a user's hand-edited `AGENTS.md` defensively in any case. Grouped with the Edge Case Hunter and verification-gap sightings.
    - `[false]` `[reject]` The `agents-md` form embeds BOM, invalid UTF-8 and CRLF bytes unchanged — the matrix row "Byte variants (#58)" requires byte-identical bytes between the marker lines, and the real rule is ASCII with LF endings (pinned).
    - `[low]` `[reject]` The "no stale build output" test reads `dist/prompts` unguarded and is a proxy for dev's tarball — a missing build fails loudly like every other dist-reading test of the package (the spec requires built dists); dev's `npm pack --dry-run` was run in the `(loop)` verification and lists no `objectscriptReview` file.
    - `[low]` `[reject]` The 300-word cap passes by one word under the alphanumeric-token counter — the counter is the retired prompt's own (the spec's AC interpretation: the golden text is 299), and a later addition tripping the cap is the intended behavior.
    - `[medium]` `[patch]` The retired prompt's `getPrompt({name})` call was the only Client-level render of a prompt that declares no arguments — `story-38-6-qa-edit-prompt-sdk-wire.test.ts` gained a fixture zero-argument prompt on the real built `McpServerBase` (mutation M19).
    - `[low]` `[patch]` `tool_support.md` changed the counts without saying a prompt was removed — one retirement sentence added to its prompt tally paragraph and pinned in `story-41-2-doc-claims.test.ts`.
    - `[low]` `[patch]` The CHANGELOG described the rule-name pattern as "lower-case words joined by hyphens" while the pattern also admits digits — reworded to "lower-case letters, digits and single hyphens". The changeset does not state the pattern.
  - Edge Case Hunter
    - `[low]` `[reject]` Marker line inside a rule source — same root cause as the Blind Hunter row above.
    - `[low]` `[reject]` `listAgentContentFiles` keeps `packRel: rules/<f>` for a `rule:` source, so an adapted rule could never satisfy `check:provenance` — no rule is adapted or planned (the epic adapts skills only), the spec leaves `listAgentContentFiles` unchanged, and the fix needs a header-placement decision for the `agents-md` form. Recorded as a residual risk for any future story that adapts a rule.
    - `[low]` `[reject]` Unguarded `readdirSync(dist/prompts)` and a build script that never cleans `dist` — same as the Blind Hunter dist row; changing the dev build script is outside the story, and the spec prescribes the clean rebuild and this test.
    - `[medium]` `[patch]` Lost Client-level coverage of a zero-argument prompt — same root cause as the Blind Hunter row (fixture case, mutation M19).
    - `[false]` `[reject]` The deleted checklist bullets (`%`/`_` prefixes, `///` against `//`, validate before switching to `%SYS`) have no counterpart — the probe log and "Flagged for the retro" settle each: the `//` advice is false, the `%` rule is a convention, and the `%SYS` advice is project-internal.
    - `[low]` `[patch]` The CHANGELOG claimed its negative controls show "each content check" can fail while only the size, internal-reference and tool-name checks have them — reworded; the anchor and ASCII checks now carry mutations M14 and M15.
  - Verification Gap
    - `[medium]` `[patch]` Two AC 41.2.2 bullets (the CHANGELOG `### Removed` text; the name found only in retirement notes) had no pinning test — `story-41-2-doc-claims.test.ts` added (mutations M16 to M18).
    - `[low]` `[patch]` Pinning tests with no `mutation:` line (probe anchors, ASCII and final LF, generated-copy absence, the final-LF branch, the BEGIN line, the form directories) — mutations M10 to M16 applied, observed red and recorded above.
    - `[low]` `[patch]` `startsWith("---")` on the `agents-md` form is false by construction — the assertion skips the BEGIN line for that form (mutation M13).
    - `[low]` `[reject]` The dev `dist` dependency of the stale-output test breaks "passes on a fresh environment" — a fresh environment is built by the project's recipe; same as the Blind Hunter dist row.
    - `[low]` `[reject]` "is clean again after the refusals" is order-dependent and its `finally` assertions can mask a primary failure — the test is green on its own and goes red only when an earlier case leaks, which is its purpose; the masking is cosmetic.
    - `[medium]` `[patch]` No real-SDK happy path for a zero-argument prompt remains — same root cause as the Blind Hunter row (fixture case, mutation M19).
    - `[low]` `[reject]` `assemblePack` does not refuse a source that already holds a marker line — same root cause as the Blind Hunter row.
  - Intent Alignment (descriptive; divergences logged as rows)
    - `[false]` `[reject]` The always-on effect lives at the client surface, the diff pins bytes — the live check (AC 41.2.5) is the loading evidence and is recorded above (hook oracle, both legs); the `AGENTS.md` effect is Story 41.6's and the CHANGELOG's Known limits say so.
    - `[false]` `[reject]` The marker contract is pinned on the producer side only — the first consumer is Story 41.6 (Design Notes, Consumed-by); the producer is pinned against typed-out literals.
    - `[low]` `[reject]` Two claims have no probe row of their own ("`_` is the concatenation operator", "`Quit` a variable after the block") — language facts that rows P3, P5 and P6 bracket; a probe would add no information.
    - `[false]` `[reject]` The word budget holds only under one counter — spec-bound, same as the Blind Hunter word-cap row.
    - `[low]` `[reject]` Dev's `npm pack --dry-run` listing is not asserted by a test (the `dist` listing stands in) — dev ships `files: ["dist"]`, so the listing is exact, and the command was run in the `(loop)` verification.
    - `[false]` `[reject]` Matrix rows "Real tree" are tested through scratch copies — the spec says the real tree is never written; committed bytes are compared on the real tree and `--check` was run on it.
    - `[false]` `[reject]` The provenance fixtures were renamed from `objectscript-review` to `objectscript-style` — they are synthetic upstream-shaped paths, and the rename is what makes AC 41.2.2's `rg` sweep hold.
    - `[low]` `[patch]` The generated pack README layout line was unchanged — same root cause as the first Blind Hunter row.

## Design Notes

**Orchestrator decisions needed** (the Lead's calls, delegated). This plan follows each recommendation.

- **Orchestrator decision needed: AC 41.2.2's single source — retire `objectscript-review`, generate its body from the rule, or generate the rule from it** — recommended: **retire the prompt** (option R). AD-15 pre-sanctions exactly this, and the rule replaces the prompt's purpose. The options:

  | | R: retire the prompt | G: the rule generates the prompt body | P: the prompt generates the rule |
  | --- | --- | --- | --- |
  | Prompt count | 13 → 12 (dev 5 → 4) | 13 | 13 |
  | `prompts/list` (dev) | Loses one entry | Unchanged, but the body changes (an AD-15 output change that needs a decision anyway) | Same as G |
  | Tools-list snapshot | Unaffected (it pins tools only: `scripts/lib/tools-list-snapshot-core.mjs:163-165`) | Unaffected | Unaffected |
  | Generated skills | `skills/objectscript-review/` and its pack copy are deleted by the generators | The skill is regenerated from the rule, so the pack holds the checklist three times (two rule forms and a skill), and a Claude Code session can load it twice | Same as G |
  | Docs and pins | Two table rows, a heading count, a tally, about 15 test pins (Code Map), and the CHANGELOG | A new generator, a `--check`, a generated TS file in dev, and the 300-word cap shared with the prompt | Contradicts AD-28's Sources rule (the rule's one source is under `skills-pack-src/rules/`; `gen:pack` renders from no built code), so it needs a re-architecture |

  The evidence for R:
  - A pre-write checklist only helps if it is already in context before the write. A prompt is a slash command that a user invokes. The rule loads at launch (memory docs, below).
  - The prompt's text would have to change under any option. Its probes found:
    - `SanitizeError`, a project-internal class;
    - "never mark %OnNew Private", which is too broad (P16);
    - the `//` advice, which is false;
    - abstract-method return defaults, which aren't needed (P13);
    - the editor advice "rewrite the whole file".
  - Nothing has been published yet: dev is at 0.0.2, and AD-29 means nothing publishes before Epic 42. The prompt's users therefore lose nothing in a release, and the rule reaches every client through 41.6.
  - The one gap is that MCP-prompt-only clients lose a slash command. Clients that read the `AGENTS.md` form get the rule always-on instead.
- **Orchestrator decision needed: how two forms come from one source, plus the marker strings and an AD-28 wording amendment** — recommended: `gen:pack` renders both forms from each flat `skills-pack-src/rules/<name>.md`:
  - `rules/claude-code/<name>.md` is the source bytes;
  - `rules/agents-md/<name>.md` is `<!-- IRIS-MCP-RULE:<name>:BEGIN -->\n` + the source bytes + (a `\n` if the source lacks a final one) + `<!-- IRIS-MCP-RULE:<name>:END -->\n`;
  - rule sources must have no frontmatter;
  - the rule name is `iris-mcp-objectscript-pre-write`.

  The evidence:
  - **The AC.** AC 41.2.3 says "emitted in two forms", so both are files in the pack. Wrapping at install time would move 41.2's deliverable into 41.6.
  - **The spine.** AD-28 already says `rules/` holds "the rule's forms", and `gen:pack` already renders the pack README. The section is a pure byte wrap, needs no build, and keeps the body byte-exact.
  - **Layout.** Per-form directories leave room for 41.6's Cursor and Copilot forms (`rules/cursor/`, `rules/copilot/`). Claude Code loads `.claude/rules/**/*.md` recursively, so the installer copies only the `claude-code` form.
  - **Markers.** They are namespaced HTML comments in the client-config README's `ADAPTER-TABLE:BEGIN/END` style, with the stem inside, so many rules can share one `AGENTS.md`. The installer matches the exact lines.
  - **Name.** The suite prefix avoids colliding with a user's own rule file (AD-30 ownership; the same reasoning as decision #2's notice filename).

  The cost:
  - 41.1's placeholder `rules/**` byte copy (nested files and any extension) becomes this shape. Its rule fixtures move (Code Map), and a nested rule source becomes a refusal.
  - It is extended through the `assemblePack` seam (#52); the tree-sync helper and the oracles are untouched.
- **Orchestrator decision needed: run AC 41.2.5's live Claude Code check (two headless sessions on the user's account) in the implement stage** — recommended: yes. The implement stage runs the procedure below once. If `claude -p` cannot start or authenticate there, the stage records that, and the lead runs the same procedure at the smoke gate before the story is done. That is a move of who runs it, not a deferral.

  The evidence:
  - Sprint planning flagged the check.
  - It is the only evidence for the Lead's 2026-10-15 premise.
  - **Cost:** two `--model haiku` sessions, each capped at USD 1 by `--max-budget-usd`. The actual `total_cost_usd` is recorded.
  - **Writes:** one disposable `ExecuteMCPv2.Temp.Probe412Live` class, deleted afterwards.
  - **Risk:** the agent shell sets `CLAUDECODE=1`, so the nested launch needs `env -u CLAUDECODE`.

**AC interpretations** (apply and report):

- **41.2.1, "short".** At most 300 words by the retired prompt's counter (its AC 25.1.1 budget), pinned in the default suite. The golden text is 299.
- **41.2.1, "#7, #8, #15 and others".** Covered: #7 (both halves), #8, #9 (folded into the `GetErrorText` bullet), #15 and #35, plus the basics and testing rules. Left out as project-internal: #33 and `SanitizeError`.
- **41.2.2, "its generated skill".** Both the `skills/` copy and the pack copy, each removed by its own generator.
- **41.2.4.** The probes ran in the plan stage (the log below). Re-probe only a new or changed claim.
- **41.2.5, "in context when an agent writes through `iris_doc_put`".** The `InstructionsLoaded` hook oracle plus a contrast leg that can fail (#59).
- **Draft amendment for the lead to `epics.md` AC 41.5.1** (apply and report): "The 11 generated workflow skills, plus every prompt added by 38.6, 39.6 and 40.4, are regenerated" becomes "Every generated workflow skill is regenerated: the 12 prompts that remain after Story 41.2 retired `objectscript-review`."

**Spine text for the lead** (Rule 20, light path):

- **AD-28 Sources.** "`gen:pack` copies both sources byte for byte and renders nothing" becomes "`gen:pack` copies both sources byte for byte, needs no build, and renders only the pack README and each rule's `AGENTS.md` section form".
- **AD-28 Shape.** "`rules/` for the rule's forms" becomes "`rules/claude-code/<name>.md` (the source bytes; no frontmatter, so no `paths:`) and `rules/agents-md/<name>.md` (`<!-- IRIS-MCP-RULE:<name>:BEGIN -->`, the source bytes, `<!-- IRIS-MCP-RULE:<name>:END -->`)".
- **AD-28, rule bullet.** Add: "The always-on rule's source is `skills-pack-src/rules/iris-mcp-objectscript-pre-write.md` (Story 41.2): one flat `<name>.md` per rule, without frontmatter. It names no `iris_*` tool, so it declares no preset."
- **AD-15's sanctioned list.** "the possible retirement of the `objectscript-review` prompt" becomes "the retirement of the `objectscript-review` prompt (Story 41.2; its checklist is the always-on rule)".
- **Conventions row "Marked blocks".** "`<!-- IRIS-MCP-RULE:<name>:BEGIN -->` / `…:END -->`, matched as exact whole lines. The block between them is owned and replaced whole."
- **memlog line.** "AD-28 (41.2): the rule is one flat skills-pack-src/rules/<name>.md with no frontmatter. gen:pack emits rules/claude-code/ (bytes) and rules/agents-md/ (bytes between IRIS-MCP-RULE markers); objectscript-review is retired (AD-15). Prevents a scoped rule, a second checklist copy, and unowned AGENTS.md edits."

**Golden rule text.** This is `skills-pack-src/rules/iris-mcp-objectscript-pre-write.md`, verbatim, ending in a single LF: 299 words, 2,120 bytes, sha256 prefix `4d5702cb9f53`.

~~~markdown
## ObjectScript pre-write checklist

Before writing ObjectScript, on disk or on the server, check:

**Syntax and names**

- Macros take three dollar signs: `$$$OK`. `$$OK` calls a label and fails to compile with `<NOLINE>`.
- Indent every command in a method; a command in column 1 is read as a label.
- No `_` in class, method, property or parameter names. It is the concatenation operator, so the class does not compile.
- Quote a dynamic-object key that contains `_`: `Set obj."max_results" = 5`.

**Control flow and errors**

- `Quit` with a value does not compile inside `Try` or `Catch`. Use `Return value`, or `Quit` a variable after the block.
- An argumentless `Quit` in `Catch` leaves only the `Catch` block, and the code after it still runs: set a flag, and act on it after the block.
- `$System.Status.GetErrorText(tSC)` already starts with a prefix such as `ERROR #5001: `. Strip it before wrapping the text in `$$$ERROR` again, or it appears twice.
- Never wrap a method call in `$Get()`: `$Get(obj.%Get("x"), d)` fails with `<INVALID CLASS>`. Use `obj.%Get("x", d)` or `obj.%IsDefined("x")`.

**Namespaces and output**

- After `Set $NAMESPACE = "%SYS"`, a class that `%SYS` cannot see raises `<CLASS DOES NOT EXIST>`. Save the original, and restore it first in every `Catch`.
- Stop capturing output with `##class(%Library.Device).ReDirectIO(0)`, then `Use` the original device. `Use dev::("")` leaves redirection on, and the next `Write` fails with `<COMMAND>`.

**Classes**

- Never hand-edit a `Storage` block. The compiler writes it.
- An abstract method still needs a `{ }` body, which may be empty.

**Unit tests**

- Assertions are macros: `Do $$$AssertEquals(...)`, plus `$$$AssertNotEquals`, `$$$AssertTrue`, `$$$AssertNotTrue`, `$$$AssertStatusOK` and `$$$AssertStatusNotOK`. There is no `$$$AssertFalse` or `$$$AssertCondition`.
- Only methods whose names start with `Test` run.
- A `%OnNew` in a `%UnitTest.TestCase` subclass takes `initvalue`, calls `##super(initvalue)`, and is not `Private`.
- Compare a run's total with the `Test` methods you expect. A class that cannot start reports 0.
~~~

The pinned 41.5 forward note: the rule legitimately contains the IRIS error code `ERROR #5001`, so AC 41.5.4's pack-wide internal-reference check must not treat `ERROR #<n>` as an internal rule number.

**Probe log** (AC 41.2.4). Plan stage, 2026-10-19, run on `server:"default"`, namespace `HSCUSTOM`. `iris_server_info` reported `IRIS for UNIX (Ubuntu Server LTS for ARM64 Containers) 2026.2 (Build 221U)`.

- **Before:** `iris_doc_list filter:"Probe412"` returned `[]`.
- **Classes:** 26 disposable `ExecuteMCPv2.Temp.Probe412*` classes were put, compiled with `ck`, executed, and deleted with one `iris_doc_delete` call.
- **After:** `iris_doc_list filter:"Probe412" generated:true` returned `[]`.
- **No HSCUSTOM global was written.** Capture went to `%`-local variables, killed afterwards. The only writes were the `%UnitTest` framework's own result rows (run indices 1325 to 1327), which every `iris_execute_tests` run writes.

Each row gives the probe, what was observed, and the verdict.

- **P1, `$$$` macros; `$$OK` fails with `<NOLINE>`.**
  - Probe: `Probe412DollarDollar`, `Quit $$OK`.
  - Observed: compile error `#8: <NOLINE>`. `$$$OK` = 1 (`irislib/%occStatus.inc:8`; `ErrText` returned `ok=1`).
  - Holds.
- **P2, column 1 is read as a label.**
  - Probe: `Probe412Col1`, `Set tX = 1` in column 1.
  - Observed: `#1026: Invalid command : 'tX' … [Set^…]`, so `Set` became a label.
  - Holds.
- **P3, `_` in a name does not compile.**
  - Probe: `Probe412UMethod` (`My_Method`), `Probe412UProp` (`My_Prop`), `Probe412UParam` (`MY_PARAM`), and `Probe412_U` as a class name.
  - Observed: each member gives `ERROR #5559` (parse failure). The class name is refused at save: `ERROR #16006 … name is invalid`.
  - Holds.
- **P4, quote a dynamic key that holds `_`.**
  - Probe: `Probe412Run.DynUnderscore` and `Probe412DynBare`.
  - Observed: `{"max_results":5}`. The unquoted form gives `#1027: Error in SET command : 'tObj.max_results'`.
  - Holds.
- **P5, `Quit` with a value in `Try` or `Catch`.**
  - Probe: `Probe412QuitTry` and `Probe412QuitCatch`.
  - Observed: both give `#1043: QUIT argument not allowed`.
  - Holds.
- **P6, `Return` with a value works in `Try`.**
  - Probe: `Probe412Run.ReturnInTry`.
  - Observed: `returned-from-try`.
  - Holds.
- **P7, an argumentless `Quit` in `Catch` leaves only the `Catch` block.**
  - Probe: `Probe412Run.QuitInCatch`.
  - Observed: `start>try>catch>after`.
  - Holds.
- **P8, the `GetErrorText` prefix, and doubling on re-wrap.**
  - Probe: `Probe412Run.ErrText`.
  - Observed: `ERROR #5001: disk full`, then `ERROR #5001: ERROR #5001: disk full`.
  - Holds.
- **P9, `$Get()` around a method call; `%Get` default and `%IsDefined`.**
  - Probe: `Probe412GetWrap.GetWrap` and `Probe412Run.GetDefault`. The signature `%Get(key, default, type)` is at `irislib/%Library/DynamicObject.cls:177`.
  - Observed: `<INVALID CLASS> Class '%Library.DynamicObject' does not support MultiDimensional operations`, then `1,dflt,0`.
  - Holds.
- **P10, a class `%SYS` cannot see raises `<CLASS DOES NOT EXIST>` until restore.**
  - Probe: `Probe412More.NSFresh` and `Probe412Run.NSNew`.
  - Observed: `ensDefinedHere=0;ensCallError=<CLASS DOES NOT EXIST>;restored=HSCUSTOM;ensCallAfter=Ens.Director`. With `New $NAMESPACE`, `afterReturn=HSCUSTOM`. But `tempDefinedHere=1;tempCall=target-pong`: `ExecuteMCPv2.*` classes resolve in `%SYS` on this instance.
  - Holds (hence the rule's wording "a class that `%SYS` cannot see").
- **P11, `ReDirectIO(0)` stops capture; `Use dev::("")` leaves redirection on.**
  - Probe: `Probe412Run.IORedirect` and `Probe412More.IORestore`.
  - Observed: after `Use dev::("")`, the mnemonic is empty and `redir=1`; the next `Write` raises `<COMMAND>` (captured `A` only). After `ReDirectIO(0)`, `redir=0`; a bare `Use` keeps the mnemonic, and `B` and `C` are not captured. Each time, the caller's capture was put back and its response envelope stayed clean.
  - Holds as the rule words it.
- **P12, the compiler writes `Storage`.**
  - Probe: `Probe412Persist`, then `iris_doc_get`.
  - Observed: `Storage Default {… <Type>%Storage.Persistent</Type> }` was added.
  - Holds.
- **P13, an abstract method needs a `{ }` body, which may be empty.**
  - Probe: `Probe412AbsEmpty` and `Probe412AbsNoBody`.
  - Observed: empty bodies (`As %String`, `As %Status`) compile. The form with `;` and no body gives `ERROR #5559`.
  - Holds.
- **P14, assertions are macros; the six exist; `AssertFalse` and `AssertCondition` do not.**
  - Probe: `irislib/%outUnitTest.inc:6-31`, `Probe412AssertFalse`, `Probe412AssertCond`, `Probe412AssertMethod` and `Probe412Test`.
  - Observed: `MPP5610 Referenced macro not defined` for both missing macros; `..AssertEquals` gives `MPP5376 Method or Property 'AssertEquals' does not exist`; `Probe412Test` passed 2 of 2 using all six.
  - Holds.
- **P15, only `Test*` methods run.**
  - Probe: `Probe412Test`, whose `CheckNotATest` asserts false.
  - Observed: total 2, passed 2.
  - Holds.
- **P16, a `%OnNew` in a `TestCase` subclass takes `initvalue`, calls `##super(initvalue)`, and is not `Private`.**
  - Probe: `Probe412Test`, `Probe412TestBadNew` (`##super()`), `Probe412TestNoArgNew` (`%OnNew()`), `Probe412OnNewPriv` and `Probe412OnNewPrivReg`. Source: `irislib/%UnitTest/TestCase.cls:86`.
  - Observed: the correct form passes. Both bad forms give `<UNDEFINED>%OnNew+1^%UnitTest.TestCase.1 *initvalue`. `Private` in a `TestCase` subclass gives `ERROR #5477 … keyword 'Private' must be '0'`, but a `Private` `%OnNew` in a `%RegisteredObject` subclass compiles and runs (`init:v`).
  - Holds as scoped.
- **P17, a class that cannot start reports 0.**
  - Probe: the `BadNew` and `NoArgNew` runs.
  - Observed: total 0, against 1 expected.
  - Holds.

Source claims probed but kept out of the rule:

- `Probe412MDTyped`: a typed MultiDimensional property compiles and works (`typed,untyped`).
- `Probe412Pct`: a `%`-named property and parameter compile.
- `Probe412Slash`: `//` compiles between members and in a body, and is preserved by `iris_doc_get`.

The probe-anchor list for the rule test, one per bullet:

1. `` `$$OK` calls a label `` (P1)
2. `column 1` (P2)
3. `concatenation operator` (P3)
4. `"max_results"` (P4)
5. `` `Return value` `` (P5, P6)
6. `` leaves only the `Catch` block `` (P7)
7. `` `ERROR #5001: ` `` (P8)
8. `<INVALID CLASS>` (P9)
9. `<CLASS DOES NOT EXIST>` (P10)
10. `ReDirectIO(0)` (P11)
11. `` `Storage` block `` (P12)
12. `` `{ }` body `` (P13)
13. `$$$AssertNotTrue` (P14)
14. `` start with `Test` `` (P15)
15. `##super(initvalue)` (P16)
16. `reports 0` (P17)

**Flagged for the retro** (corrections to source rule files; this story does not edit them):

- **`.claude/rules/object-script-testing.md`:**
  - "MultiDimensional properties CANNOT have datatype specifications" is false. System classes declare `Property Data As %String [ MultiDimensional ]` (`irislib/%Library/AbstractResultSet.cls:48`).
  - "%OnNew cannot be Private (ERROR #5477)" holds only when the parent's `%OnNew` is public, as in `%UnitTest.TestCase`.
  - The macro list omits `$$$AssertNotTrue`, the real negative assertion; the file suggests `$$$AssertTrue('cond)` instead. It also omits `$$$AssertStatusEquals`, `$$$AssertSuccess`, `$$$AssertFailure` and `$$$AssertSkipped`.
- **`.claude/rules/iris-objectscript-basics.md`:**
  - Abstract methods "must return an appropriate value": false, since an empty body compiles.
  - "`//` … is not treated as a comment … can break parsing": false.
  - "Do not create … properties with '%'" is a convention, not a compile rule.
  - The `ExecuteMCPv2.Utils` example of `New $NAMESPACE` is environment-dependent on this instance (P10).
- **`.claude/rules/project-rules.md` #7.** "`Use tInitIO::("")` is a NO-OP that does not clear the mnemonic" is false on 2026.2. It clears the mnemonic but leaves redirection on, so the next `Write` raises `<COMMAND>`. The prescribed `ReDirectIO(0)` plus a bare `Use` is right.

**AC 41.2.5, the docs re-check** (Rule #14, 2026-10-19):

- **https://code.claude.com/docs/en/memory:**
  - "Rules without `paths` frontmatter are loaded at launch with the same priority as `.claude/CLAUDE.md`."
  - "Rules without a `paths` field are loaded unconditionally and apply to all files. A path-scoped rule loads when Claude uses the Read, Write, or Edit tool on a matching file."
  - "`paths` is the only field Claude Code reads from a rule … Claude Code removes the frontmatter before loading the rule into context."
  - "All `.md` files are discovered recursively."
  - "Block-level HTML comments … in CLAUDE.md files are stripped."
  - `AGENTS.md` is read only without a `CLAUDE.md` (v2.1.277 and later), and `InstructionsLoaded` hooks "Don't fire" for it.
- **https://code.claude.com/docs/en/hooks:**
  - `InstructionsLoaded` "Fires when a `CLAUDE.md` or `.claude/rules/*.md` file is loaded into context".
  - Its fields are `file_path`, `memory_type` and `load_reason` (`session_start`, `nested_traversal`, `path_glob_match`, `include`, `compact`). It has no decision control.
  - The page does not say whether the hook fires under `-p`, hence the fallback below.
- **The local CLI** is `2.1.296 (Claude Code)`. `--bare` skips hooks, so it is not used.

**AC 41.2.5, the live procedure** (decision 3). `<scratchpad>` is the running stage's own session scratchpad directory, never the repository. All paths are under `<scratchpad>/s412-live/`, and its scripts live there too. The whole directory, credentials included, is deleted afterwards.

1. **The project.** Create `proj/` with no `CLAUDE.md`. Copy the pack's `rules/claude-code/iris-mcp-objectscript-pre-write.md` to `proj/.claude/rules/`. In `proj/.claude/settings.json`, register `InstructionsLoaded` and `PreToolUse` command hooks. Each runs `node <scratchpad>/s412-live/log-hook.mjs`, which appends `{t: Date.now(), ...stdin JSON}` to `hooks.jsonl`.
2. **The MCP config.** `mcp.json` holds only `iris-dev`: `node /Users/jbrandt/git/iris-execute-mcp-v2/packages/iris-dev-mcp/dist/index.js`. Its env is copied by a script from the user-scope `iris-dev` entry and never printed:
   - `IRIS_HOST`, `IRIS_PORT`, `IRIS_USERNAME`, `IRIS_PASSWORD` and `IRIS_HTTPS`;
   - `IRIS_NAMESPACE=HSCUSTOM`;
   - with `IRIS_SERVER_MANAGER` and `IRIS_SM_WORKSPACE` dropped, because they can expose another project's profiles.
3. **The positive leg.** From `proj/`, run `perl -e 'alarm 300; exec @ARGV' -- env -u CLAUDECODE claude -p --model haiku --max-budget-usd 1 --strict-mcp-config --mcp-config <mcp.json> --setting-sources project --allowedTools mcp__iris-dev__iris_doc_put --disallowedTools Read,Write,Edit,Bash --output-format json "<P>"`. The prompt `<P>` is: "Using only the iris_doc_put tool on server default, namespace HSCUSTOM, create the class ExecuteMCPv2.Temp.Probe412Live with one ClassMethod Ping() As %String that returns "pong". Do not create, read or edit any local file. Then reply DONE."
4. **The contrast leg.** Use a fresh `hooks.jsonl`, and give the copied rule `---\npaths:\n  - "**/*.cls"\n---\n` frontmatter, in the temporary copy only. Run the same command.
5. **The assertions,** checked by a scratch script:
   - positive: an `InstructionsLoaded` entry whose `file_path` ends in `.claude/rules/iris-mcp-objectscript-pre-write.md`, with `load_reason` `session_start`; a `PreToolUse` entry with `tool_name` `mcp__iris-dev__iris_doc_put` and the same `session_id`; no `PreToolUse` for `Read`, `Write`, `Edit` or `Bash`;
   - contrast: no `InstructionsLoaded` for the rule, while `iris_doc_put` still fires.

   **Fallback,** if no `InstructionsLoaded` line appears in either leg (the hook does not fire under `-p`): ask both legs, before any tool call, to quote verbatim the bullet that starts "Stop capturing output". The positive leg must reproduce it exactly, and the contrast leg must not. Record which oracle decided.
6. **Cleanup.** Run `iris_doc_delete ExecuteMCPv2.Temp.Probe412Live.cls` with `server:"default"` and `namespace:"HSCUSTOM"`. Then `iris_doc_list filter:"Probe412" generated:true` must return `[]`. Delete `<scratchpad>/s412-live/`.

**Governing ADs:**

- **AD-28:** the one source, unscoped, the pack shape, no internal references, tool names (decision 2).
- **AD-15:** the sanctioned retirement, named in the CHANGELOG (decision 1).
- **AD-14:** generated files change only through their generators.
- **AD-2:** the build and checks live in `scripts/` and `iris-mcp-all`.
- **AD-29:** the changesets are minor.
- **AD-30:** consumed by 41.6, through the owned marked block.
- **Project rules:** #16, #36, #43, #46, #51, #55, #58, #59 and Rule 14.

No AC contradicts an AD. Decision 2 amends AD-28's wording ("renders nothing") in its own direction, since AD-28 already names the rule's forms.

**Extend, don't copy (Rule 2):**

- The forms are an extension of `assemblePack`; there is no new generator.
- The word counter and the marker checks move from the deleted `prompt-safety-invariants` block to the rule test. It is a move, not a copy.
- The tool-token pin reuses `extractIrisTokens`.
- The marker grammar follows `render-certification-table.mjs` without sharing its code: that script is local to client-config, and 41.6 may share the grammar there.

**Integration (Rules 1/2):**

- **Integration ACs:** client-config's npm tarball lists both forms; the `validate:prompts` CLI counts them; a real SDK `Client` sees the 4 dev prompts.
- No installer consumes the forms or markers in this story. The first consumer is Story 41.6.
- **Consumed-by:**
  - **41.5:** the catalog lists the rule. It regenerates 12 workflow skills, and its internal-reference check accepts `ERROR #<n>`.
  - **41.6:** copies `rules/claude-code/` into `.claude/rules/`, inserts `rules/agents-md/` into `AGENTS.md` by exact marker lines, and adds any Cursor or Copilot forms as `rules/<client>/`.
  - **41.7:** docs. AC 41.7.3 may reuse the live procedure; its "activates for a `.cls` path" is met by the unconditional load.
  - **42.8:** plugins cannot carry rules, so the plugin ignores `rules/`.
- **Consumes:** 41.1's `assemblePack`, `listAgentContentFiles`, `gen-pack`, the validator and the provenance check, plus `gen:skills` and the prompt catalog.

**Ledger inbox (Rule 17):** none. `LEDGER slice 41-2-always-on-objectscript-pre-write-rule` is empty.

## Verification

- **How commands run.** Every command runs from `/Users/jbrandt/git/iris-execute-mcp-v2` in the foreground with `timeout: 600000`, one package or one test-file group per call.
- **Builds.** Built dists of shared, the five servers and client-config are required. Rebuild dev cleanly after the prompt removal, and rebuild any package whose `src/` is edited (`checkDistFresh` is mtime-based).
- **IRIS.** No live gates. The only IRIS writes are the disposable `ExecuteMCPv2.Temp.Probe412*` probes and `ExecuteMCPv2.Temp.Probe412Live` (the live check), each deleted, with leftovers `[]`. No stateful OS test class is added.

**Shared surfaces:** these change, and other tests assert on them.

- The dev prompt list (5 → 4) and the suite prompt count (13 → 12).
- `skills/` and `skills/README.md` (13 → 12 skills; gen-skills: 14 → 13 files).
- The pack file set (15 → 16, with the two rule forms) and the tarball list.
- The validator OK line (39 sources: 12 prompts, 27 content files) and provenance's agent-file count (26 → 27).
- `assemblePack`'s rules mapping, which 41.1's rule fixtures assume.
- The README prompt heading and table, the dev README table, and the `tool_support.md` tally (docs-prompt-sync and the 38.6/39.6 doc-claims tests).
- `prompt-safety-invariants`.
- The foreign-name lists in the admin, interop and ops `prompts.test.ts`.
- The CHANGELOG's newest section.

**Standing criterion:** every test added or changed passes on a fresh environment, in either order.

**Commands:**

- `(loop)` Delete `packages/iris-dev-mcp/dist` and `tsconfig.tsbuildinfo`, then run `pnpm --filter @iris-mcp/dev build` -- expected: exit 0, and `ls packages/iris-dev-mcp/dist/prompts | grep -c objectscriptReview` prints 0.
- `(loop)` `pnpm gen:skills`, then `pnpm gen:skills:check` -- expected: `13 generated file(s) match source`.
- `(loop)` `pnpm gen:pack` twice, then `git status --short packages/client-config/skills-pack` -- expected: the second run changes nothing. Then `pnpm gen:pack:check` -- expected: `16 pack file(s)`.
- `(loop)` `pnpm validate:prompts`, then `pnpm check:provenance` -- expected: the matrix OK line, then `0 provenance row(s), 27 agent file(s), 8 distribution(s)`.
- `(loop)` `npm pack --dry-run --json --ignore-scripts --offline` in `packages/client-config`, and again in `packages/iris-dev-mcp` -- expected: both rule forms listed and no `objectscript-review` skill; no `objectscriptReview` file in dev.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/skills-pack-rule.test.ts src/__tests__/skills-pack.test.ts src/__tests__/validate-prompts.test.ts src/__tests__/skills-generated-frontmatter.test.ts src/__tests__/docs-prompt-sync.test.ts src/__tests__/prompt-safety-invariants.test.ts src/__tests__/story-38-6-qa-edit-prompt-sdk-wire.test.ts src/__tests__/story-38-6-doc-claims.test.ts src/__tests__/story-39-6-doc-claims.test.ts src/__tests__/pack-provenance.test.ts src/__tests__/gen-skills-stray-file.test.ts` -- expected: pass.
- `(loop)` The five `story-41-1-qa-*.test.ts` files in one call, then `pnpm --filter @iris-mcp/dev test` -- expected: pass.
- `(once)` One call each:
  - `pnpm --filter @iris-mcp/shared test`, and the same for admin, interop, ops and client-config;
  - dev `lint` and `type-check`;
  - the full `@iris-mcp/all` suite in three calls (`ls src/__tests__/*.test.ts | awk 'NR%3==k'`, k = 1, 2, 0) -- expected: green.
- `(once)` `pnpm gen:governance-baseline:check` (`1e62c5ad5bf7`/141), `pnpm gen:tools-list-snapshot:check`, `node scripts/check-epics-sync.mjs` and `git diff --stat packages/shared/src/bootstrap-classes.ts` (empty) -- expected: OK.
- `(once)` The AC 41.2.5 live procedure (Design Notes) -- expected: as in the AC. Record the result here.

**Planned mutations (Rule 19).** Apply each, observe red, revert (re-running `gen:pack` or the dev build where it applies), and confirm `git status --short` and `git diff --stat` are unchanged. Record each as `mutation: <change> → <test>`.

- **M1** (AC 41.2.3, no frontmatter): prepend `---\npaths: ["**/*.cls"]\n---\n` to the rule source → `gen:pack` exits 1, and `skills-pack-rule.test.ts` goes red on its real-tree test.
- **M2** (AC 41.2.3, the section form): `renderAgentsMdSection` omits the END line → the marker test goes red.
- **M3** (#58): build the `agents-md` body through a utf-8 string → the invalid-UTF-8 fixture goes red.
- **M4** (AC 41.2.1, the budget): append a 20-word bullet, then `gen:pack` → the word-count test goes red.
- **M5** (AC 41.2.1, no internal references): add "see Rule #7" → the internal-reference test goes red.
- **M6** (AC 41.2.1, tool-agnostic): add `` `iris_doc_put` `` → the no-tool-token test goes red.
- **M7** (unknown entry): add `skills-pack-src/rules/nested/x.md` → the unknown-entry test goes red, and the `gen:pack` CLI exits 1.
- **M8** (AC 41.2.2): re-register the prompt in `index.ts` and rebuild dev → the SDK list test and the `validate-prompts` count go red.
- **M9** (AC 41.2.5, #59): the contrast leg of the live procedure is the red proof of the hook oracle.

### Implementation record (implement stage, 2026-10-19)

**`(loop)` commands run.** All from the repository root, in the foreground, one group per call.

- Clean dev rebuild (`dist` and `tsconfig.tsbuildinfo` deleted, then `pnpm --filter @iris-mcp/dev build`): exit 0, `ls packages/iris-dev-mcp/dist/prompts | grep -c objectscriptReview` prints 0. Shared was rebuilt first, because `server-base.ts` changed (a comment).
- `pnpm gen:skills` removed `skills/objectscript-review/SKILL.md` ("Generated 13 file(s) under skills/ from 12 prompt(s)"); `pnpm gen:skills:check`: `13 generated file(s) match source`. `skills/README.md` has 12 skill rows (`grep -c '^| \`'` prints 12).
- `pnpm gen:pack` twice (the second run changed nothing, `git status` of the pack shows only the removed skill and the new `rules/`); `pnpm gen:pack:check`: `16 pack file(s) match their sources`. The `claude-code` form is `cmp`-identical to the source; the `agents-md` form starts with the BEGIN line and ends with the END line.
- `pnpm validate:prompts`: `39 source(s) checked (12 prompt(s) + 27 content file(s): 12 workflow, 14 pack, 0 knowledge, 1 rule), 111 known tool name(s)`. `pnpm check:provenance`: `0 provenance row(s), 27 agent file(s), 8 distribution(s)`.
- `npm pack --dry-run --json --ignore-scripts --offline`: client-config lists `skills-pack/rules/claude-code/iris-mcp-objectscript-pre-write.md` and `skills-pack/rules/agents-md/iris-mcp-objectscript-pre-write.md` and no `objectscript-review`; dev lists no `objectscriptReview` file (142 files).
- The `@iris-mcp/all` vitest group of the `(loop)` list (11 files, including the new `skills-pack-rule.test.ts` with 81 tests): 385 passed. The `story-41-1-qa-*` files plus `changelog-bootstrap-move.test.ts` (5 files): 118 passed. `pnpm --filter @iris-mcp/dev test`: 68 files, 1663 tests passed. The admin, interop and ops `prompts.test.ts` and shared `prompts-guardrails.test.ts` pass.
- Also run: dev `type-check` and `lint` (clean), `pnpm gen:governance-baseline:check` (OK), `node scripts/check-epics-sync.mjs` (OK), and `git diff --stat packages/shared/src/bootstrap-classes.ts` (empty; `BOOTSTRAP_VERSION` stays `5296a1c836f4`).

**Mutations (Rule 19).** Each was applied, observed red, and reverted; the fingerprint of `git status --short`, `git diff` (spec excluded) and the hashes of the untracked files was identical before and after every one (`7ec4a7b0928caabd8cfc2a837fe828db64bdfd67`). Where a mutation changed the rule source, `gen:pack` was re-run before the test and after the revert.

- mutation: M1, `---` plus `paths: ["**/*.cls"]` plus `---` prepended to the rule source -> `node scripts/gen-pack.mjs` exits 1 with "skills-pack-src/rules/iris-mcp-objectscript-pre-write.md has frontmatter; an always-on rule takes none (no paths:)", and `skills-pack-rule.test.ts` goes red (9 tests) on the real-tree forms-against-source tests ("neither form starts with frontmatter ...", "the claude-code form equals the source bytes") and on the scratch-copy CLI rows.
- mutation: M1b, the frontmatter check in `assemblePack` disabled (`FRONTMATTER_OPENER.test('')`) -> the 7 frontmatter-refusal fixtures, their 7 CLI rows and the "clean again" row in `skills-pack-rule.test.ts` go red (15 failed).
- mutation: M1c, the frontmatter opener widened to any leading `---` -> "accepts a rule source with a four-dash line" and "with a dash line with text after it" go red (2 failed).
- mutation: M2, `renderAgentsMdSection` without the END line -> 19 tests red across `skills-pack-rule.test.ts` and `skills-pack.test.ts` (the section-form rows, the layout test, "committed pack matches its sources", "gen-pack --check passes on the committed tree").
- mutation: M3, the `agents-md` body built through `bytes.toString('utf8')` -> "keeps the invalid-utf8 variant byte for byte in both forms" and the CLI byte-variant row go red (2 failed; the BOM variant survives a UTF-8 round trip, so only the invalid-UTF-8 fixture catches it).
- mutation: M4, a 20-word bullet appended to the rule source, then `gen:pack` -> "has no problem a reader of the text would meet" goes red with "319 words, over the 300-word budget" (and the 16-bullet test with 17).
- mutation: M5, "(see Rule #7)" added to the rule's first line, then `gen:pack` -> "keeps the IRIS error code ERROR #5001, which is no internal rule number" goes red with `['an internal rule number']` (the content test also reports the 302 words).
- mutation: M6, `` `iris_doc_put` `` added to the rule's first line (300 words, so only this check fires), then `gen:pack` -> the content test goes red with `['a tool name: iris_doc_put']`; `validate:prompts` stays green, because the name is real, so the rule test is the only gate.
- mutation: M7, `skills-pack-src/rules/nested/x.md` added -> `node scripts/gen-pack.mjs` exits 1 ("unknown entry in skills-pack-src/rules/: nested"), and `skills-pack.test.ts` and `skills-pack-rule.test.ts` go red on every real-tree and scratch-copy row.
- mutation: M7b, the unknown-entry filter in `assemblePack` emptied (`.filter(() => false)`) -> the 9 unknown-entry fixtures, their 9 CLI rows, the "clean again" row and the 3 rules/ rows of `skills-pack.test.ts` go red (22 failed).
- mutation: M8, `objectscriptReview.ts` restored as a stub, re-registered in `index.ts`, dev rebuilt -> `story-38-6-qa-edit-prompt-sdk-wire.test.ts` (the four-prompt list and "a retired prompt is neither listed nor served"), `validate-prompts.test.ts` (12 prompts, the CLI count) and the retirement check of `skills-pack-rule.test.ts` go red (6 failed). Reverted, then dev rebuilt from a deleted `dist` (0 `objectscriptReview` files).
- mutation: M8b, a stale `packages/iris-dev-mcp/dist/prompts/objectscriptReview.js` placed -> "the dev package has neither the prompt source nor a built file of it" goes red (1 failed); the file was removed.
- mutation: M9, the contrast leg of the live procedure (below), a copy of the rule with `paths:` frontmatter -> no `InstructionsLoaded` line for the rule while `iris_doc_put` still ran, so the hook oracle can tell a scoped rule from an unscoped one.

**Live check (AC 41.2.5), run last.**

- **Environment.** CLI `2.1.296 (Claude Code)`. Everything lived in a throwaway directory under the stage scratchpad (`s412-live/`: two projects without a `CLAUDE.md`, `proj-positive/` and `proj-contrast/`, an `mcp.json`, a hook logger and a log checker, all written with the file tools). The rule copied into `.claude/rules/` is the pack's `rules/claude-code/` form (2,120 bytes); the contrast copy is the same bytes behind `---\npaths:\n  - "**/*.cls"\n---\n` (2,150 bytes). `mcp.json` held only `iris-dev` (`node packages/iris-dev-mcp/dist/index.js`), its `IRIS_HOST`, `IRIS_PORT`, `IRIS_USERNAME`, `IRIS_PASSWORD` and `IRIS_HTTPS` copied by a script from the user-scope entry and never printed, `IRIS_NAMESPACE=HSCUSTOM`, with `IRIS_SERVER_MANAGER` and `IRIS_SM_WORKSPACE` dropped. Project `settings.json` registered `InstructionsLoaded` and `PreToolUse` command hooks that append one line per event to the file named by `S412_HOOK_LOG`.
- **Command (each leg, from its project directory).** `S412_HOOK_LOG=<leg log> perl -e 'alarm 300; exec @ARGV' -- env -u CLAUDECODE claude -p --model haiku --max-budget-usd 1 --strict-mcp-config --mcp-config ../mcp.json --setting-sources project --allowedTools mcp__iris-dev__iris_doc_put --disallowedTools Read,Write,Edit,Bash --output-format json "<P>"`, with `<P>` exactly as in the procedure above.
- **Positive leg.** Exit 0, `is_error` false, 3 turns, `total_cost_usd` 0.00785803, reply `DONE`. The hook log, reduced to event, tool and path: `InstructionsLoaded` for `<s412-live>/proj-positive/.claude/rules/iris-mcp-objectscript-pre-write.md` with `memory_type` `Project` and `load_reason` `session_start`; then `PreToolUse` `ToolSearch` (the client loading the deferred MCP tool); then `PreToolUse` `mcp__iris-dev__iris_doc_put`; all one `session_id`. No `PreToolUse` for `Read`, `Write`, `Edit` or `Bash`. `iris_doc_get` then showed the class in HSCUSTOM with `Ping()` returning `"pong"`.
- **Contrast leg** (after the class was deleted). Exit 0, `is_error` false, 3 turns, `total_cost_usd` 0.00332339, reply `DONE`. The log held only `PreToolUse` `ToolSearch` and `PreToolUse` `mcp__iris-dev__iris_doc_put` (one session): no `InstructionsLoaded` line for the rule, while `iris_doc_put` still ran.
- **Oracle.** The hook oracle decided: `InstructionsLoaded` fires under `-p`, so the fallback quote oracle was not needed and no further session was run. Both legs stayed far below the USD 1 cap (total 0.0112 USD for the two sessions). No credential appears in the result files, stderr files or hook logs (`grep IRIS_PASSWORD` found 0 in each).
- **Cleanup.** `ExecuteMCPv2.Temp.Probe412Live.cls` was deleted after each leg with `iris_doc_delete` (`server:"default"`, `namespace:"HSCUSTOM"`); `iris_doc_list filter:"Probe412" generated:true` returned `{"items":[]}` before the legs and after the last deletion. `s412-live/`, credentials included, was deleted and `ls` confirmed it is gone. The only records left are the two sessions' transcripts under the user's `~/.claude/projects/`, which hold prompts and tool calls and no credentials.

### Review-pass patches and mutations (2026-10-19)

Each mutation was applied, observed red, and reverted; a fingerprint of `git status --short` plus `git diff` (spec excluded) was identical before and after every one. A mutation that changed `scripts/lib/skills-pack.mjs` or the rule source re-ran `pnpm gen:pack` for the red run and again after the revert.

- mutation: M10, the `endsInLineFeed ? '' : '\n'` branch of `renderAgentsMdSection` flipped -> the section-form and byte-variant rows of `skills-pack-rule.test.ts` go red (AC 41.2.3, the END line stays whole).
- mutation: M11, the BEGIN marker renamed `START` in `agentsMdMarkers` -> 16 tests of `skills-pack-rule.test.ts` go red, because the oracles type the marker lines literally.
- mutation: M12, the two `RULE_FORM_DIRS` values swapped -> 4 tests go red, including the real-tree "claude-code form equals the source bytes" and the `gen:pack --check` CLI row.
- mutation: M13, `renderAgentsMdSection` emits `---\nname: x\n---\n` after the BEGIN line, then `gen:pack` -> "neither form starts with frontmatter" goes red with "agents-md starts with ---" (the assertion read only the BEGIN line before the review pass, so it could not fail for that form).
- mutation: M14, "start with `Test`" reworded to "begin with `Test`" in the rule source, then `gen:pack` -> "has exactly 16 bullets, and bullet n carries probe anchor n" goes red naming bullet 14 (the only automated tie from a bullet to its probe row).
- mutation: M15, a second final LF appended to the rule source, then `gen:pack` -> "is ASCII, LF only, and ends in exactly one LF" goes red.
- mutation: M16, stub `skills/objectscript-review/SKILL.md` and its pack copy restored -> 5 tests in 4 files go red: `skills-pack-rule.test.ts` (generated copy and the CLI `--check` row), `skills-generated-frontmatter.test.ts`, `story-41-1-qa-pack-tarball.test.ts` and the sweep of `story-41-2-doc-claims.test.ts`.
- mutation: M17, a `| @iris-mcp/dev | objectscript-review |` table row restored in the root README -> 2 tests of `story-41-2-doc-claims.test.ts` go red (the row test and the sweep).
- mutation: M18, "Story 41.2" dropped from the CHANGELOG's `### Removed` bullet -> "Removed names the retired prompt, Story 41.2, the AD-15 sanction and the reason" goes red.
- mutation: M19, `if (def.arguments.length === 0)` made `< 0` in `packages/shared/src/server-base.ts`, shared rebuilt -> the new fixture case "a prompt that declares no arguments renders from a prompts/get with `arguments` omitted entirely" of `story-38-6-qa-edit-prompt-sdk-wire.test.ts` goes red with the SDK's "Invalid input: expected object, received undefined" (1 failed, 9 passed); reverted and shared rebuilt.

**Patches applied in the review pass.** The pack README generator (`renderPackReadme`) names the two rule forms and the marker lines; the pack README was regenerated. `story-41-2-doc-claims.test.ts` is new. The wire test gained a fixture zero-argument prompt case (the retired prompt was the only shipped one). The "neither form starts with frontmatter" assertion now skips the BEGIN marker line for the `agents-md` form. `tool_support.md` records the retirement in its prompt tally paragraph. The CHANGELOG states the rule-name pattern as lower-case letters, digits and single hyphens, narrows its negative-control claim, and names Story 41.2 in `### Removed`.

### QA stage (QA, 2026-10-19)

**Gap analysis.** The implement and review passes pinned the rule text, both forms, the `assemblePack` and `gen:pack` rows, the generated-copy absence and the in-memory prompt wire. Four gaps had no pinning test: the BUILT servers' prompts over real stdio (AC 41.2.2 names a real SDK `Client` on the dev dist; the 38.6 wire test uses an in-memory transport on a re-assembled `McpServerBase`), the dev npm tarball (only the `dist/prompts` directory stood in for it), the `agents-md` form read by exact whole-line markers the way 41.6 will (producer-side bytes were pinned, the consumer reading was not), and a wider reading of "names nothing internal" (a `Story 41` or a path passed every existing scan).

**Tests added (QA).** Rule 8: each is `*.test.ts` under `packages/iris-mcp-all/src/__tests__/`, in the default suite, with no `IRIS_REQUIRE_LIVE` skip logic (so no roster entry). Rule 19 hermeticity: no shared state, each builds and removes its own scratch files under `os.tmpdir()` and starts and closes its own child processes; the file set passes in forward and shuffled order.

- `packages/iris-mcp-all/src/__tests__/story-41-2-qa-prompts-stdio-wire.test.ts` (19 tests): the five built `dist/index.js` servers over `StdioClientTransport` with `default` at the closed port 127.0.0.1:9 (no IRIS reached, no tool called). Dev lists exactly its four prompts in order; `prompts/get` for `objectscript-review` is -32602 naming it on dev, admin, interop and ops, and -32601 on data (which registers none); admin 2, interop 4, ops 2 keep their name, title and arguments (12 in all, each name once); the 12 live names equal the directories of `skills/` and each is a pack skill; every prompt renders over stdio and none names the retired prompt; `arguments` omitted entirely is a render or a -32602 naming the prompt, never an internal error, and the connection stays usable; dev's `npm pack --dry-run` lists no `objectscript*` file and exactly the six `dist/prompts` modules. The expected prompt table was captured from the built dists over stdio on 2026-10-19 (the non-dev prompt sources are unchanged since `751b736`: `git diff --stat 751b736..4307bc0` shows only three test files under admin, interop and ops).
- `packages/iris-mcp-all/src/__tests__/story-41-2-qa-agents-md-consumer.test.ts` (60 tests): a contract test of the `agents-md` form against a small reference reader (typed-out markers, exact whole lines, bytes kept as latin-1). The real form has BEGIN on line 1, END last, each once, LF only, and the marker text appears nowhere else (not in the rule source, not in the `claude-code` form). Nine scratch `AGENTS.md` variants (LF, CRLF, CRLF text around an LF section, a BOM, no final newline after the END line, the section first, alone, between other rules' sections, among lookalike lines) each hold one section; replacing it with the form leaves every outside byte unchanged and a second replacement changes nothing; replacing it with an older CRLF section and back restores the file. Twelve lookalike lines (indent, tab, trailing blanks, other name, longer or shorter name, lower case, no inner spaces, text before or after, a code span) are not found; a section of another rule is left alone; two sections, a lone BEGIN, a lone END, two BEGINs and an END before a BEGIN are reported as ambiguous, not guessed at; the form appended to a file with no final newline puts BEGIN inside the last line, so a consumer must end the line first. Two rows run the real `scripts/gen-pack.mjs` on a scratch copy and pin that a rule body holding its own END or BEGIN line is generated as is (see Issues).
- `packages/iris-mcp-all/src/__tests__/story-41-2-qa-rule-text-hygiene.test.ts` (19 tests): the wider net over the source and both forms (marker lines removed) for 13 classes of forbidden wording (a `#<digits>` that is not `ERROR #<n>`, Story or Epic numbers, DW/AD/AC ids, `irislib`/`irissys`, repository tooling, repository file names, any path, a URL, tool or server names, client config file names, the retired prompt, "probe", "this project"), each with a negative control; case-sensitive tooling names so the status variable `tSC` is not read as `tsc`.

**Probe log re-check (focus 4).** A scratch script read the spec's probe-anchor list and probe log and compared them with `skills-pack-rule.test.ts` and the rule source: 16 spec anchors equal the 16 test anchors (markdown quoting aside), bullet n carries anchor n, the anchors cite P1 to P17, and all 17 probe rows read "Holds". Not committed: it reads the spec, a transient artifact.

**Mutations (Rule 19).** Each was applied, observed red, and reverted; after every one `git status --short` listed only the three new test files and `git diff | shasum` was `da39a3ee5e6b` (empty), and each edited dist file's sha1 prefix was restored (dev `prompts/index.js` 8994e13d8f68, ops `checkSystemHealth.js` 8b13bac44003, dev `deployAndTestClass.js` 12bdd2236955). A mutation of the source or of `scripts/lib/skills-pack.mjs` re-ran `gen:pack` for the red run and again after the revert.

- mutation: M20, a stub `objectscript-review` prompt appended to the array in `packages/iris-dev-mcp/dist/prompts/index.js` -> `story-41-2-qa-prompts-stdio-wire.test.ts` six red: the dev list, the retired refusal, the unknown-name row, dev's table row, the 12-in-all count, and the live-names-equal-skills row.
- mutation: M21, a stale `packages/iris-dev-mcp/dist/prompts/objectscriptReview.js` placed -> the dev tarball test goes red (1 failed); the file was removed.
- mutation: M22, the ops `check-system-health` title changed to "Check Health" in `packages/iris-ops-mcp/dist/prompts/checkSystemHealth.js` -> the `iris-ops-mcp` table row goes red (1 failed).
- mutation: M23, "the `edit-and-test-class` prompt walks that loop" changed to "the `objectscript-review` prompt ..." in `packages/iris-dev-mcp/dist/prompts/deployAndTestClass.js` -> "each prompt answers one user text message" goes red for dev (1 failed).
- mutation: M24, the BEGIN marker line rendered with a trailing space in `renderAgentsMdSection`, then `gen:pack` -> 44 of the consumer test's 60 tests go red.
- mutation: M25, a line equal to the rule's own END marker appended to the rule source, then `gen:pack` -> the consumer test goes red (40 failed) while all 81 tests of `skills-pack-rule.test.ts` stay green: this hole was open before the QA stage. (Superseded in code review: `gen:pack` now exits 1 on such a source; see M31.)
- mutation: M26, "Only methods whose names start with `Test` run." changed to "Story 41 methods ..." (300 words, so the size cap stays satisfied), then `gen:pack` -> the hygiene test goes red for the source and both forms (3 failed) while `skills-pack-rule.test.ts` stays green (81 passed).
- mutation: M27, `assemblePack` made to throw on a rule body holding `IRIS-MCP-RULE` -> the two scratch-copy rows that pin "generated as is" go red (2 failed): the known-limit pin flips as intended when a refusal is added. (Superseded in code review: the refusal landed and the rows are refusal rows; see M31.)

**Runs.** The three new files, 98 tests, pass alone, with the Story 41.2 group (`skills-pack-rule`, `story-41-2-doc-claims`, `story-38-6-qa-edit-prompt-sdk-wire`, `validate-prompts`, `skills-generated-frontmatter`, `skills-pack`, `docs-prompt-sync`: 256 passed in one call), shuffled (seed 7), and with `live-gate-roster`, `gate-helper-copies`, `epic38-gate-guards`, `dist-freshness` (66 passed). `gen:pack:check` 16 files, `gen:skills:check` 13, `validate:prompts` 39 sources, `check:provenance` 27 agent files, `gen:governance-baseline:check` OK, `gen:tools-list-snapshot:check` 115, `git diff --stat packages/shared/src/bootstrap-classes.ts` empty. No IRIS was reached: the servers ran with `default` at 127.0.0.1:9 and no tool was called.

**Findings from the QA stage (reported to the lead, not filed).**

- `gen:pack` accepts a rule body that holds a marker line and writes an `agents-md` section that an exact-line reader finds ambiguous (observed on a scratch copy, exit 0). The review pass rejected a guard (triage log, Blind Hunter and Edge Case Hunter rows); nothing is ledgered. The real rule is now guarded by the consumer test (M25).
- Every remaining prompt, the four with only optional arguments included (`audit-security-posture`, `recover-stuck-production`, `check-system-health`, `run-external-backup`), answers `prompts/get` with `arguments` omitted entirely by a -32602 "Invalid arguments" from the SDK; `objectscript-review` was the only shipped prompt that rendered from that request. The behaviour predates Story 41.2 (the all-optional prompts are unchanged), nothing is ledgered, and the 39.6 wire test accepts either outcome for `recover-stuck-production`.
- For 41.6: whether a BOM at byte 0 of a user's `AGENTS.md` belongs to line 1 decides if a section on the first line is found; the form cannot settle it.

### Code-review pass (2026-10-19)

**Patches.**
- `assemblePack` refuses a rule source with a line that starts with `<!-- IRIS-MCP-RULE:`: exit 1, the file named, nothing written. QA's two "generated as is" rows of `story-41-2-qa-agents-md-consumer.test.ts` are now refusal rows (its own BEGIN, its own END, another rule's marker in CRLF), and each removes its source and re-checks the scratch tree. The order-dependent "beside those" row and the tautological `outsideIsUntouched` are gone.
- `skills-pack-rule.test.ts`: every refusal row checks that the scratch tree is clean once its own input is removed, replacing the order-dependent "is clean again after the refusals" row (80 tests).
- The unknown-rule message and the 41.1 row title state the name pattern as "lower-case letters and digits, in groups joined by single hyphens".
- The retirement sweep of `story-41-2-doc-claims.test.ts` also walks `docs/`, `scripts/`, `ipm/`, `extensions/`, `.changeset/` (the two allowed files skipped), each package's `scripts/` and `package.json`, and the root `package.json`. It exempts only the `tool_support.md` note's own text.
- Dev's tarball row of the stdio wire test has a 120 s limit.
- The CHANGELOG names the marker-line refusal and QA's three test files. `skills-pack-src/README.md` lists the refusal.

**Mutations (Rule 19).** Each was applied, observed red, and reverted. The fingerprint of `git status --short`, `git diff` (spec excluded) and the untracked files' hashes was `a81292c138d8` before and after every one. Dist files were restored with `cp -p` from a backup, so their sha1 and mtime are unchanged.

- mutation: M28 (AC 41.2.3, the tarball lists both forms), `"!skills-pack/rules/**"` added to client-config's `files` -> 7 red: `pack-provenance.test.ts` ("real tree passes every provenance rule", "client-config tarball ships every pack file and the notice", the check-provenance CLI row) and `story-41-1-qa-pack-tarball.test.ts` (4, including "both forms of the always-on rule ... at the expected paths").
- mutation: M29 (AC 41.2.3, the second run changes nothing), `renderPackReadme` given a `process.hrtime.bigint()` in its title -> 2 red in `skills-pack-rule.test.ts`: "a second run of the real tree changes nothing ..." and "... a second run changes nothing" for the byte variants.
- mutation: M30 (Unchanged counts), `iris_doc_get` renamed in `packages/iris-dev-mcp/dist/tools/doc.js` -> `pnpm gen:governance-baseline:check` exits 1 ("a FROZEN foundation key disappeared"; `iris_doc_get` named). The rename also stops `gen:tools-list-snapshot:check`, but at preset coverage, so its drift path was proven by M30b.
- mutation: M30b (Unchanged counts), `iris_doc_get`'s title changed to "Get Document M30b" in the same dist file -> `pnpm gen:tools-list-snapshot:check` exits 1 with "iris-dev-mcp iris_doc_get.title differs at $.title".
- mutation: M31 (the marker-line refusal), `MARKER_LINE_START` changed to a pattern that never matches -> the 3 refusal rows of `story-41-2-qa-agents-md-consumer.test.ts` go red (57 passed).
- mutation: M32 (hermeticity), the frontmatter rows' cleanup pointed at another file name -> each row of "exits 1 on a rule source with %s" goes red on its own "clean again once the source is removed".
- mutation: M33 (AC 41.2.2, the sweep), a `docs/m33-review-probe.md` naming the prompt, plus a second mention inside the one-line `tool_support.md` paragraph -> the sweep goes red naming `docs/m33-review-probe.md:3` and `tool_support.md:450`. The sweep before the patch saw neither.

## Auto Run Result

Status: done
Blocking condition: none

**Summary.** The ObjectScript pre-write checklist is now one hand-authored, probe-verified rule source, `skills-pack-src/rules/iris-mcp-objectscript-pre-write.md` (299 words by the retired prompt's counter, 2,120 bytes, sha256 prefix `4d5702cb9f53`, ASCII, no frontmatter, no tool name). `gen:pack` renders it as `rules/claude-code/<name>.md` (the source bytes) and `rules/agents-md/<name>.md` (the same bytes between the `IRIS-MCP-RULE` BEGIN and END marker lines) and refuses frontmatter and any entry of `rules/` that is not a flat `<name>.md`. The `objectscript-review` prompt and both generated skill copies are retired (AD-15): prompts 13 to 12, dev 5 to 4, `gen:skills` files 14 to 13, pack files 15 to 16, validator sources 39 (12 prompts, 27 content files). The live Claude Code check ran and the hook oracle decided: `InstructionsLoaded` fired for the unscoped rule at `session_start` before the `iris_doc_put` call, and did not fire for the `paths:`-scoped copy (total cost 0.0112 USD over two haiku sessions). `BOOTSTRAP_VERSION` stays `5296a1c836f4`; no tool, key, preset, route or bootstrapped class changed; tools 110 package / 115 advertised; governance baseline `1e62c5ad5bf7`/141 unchanged.

**Files changed.**

- `skills-pack-src/rules/iris-mcp-objectscript-pre-write.md` (new): the rule source. `skills-pack-src/README.md`: the rules row and a section on the two forms and the markers.
- `scripts/lib/skills-pack.mjs`: `RULE_FORM_DIRS`, `RULE_SOURCE_NAME`, `ALWAYS_ON_RULE_FILENAME`, `agentsMdMarkers`, `renderAgentsMdSection`, the two refusals, and the pack README layout lines. `scripts/gen-pack.mjs`: header comment only.
- `packages/client-config/skills-pack/` (generated): both rule forms, the regenerated README, and the removed `objectscript-review` skill. `skills/` (generated): the removed skill and its README row.
- `packages/iris-dev-mcp/src/prompts/objectscriptReview.ts` (deleted) and `index.ts` (no longer registers it). `packages/shared/src/server-base.ts` and `prompts-guardrails.test.ts`: two comments reworded.
- `README.md`, `packages/iris-dev-mcp/README.md`, `tool_support.md`, `CHANGELOG.md`, `.changeset/story-41-2-objectscript-pre-write-rule.md`: the retirement, the counts and the new section.
- Tests: `skills-pack-rule.test.ts` and `story-41-2-doc-claims.test.ts` (new); the pins in the Code Map moved to the new counts; the 41.1 rule fixtures moved to the two-form shape; the wire test gained a fixture zero-argument prompt case.

**Review.** Four layers returned 29 findings, counted from the triage log: high 0, medium 4, low 18, false 7, maybe-false 0. Patched, as 8 grouped entries (2 medium, 6 low): a Client-level zero-argument prompt case (three layers saw the same lost coverage); `story-41-2-doc-claims.test.ts` for the two unpinned AC 41.2.2 bullets; the pack README layout lines; the vacuous `startsWith("---")` for the `agents-md` form; the missing mutation lines (M10 to M19); the `tool_support.md` retirement note; and two CHANGELOG wording fixes (the rule-name pattern, the negative-control claim). Nothing deferred. Rejected, each with its reason in the triage log: a marker-line guard in `assemblePack` (maintainer-authored single rule, a new refusal branch), the dist-reading test (fails loudly on an unbuilt checkout like its siblings), the word counter and the byte-variant embedding (the spec requires both), the stale `rule:` pack path in `listAgentContentFiles`, and the descriptive intent-audit divergences.

**Follow-up review recommendation: true.** Two medium entries were patched. The unverified risk is that the review-pass patches (the new doc-claims test and its sweep, the zero-argument wire case, the regenerated pack README text) were written after the layers read the diff; each carries a recorded mutation and the full suites ran green on the patched tree, but no layer has read them.

**Verification.** `(loop)` and `(once)` commands all green on the final tree: dev rebuilt from a deleted `dist` (0 `objectscriptReview` files); `gen:skills:check` 13 files; `gen:pack` twice, no change, `gen:pack:check` 16 files; `validate:prompts` `39 source(s) checked (12 prompt(s) + 27 content file(s): 12 workflow, 14 pack, 0 knowledge, 1 rule)`; `check:provenance` `0 provenance row(s), 27 agent file(s), 8 distribution(s)`; client-config tarball lists both forms and no `objectscript-review`, dev tarball lists no `objectscriptReview`; `@iris-mcp/dev` 1663, shared 2071, admin 498, interop 672, ops 350, client-config 514 tests pass; `@iris-mcp/all` 108 test files in three calls (36 files each) pass; dev lint and type-check clean; `gen:governance-baseline:check`, `gen:tools-list-snapshot:check` (115 entries) and `check-epics-sync` OK; `git diff --stat packages/shared/src/bootstrap-classes.ts` empty. `iris_doc_list filter:"Probe412" generated:true` returns `[]`.

**Residual risks.**

- `listAgentContentFiles` still labels a `rule:<f>` source with `packRel: rules/<f>`, a path the pack no longer holds. A rule adapted from upstream could not satisfy `check:provenance` until that seam and the header position in the `agents-md` form are decided. No story plans an adapted rule.
- The zero-argument prompt case uses a fixture, because no shipped prompt declares none; interop's `recover-stuck-production` call accepts either a render or a clean refusal, so the spec's claim that it covers the happy path is weaker than written.
- The two live-check session transcripts remain under the user's `~/.claude/projects/` (prompts and tool calls, no credentials).
- Source-rule corrections for the retro are listed under Design Notes ("Flagged for the retro"); this story did not edit those files.
