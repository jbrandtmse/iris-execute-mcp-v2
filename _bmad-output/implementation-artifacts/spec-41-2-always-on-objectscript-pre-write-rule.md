---
title: 'Story 41.2: Always-On ObjectScript Pre-Write Rule'
type: 'feature'
created: '2026-10-19'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
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

## Spec Change Log

- **2026-10-19, lead spec gate.** Wave-7 decisions #4, #5 and #6 were taken as recommended (Design Notes). Applied:
  - **Spine (Rule 20).** AD-28's Sources and Shape bullets, plus a rule-source bullet. AD-15's sanctioned list now says the retirement happened. The conventions table gains "Marked blocks".
  - **`epics.md`.** AC 41.5.1 now reads "the 12 prompts that remain after Story 41.2 retired `objectscript-review`", marked `[AMENDED 2026-10-19]`.
  - **Constraints on the live check (decision #6).** It runs only in the stage's scratchpad project, never in the repository. Its only write is `ExecuteMCPv2.Temp.Probe412Live`. The copied credentials are deleted with the directory, and the recorded `total_cost_usd` must stay within the USD 1 cap per session.

## Review Triage Log

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

## Auto Run Result

Status: ready-for-dev
Blocking condition: none
