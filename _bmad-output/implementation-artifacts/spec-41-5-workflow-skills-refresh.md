---
title: 'Story 41.5: Workflow Skills Refresh'
type: 'feature'
created: '2026-10-19'
status: 'done'
baseline_revision: '9ae509bc78ef776fe61c657661d2615e3f994b60'
baseline_commit: '9ae509bc78ef776fe61c657661d2615e3f994b60'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings:
  - multiple-goals
  - oversized
deferred: []
---

<intent-contract>

## Intent

**Problem:** Agents choose a skill by its description, but each of the 12 generated workflow skills copies its MCP prompt's own description. That description says what the prompt does, never when to use it. Each generated skill also opens with a comment that names repository paths and tooling. Nothing checks which tool preset a skill needs, and nothing checks agent content for internal references. The pack has no catalog of what it holds.

**Approach:**

- **A skill-only field.** `PromptDefinition` gains an optional `skill: { description, preset }` field that only `gen:skills` reads. All 12 prompts set it (golden texts in Design Notes). A stdio pin proves that `prompts/list` and `prompts/get` stay byte-identical, and that no skill field reaches the wire.
- **The generated skill.** `gen:skills` writes the skill description, a `metadata:` map holding `iris-tools-preset: <core|developer|full>`, and a one-line DO-NOT-EDIT comment that names no repository path.
- **Grammar and catalog.** The frontmatter grammar accepts that optional map. `gen:pack` renders the pack README as a catalog of the knowledge skills, the workflow skills and the rule.
- **Two checks.** `validate:prompts` gains a preset-visibility check and a no-internal-references check, which accepts exactly the adaptation header line (DW-623). Both run in the default suite and are proven red on the paths they guard.

## Boundaries & Constraints

**Always:**

- **The prompts are unchanged on the wire.** The names, titles, descriptions, arguments and rendered text of all 12 prompts stay byte-identical. The golden wire sha256 values in Design Notes were captured at `26dc8b2` before any change. The `skill` field is additive and optional (AD-15). `McpServerBase.registerPrompt` keeps passing only `title`, `description` and `argsSchema` to the SDK.
- **Generated files change only through their generators (AD-14).** `skills/` changes only through `pnpm gen:skills`, and the pack only through `pnpm gen:pack`. The 12 generated `SKILL.md` files and the pack `README.md` equal their golden sha256 values (Design Notes).
- **Agent content is the product (decision #15).** Each clause of a skill description restates a step of that skill's own body. Each description:
  - starts with what the skill covers, then has a `Use when` sentence;
  - is at most 1,024 characters of printable ASCII;
  - holds no `|`, no XML-like tag and no `iris_*` token.
- **Where the checks live (AD-2).** Check logic lives in `scripts/lib/` and is shared by each CLI and its test. `scripts/lib/skills-pack.mjs` keeps exactly its current imports, because the gen-pack CLI fixture copies only three script files. `gen:pack` still needs no build.
- **Fail safe.** Unknown metadata keys and invalid preset values are refused. The preset check counts only `iris_*` tokens that name real tools, so an unknown token is still reported once, by the unchanged tool-name check. The tool-name check's output lines and first OK line do not change.
- **Source text.** New `.mjs`/`.ts` code is ASCII (Rule 14). Write files with the file tools, never a heredoc (#55).

**Never:**

- **Other surfaces.** No change to any tool, action, governance key, preset roster (AD-7), refusal code, route or bootstrapped class. No change to a prompt's name, title, description, arguments or `build`. No change to the knowledge skill sources, the rule source or the notice.
- **Other stories' scope.** No installer (41.6). No root-README pack section and no removal of `skills/README.md` (41.7). No plugin (42.8).
- **Files not to edit:** `.claude/rules/*`, `CLAUDE.md`, the spine, `epics.md`, `irislib/`, `irissys/`, `src/`, the installer-managed `.claude/skills/bmad-*`, and earlier `CHANGELOG.md` sections.
- **IRIS.** No IRIS call. This story needs none, and the tool catalog comes from the built dists.
- **Git.** No `git commit`, `git push`, `git reset` or `git rebase`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Regenerate | `pnpm gen:skills` twice on the built tree | The 12 `skills/<name>/SKILL.md` files equal their golden sha256 values. The second run changes nothing. `gen:skills:check` prints `13 generated file(s)` | No error expected |
| Wire unchanged (Integration) | Each built server over stdio (closed port 127.0.0.1:9) | `prompts/list` and every `prompts/get` (each argument `v-<name>`) hash to the golden sha256 values. Every entry's keys are exactly `name,title,description,arguments`. Its description equals the definition's `description` and differs from `skill.description`. No entry's JSON contains the skill description or `iris-tools-preset` | A leak turns the wire test red |
| Validator green (Integration) | `pnpm validate:prompts` on the real tree | Exit 0. Line 1 is unchanged: `...51 source(s) checked (12 prompt(s) + 39 content file(s): 12 workflow, 20 pack, 6 knowledge, 1 rule), 111 known tool name(s).` Line 2 is the golden second line (Design Notes) | No error expected |
| Preset too narrow | `deploy-and-test-class` declares `core` | Exit 1: `  - [preset] workflow:deploy-and-test-class/SKILL.md: declares the core tool preset, which hides iris_test_status (iris-dev-mcp), iris_test_coverage (iris-dev-mcp); declare developer`. The tools are listed in first-seen order in the file | Named per file |
| Preset wider than needed | A `developer` skill declares `full` | Exit 1: `... declares the full tool preset, but every tool it names is visible under developer; declare developer` | Named per file |
| Undeclared tool | A real tool named in a knowledge skill (no `metadata`) or in a rule | Exit 1: `... names iris_doc_put but declares no tool preset; declare metadata iris-tools-preset: core`. A file that is not a `SKILL.md` gets `...; only a SKILL.md can declare one, so name no tool here` | Named per file |
| Unknown token | `iris_not_a_real_tool` in any file | The legacy `  - <label>: "<token>"` line only, and no `[preset]` line | Exit 1 |
| Across servers | `check-system-health` (ops tools plus admin's `iris_database_manage`) | Each token is checked against its owner's roster. The first preset that shows them all is `full` | No error expected |
| Internal reference (Integration) | `Rule #7`, `DW-613`, `AD-28`, `Story 41.2`, `packages/shared/...`, `notes.md`, `/Users/x/`, `pnpm`, `irislib` in any prompt (title, description, body, skill description), workflow skill (frontmatter comment included), pack file, knowledge skill or rule | Exit 1: `  - [internal-reference] <label>: <class> (<match>)` | Named per file and class |
| DW-623 accepted | The real `iris-mcp-objectscript-sql` source and pack copy | The header line is exempt. Line 2 reports `2 adaptation header line(s) exempted` | No error expected |
| DW-623 controls | A second exact copy of the header in the adapted skill; the header as the first body line of a skill no provenance row names; the header that is not the first body line; the header with CRLF endings; the header with `(c)`; the row removed from the notice | Each is flagged as `a repository file (IRIS-MCP-THIRD-PARTY-NOTICES.md)` | The test goes red |
| Grammar | `metadata:` plus `  iris-tools-preset: developer` | Accepted by `check:provenance` | Each of these is refused with `[skill-frontmatter]`: an unknown metadata key, a preset outside `core`/`developer`/`full`, `metadata: x`, a map with no entry, a tab or four-space indent, a repeated key |
| Missing skill field | A prompt with no `skill`, an empty description, or a bad preset | `gen:skills` exits 1 and writes nothing. `validate:prompts` names it as `[skill-field] prompt:<pkg>/<name>` | Exit 1 |
| Catalog | `pnpm gen:pack` | The pack `README.md` equals its golden sha256 and lists, in this order, the 6 knowledge skills, the 12 workflow skills and the 1 rule. Each section is sorted by name, and each skill carries its description and declared preset. A `SKILL.md` without readable frontmatter renders the fallback text, and `gen:pack` still exits 0 | No error expected |
| Counts unchanged | `gen:pack:check`; `check:provenance` | `22 pack file(s)`; `1 provenance row(s), 39 agent file(s), 8 distribution(s)` | No error expected |

</intent-contract>

## Code Map

**Source (shared and the four prompt packages):**

- `packages/shared/src/tool-types.ts:206-228` -- `PromptDefinition`, where the optional `skill` field and the `PromptSkillDefinition` interface go. `import type { ToolPresetName } from "./tool-visibility.js"` adds no cycle, because `tool-visibility.ts` has no imports.
- `packages/shared/src/index.ts:97-98` -- the `PromptDefinition`/`PromptArgumentDefinition` type exports; `PromptSkillDefinition` joins them. `ToolPresetName` is already exported at `:174`.
- `packages/shared/src/server-base.ts:1071-1075,1131-1137` -- `registerPrompt` passes only `{ title, description }` or `{ title, description, argsSchema }`. Unchanged; this is the code the off-wire pin protects.
- The 12 prompt definitions. Add `skill` after `description`:
  - admin: `auditSecurityPosture.ts:17`, `provisionProjectEnvironment.ts:16`;
  - dev: `diagnoseSlowQuery.ts:17`, `deployAndTestClass.ts:23`, `promoteEnvironmentChange.ts:33`, `editAndTestClass.ts:18`;
  - interop: `traceMessageFlow.ts:17`, `recoverStuckProduction.ts:19`, `resendFailedMessages.ts:20`, `findPatientMessages.ts:21`;
  - ops: `checkSystemHealth.ts:16`, `runExternalBackup.ts:16`.

  All are under `packages/iris-<pkg>-mcp/src/prompts/`.

**Scripts (all pure modules, except the CLIs):**

- `scripts/gen-skills.mjs:58-67` -- `renderSkillMd`, which moves to the new `scripts/lib/workflow-skills.mjs`. The rest of the file:
  - `:70-98` `renderReadme` stays here (the changes are below);
  - `:101-109` `computeExpectedFiles`;
  - `:1-28` the header comment, which states the contract.
- `scripts/lib/skills-pack.mjs` -- the pack module. It must keep exactly its current imports (`node:fs`, `node:path`, `./generated-tree.mjs`), because `skills-pack.test.ts:202` copies only `gen-pack.mjs`, `generated-tree.mjs` and `skills-pack.mjs` into its CLI fixture.
  - `:24-30` the SKILL FRONTMATTER header;
  - `:74-75` `SKILL_FRONTMATTER_FIELDS`, which stays `['name','description']`, pinned by `skills-pack-frontmatter.test.ts:59`;
  - `:128-151` `renderPackReadme`;
  - `:204-283` `skillFrontmatterProblems`;
  - `:355-385` the workflow and knowledge loops of `assemblePack`;
  - `:422` the README `add`.
- `scripts/lib/validate-prompts-core.mjs` -- the validator core:
  - `:45-47` `renderPromptText` stays as it is (the wire surface);
  - `:58-68` `validateSources` stays as it is.

  The two new pure checks join this file.
- `scripts/validate-prompts.mjs:37-75` -- the CLI. Its first OK line (`:68-74`) stays byte-identical.
- `scripts/lib/tool-catalog.mjs:42,77` -- `loadAllTools`/`loadAllToolNames`. The preset-catalog loader joins them; the import precedent is `scripts/lib/tools-list-snapshot-core.mjs:186` (`dist/tools/presets.js`).
- `scripts/lib/provenance-core.mjs:176-186` -- `hasValidAdaptationHeader`; `:138` `parseProvenanceRows`. The shared exemption function moves here from `skills-pack-knowledge.test.ts:399` (`checkedText`).
- `scripts/check-provenance.mjs:14-16` -- its header comment says "holds only a valid name and description".

**Docs:**

- `README.md:830` -- "YAML frontmatter (`name`, `description`) ... the same content".
- `skills-pack-src/README.md:15,34,38-40,65,74-78` -- the contributor doc.
- `CHANGELOG.md:5` -- the newest section is 41.4.
- `.changeset/story-41-4-platform-knowledge-skills.md` -- the changeset precedent.

**Tests that move** (all under `packages/iris-mcp-all/src/__tests__/` unless another path is given; the sweep for #56 found no others):

- `skills-generated-frontmatter.test.ts` -- `:98-100` (the header must name `gen-skills.mjs` and `pnpm gen:skills`), `:120-130` (`skills/README.md`).
- `story-39-6-qa-forensics-prompts-sdk-wire.test.ts:456-466` -- "the generated skill carries the description the wire serves".
- `story-40-4-qa-live-gate.test.ts:749-765` (A5) and `story-40-5-qa-live-gate.test.ts:697-712` (P6) -- live, armed by `IRIS_REQUIRE_LIVE`. Each requires the skill description to equal the listed one.
- `skills-pack-frontmatter.test.ts:147` and `story-41-3-qa-frontmatter-process.test.ts:109` -- the unknown-field message `only name and description are allowed`.
- `story-41-3-qa-knowledge-gate-process.test.ts:2-7,115-136` -- these pin that `validate:prompts` accepts a real tool and a rule number, DW id, AD id or path in a knowledge skill ("it checks tool names only"). They invert.
- `story-41-1-qa-validate-prompts-pack.test.ts:139-150` -- the knowledge fixture names `iris_doc_get` with no declaration, and the rule fixture names `iris_doc_search`.
- `skills-pack-knowledge.test.ts:399-406` -- `checkedText`, which becomes the shared function. Its controls stay.

**Tests extended:**

- `story-41-2-qa-prompts-stdio-wire.test.ts` -- the stdio harness, through `openWireSession` (`process-gate-helpers.ts:265`); its `rowOf` (`:130-132`) reads only name, title and arguments.
- `packages/shared/src/__tests__/prompts.test.ts:160-200` -- the in-memory `prompts/list` tests.
- `skills-pack.test.ts:49-82` -- its fixtures write `SKILL.md` files with no frontmatter (`:53,55,146-147,208-209`), and `:328-361` uses `zz-probe-skill`.
- `validate-prompts.test.ts` -- the core and the real tree.

**Pins that stay** (verified):

- `skills-pack-frontmatter.test.ts:448-453`: the golden `promote-environment-change` description keeps a `->`.
- `skills-pack-rule.test.ts:475-479`: 12 README rows match ``/^\| `[a-z0-9-]+` \|/``.
- `prompt-safety-invariants.test.ts:398,553,589-599`.
- Interop `prompts.test.ts:210-220,338`: no `|` in `prompt.description`.
- `skills-pack-knowledge.test.ts:453`: the knowledge frontmatter is exactly 4 lines, so knowledge skills carry no `metadata`.
- `docs-prompt-sync.test.ts`, `story-41-2-doc-claims.test.ts`, and `story-39-6-doc-claims.test.ts:483` (an absence scan of `skills/README.md`).

## Tasks & Acceptance

**Execution:**

- **`packages/shared/src/tool-types.ts`, `packages/shared/src/index.ts`** -- AD-28, AD-15. Add:

  ```ts
  export interface PromptSkillDefinition { description: string; preset: ToolPresetName }
  ```

  and an optional `skill?: PromptSkillDefinition` on `PromptDefinition`. Its doc comment states the contract: these are the model-invocation fields of the workflow skill generated from this prompt; only the skill generator reads them, and `registerPrompt` never passes them to the SDK. Export the type. Rebuild shared.
- **The 12 prompt files** -- AC 41.5.1. Set `skill: { description, preset }` exactly as in the golden table. Only the new property changes in each file. Rebuild the four packages.
- **`scripts/lib/workflow-skills.mjs`** (new, pure) -- AC 41.5.1, 41.5.4.
  - `WORKFLOW_SKILL_COMMENT = '# DO NOT EDIT: generated from the MCP prompt of the same name.'`.
  - `promptSkillProblems(prompt)` returns `string[]` with these messages:
    - `has no skill field; give its prompt definition a skill with a description and a preset`;
    - `has an empty skill description`;
    - `has the skill preset "<v>", which is not one of core, developer and full`.
  - `renderWorkflowSkill(prompt)` returns:

    ```
    ---\n<comment>\nname: <name>\ndescription: <JSON.stringify(skill.description)>\nmetadata:\n  iris-tools-preset: <preset>\n---\n\n<build({})>\n
    ```

  Import the preset constants from `skills-pack.mjs`. This extends `renderSkillMd`, which moves here rather than being copied.
- **`scripts/gen-skills.mjs`** -- AC 41.5.1, 41.5.2.
  - Use `workflow-skills.mjs`. Before any write, and also in `--check`, print `gen-skills: prompt <pkg>/<name> <message>` for each problem and exit 1.
  - `renderReadme`, which stays the 13th generated file:
    - The banner stays as it is (the file is contributor-facing, not agent content).
    - The intro paragraph after the title becomes the golden intro (Design Notes).
    - `(\`name\`, \`description\`)` becomes `(\`name\`, \`description\`, \`metadata\`)`.
    - The table becomes `| Skill | Server | Tool preset | Description |` / `|---|---|---|---|`, with rows ``| `<name>` | <pkg> | `<preset>` | <skill.description> |``.
  - Update the header comment to the new contract.
- **`scripts/lib/skills-pack.mjs`** -- AC 41.5.2, 41.5.4. No new import.
  - **Constants:** `SKILL_OPTIONAL_FRONTMATTER_FIELDS = ['metadata']`, `SKILL_METADATA_KEYS = ['iris-tools-preset']`, `SKILL_PRESET_KEY = 'iris-tools-preset'`, and `SKILL_PRESETS = ['core','developer','full']`. That array order is the minimality order.
  - **Reader:** export `readSkillFrontmatter(text, dirName)`, returning `{ fields: {name?, description?}, metadata: {[key]: string}, problems }`. A metadata value is recorded even when it is invalid. `skillFrontmatterProblems` returns its `problems`, so the API and every current message stay the same, except two:
    - the unknown-field message becomes `has the field "<k>"; only name, description and metadata are allowed`;
    - new messages cover the grammar in Design Notes.
  - **Catalog:** `renderPackReadme(contents)` renders the golden catalog template. `assemblePack` builds `contents`:
    - workflow skills from `skills/<n>/SKILL.md`, and knowledge skills from their sources, through the reader (with the fallback text when the description cannot be read);
    - rules with their first heading.
  - Update the header comment.
- **`scripts/lib/provenance-core.mjs`** -- DW-623. Export `withoutAdaptationHeader(text)`, the body of today's `checkedText`:
  - return the text unchanged unless `hasValidAdaptationHeader(text)` holds;
  - split on `\n`;
  - remove only the first line equal to `ADAPTATION_HEADER`, with the `at < 0` guard.
- **`scripts/lib/tool-catalog.mjs`** -- AC 41.5.4. Add `loadToolPresetCatalog(root)`, which returns `{ owners: Map<tool, pkg[]>, rosters: {<pkg>: toolPresets} }` from each `SERVER_PACKAGES` `dist/tools/index.js` and `dist/tools/presets.js`.
- **`scripts/lib/validate-prompts-core.mjs`** -- AC 41.5.4, DW-623. Add:
  - `INTERNAL_REFERENCE_CLASSES(repositoryEntries)`, returning `[name, RegExp, sample]` entries (Design Notes);
  - `internalReferenceProblems(sources, { repositoryEntries, adaptedPackFiles })`, returning `{ problems: [{label, className, match}], exempted }`. It reads `withoutAdaptationHeader(text)` only for a source whose `packRel` is in `adaptedPackFiles`;
  - `presetProblems(sources, catalog)`, returning `{ problems: [{label, message}], declared: {core, developer, full}, toolFree }`. Each source is `{label, text, packRel, preset: string|null}`.

  The messages and visibility rules are in Design Notes.
- **`scripts/validate-prompts.mjs`** -- AC 41.5.3, 41.5.4. Keep the tool-name section and the first OK line byte-identical, and add:
  - **Prompt sources:** a prompt's text is `renderPromptText(prompt)`, then `\n`, then `skill?.description ?? ''`. `promptSkillProblems` yields `[skill-field]` problems.
  - **Content files:** each declares through `readSkillFrontmatter(...).metadata['iris-tools-preset']`, only when `packRel` matches `^skills/[^/]+/SKILL\.md$`; otherwise `null`.
  - **Exemption set:** `adaptedPackFiles` is the row pack files of `parseProvenanceRows` over `skills-pack-src/IRIS-MCP-THIRD-PARTY-NOTICES.md`. A missing notice gives an empty set.
  - **Repository entries:** `repositoryEntries = readdirSync(root)`.
  - **Output:** problem sections in the order skill-field, preset, internal-reference (headers in Design Notes); exit 1 on any problem; on success, line 2. The closing guidance on failure also names the prompt's `skill` field and the `metadata` `iris-tools-preset` declaration. The header comment states the new checks.
- **`scripts/check-provenance.mjs:14-16`** -- the header comment says the frontmatter holds a valid `name` and `description` and, optionally, a valid `metadata` map. The behavior comes from the shared grammar.
- **`packages/iris-mcp-all/src/__tests__/skills-pack-knowledge.test.ts`** -- Rule 2. `checkedText(text, adapted)` becomes `adapted ? withoutAdaptationHeader(text) : text`. Every control stays.
- **Wire pin and back-compat:** `story-41-2-qa-prompts-stdio-wire.test.ts` and `packages/shared/src/__tests__/prompts.test.ts` -- AC 41.5.1, AD-15, AD-28.
  - **Stdio** (new describe): per server, `sha256(JSON.stringify(listPrompts()))` and each `getPrompt({name, arguments: v-<arg>})` equal the golden values. Each entry has exactly the keys `name,title,description,arguments`, and its description equals the definition's (`loadAllPrompts`) and is not `skill.description`. No entry's JSON contains a skill description or `iris-tools-preset`. Update the header comment.
  - **Shared (in memory):** one fixture prompt with `skill` set lists without either string.
- **`skills-generated-frontmatter.test.ts`** -- AC 41.5.1.
  - A typed oracle table: the 12 names with their golden description, preset and sha256.
  - Each description is printable ASCII and at most 1,024 characters, holds no `|`, no XML-like tag and no `iris_*` token, and contains `. Use when `.
  - Each file's frontmatter lines are exactly `[comment, name, description JSON, "metadata:", "  iris-tools-preset: <p>"]`. The body equals `build({})`. The description equals the dist's `skill.description` and differs from `prompt.description`.
  - The frontmatter names neither `gen-skills.mjs` nor `pnpm`.
  - `skills/README.md` keeps DO NOT EDIT, `gen-skills.mjs` and the 12 names, and gains the `Tool preset` column and the catalog path.
  - Unit rows for `promptSkillProblems` and `renderWorkflowSkill` with fixture prompts.
- **`story-39-6-qa-forensics-prompts-sdk-wire.test.ts:456`, `story-40-4-qa-live-gate.test.ts` A5, `story-40-5-qa-live-gate.test.ts` P6** -- each asserts that the skill description equals the definition's `skill.description`, and that the listed description is the unchanged prompt description. Retitle each test.
- **`skills-pack-frontmatter.test.ts`, `story-41-3-qa-frontmatter-process.test.ts`** -- AC 41.5.4. `SKILL_PRESETS` equals `['core','developer','full']` and holds exactly the names of shared's `TOOL_PRESET_NAMES` (from `packages/shared/dist/index.js`; Rule #44). The new unknown-field message, and the grammar rows (accept: a valid block, a comment inside it, any field order; refuse: each case in the I/O matrix). In the process test, add a valid-metadata `ACCEPTED` row and an unknown-metadata-key `BAD` row.
- **`skills-pack.test.ts`** -- AC 41.5.2.
  - The fixture-root catalog with exact expected text: two skills with frontmatter, one with no frontmatter (the fallback), a rule with and a rule without a heading, and `None.` for an empty section.
  - The real tree: the committed README lists every `skills/` and `knowledge/` directory name, and every rule, in the section order and sorted. Each entry's description and preset equal its frontmatter.
  - The existing assertions stay.
- **`validate-prompts.test.ts`** -- AC 41.5.4, DW-623.
  - Each class's sample is flagged, and the real tree is clean.
  - **Preset units:** too narrow, wider than needed, undeclared, a declaration with no tool, an invalid value, an unknown token ignored, and two owners on two servers (a typed catalog fixture).
  - **DW-623 controls (core):** accepted, a second copy, not row-marked, not the first body line, CRLF, `(c)`, and a prompt source.
  - **The real tree:** 24 files declare a preset (12/6/6) and 15 are tool-free; the CLI's line 2 is the golden text.
  - No new problem line matches the legacy `^ {2}- (.+): "(.+)"$`.
- **`validate-prompts-pack-checks.test.ts`** (new; scratch copies through `makeScratchRepo({ serverPackages: true })` and `runScript`) -- AC 41.5.4, DW-623, #59 on the guarded path.
  - **Preset:** a workflow skill (and its pack copy) narrowed to `core`, a `developer` skill widened to `full`, and a real tool in the rule.
  - **Internal reference:** the old three-line header written into one workflow skill and its pack copy (`a repository path (scripts/)`, `a repository file (gen-skills.mjs)`, `repository tooling (pnpm)`).
  - **DW-623:** a second header copy in the SQL source and pack copy; the header added to `iris-mcp-objectscript-gotchas` (source and pack copy); the SQL row removed from the scratch notice. Each row is red with exact `[kind] label` pairs, and green again once repaired.
- **`story-41-3-qa-knowledge-gate-process.test.ts:115-136`** -- invert the rows, and update the header comment `:2-7`:
  - a real tool in a knowledge skill gives `[preset]` for `knowledge:` and `pack:`;
  - a rule number, DW id, AD id or repository path gives `[internal-reference]` for both, with exit 1.
- **`story-41-1-qa-validate-prompts-pack.test.ts:139-150`** -- the knowledge fixture adds `metadata:\n  iris-tools-preset: core`, and the rule fixture names no tool. The pinned count line stays.
- **Docs:**
  - `README.md:830`: the golden sentence.
  - `skills-pack-src/README.md`: the changes in Design Notes.
  - `CHANGELOG.md`: a new top section, `## [Pre-release — YYYY-MM-DD] — Story 41.5: Workflow skills refresh` (UTC date), with `### Added`, `### Changed`, `### Tests` and `### Known limits`. The paragraph on unchanged counts says: tools 110/115, prompts 12 byte-identical on the wire, `gen:skills` 13, pack 22, `BOOTSTRAP_VERSION` `5296a1c836f4`, baseline `1e62c5ad5bf7`/141.
  - `.changeset/story-41-5-workflow-skills-refresh.md` (new): `@iris-mcp/shared` and `@iris-mcp/client-config` minor; `@iris-mcp/dev`, `@iris-mcp/admin`, `@iris-mcp/interop` and `@iris-mcp/ops` patch (AD-29).
- **`pnpm gen:skills`, then `pnpm gen:pack`** -- AD-14. Both outputs are part of the diff.

**Acceptance Criteria:**

- **Descriptions (AC 41.5.1).** Given the built tree, when `pnpm gen:skills` runs, then each of the 12 `skills/<name>/SKILL.md` equals its golden sha256, and its frontmatter holds the golden description and preset. When `skills-generated-frontmatter.test.ts` runs, each description equals the definition's `skill.description`, differs from its `description`, and opens with what the skill covers followed by a `Use when` sentence.
- **Prompt text keeps its role (AC 41.5.1, AD-15, AD-28).** Given the four built prompt servers, when the stdio test lists and renders every prompt, then the results hash to the golden values captured at `26dc8b2`, and no skill field appears on the wire.
- **Catalog (AC 41.5.2).** Given the committed pack, when `skills-pack.test.ts` and `pnpm gen:pack:check` run, then `packages/client-config/skills-pack/README.md` equals its golden sha256. It lists the 6 knowledge skills, the 12 workflow skills and the 1 rule, in that order, each with what it is for; and `22 pack file(s)` match.
- **Checks pass (AC 41.5.3).** Given the regenerated tree, when `pnpm gen:skills:check` and `pnpm validate:prompts` run, then both exit 0. The first prints `13 generated file(s)`; the second prints its unchanged line 1 and the golden line 2.
- **Preset visibility (AC 41.5.4).** Given a skill whose declared preset hides a tool it names, or is wider than needed, or a tool named without a declaration, when `validate:prompts` runs on a scratch copy, then it exits 1 with the `[preset]` line for every affected label.
- **No internal references (AC 41.5.4).** Given an internal reference of any class in a prompt, a workflow skill (its frontmatter comment included), a pack file, a knowledge skill or the rule, when `validate:prompts` runs, then it exits 1 naming the label and the class.
- **DW-623.** Given the shipped adapted skill, when `validate:prompts` runs, then its header line is exempt (`2 adaptation header line(s) exempted`), and every DW-623 control in the I/O matrix is flagged.
- **Unchanged counts.** Given the suite, when the `(once)` gates run, then:
  - `gen:governance-baseline:check` reports `1e62c5ad5bf7`/141;
  - `gen:tools-list-snapshot:check` reports no drift;
  - `check:provenance` prints `1 provenance row(s), 39 agent file(s), 8 distribution(s)`;
  - `git diff --stat packages/shared/src/bootstrap-classes.ts` is empty;
  - the tools stay at 110 package / 115 advertised.

### Review Findings

Code review 2026-10-19 (`bmad-code-review`, review tier `full-opus`). Four layers ran and all four delivered a payload: Blind Hunter, Edge Case Hunter, Verification Gap Reviewer and Acceptance Auditor. They reported 30 rows. 8 rows were rejected; the other 22 group into 15 entries, and the lead's item 6 adds one more, for 16 entries (0 high, 6 medium, 10 low). Each line gives severity, fix-risk, footprint and the Rule 15 disposition.

- [x] [Review][Patch] Prompt argument names and descriptions were never scanned. `prompts/list` serves them, but neither the tool-name check nor the internal-reference check read them (blind 2, edge 2, verification-gap other 3, auditor 4, lead item 1). Medium, fix-risk low, in-story. Fixed: `promptSourceText` adds `<name>: <description>` per argument, and the CLI, the tool-name check and the real-tree rows all read it. Line 1 and line 2 of the output are unchanged, re-derived from the CLI output. All 12 declared presets still meet the first-of rule over the widened text (`declared` 6/3/3), and the three tool-naming argument descriptions are pinned. [scripts/lib/validate-prompts-core.mjs:66]
- [x] [Review][Patch] The CLI's source assembly was copied into the real-tree tests, so a CLI that dropped a prompt's title, description and body stayed green (verification-gap 1; auditor 5, AD-2 "a check's CLI script and its test share one implementation"). Medium, fix-risk low, in-story. Fixed: `promptSourceText` and `declaredToolPreset` live in the core, used by the CLI and both real-tree rows. A new scratch CLI row puts an internal reference in a stub prompt's title, description, body and argument description, plus an unknown tool in the argument. [scripts/validate-prompts.mjs:70]
- [x] [Review][Patch] AC 41.5.4's "or the rule" leg had no test that could fail: the CLI would have printed 51 sources even with the rule sources filtered out (auditor 1). Medium, fix-risk low, in-story. Fixed: a scratch CLI row writes `irislib` into the rule source, runs `gen:pack`, and requires `[internal-reference]` for `rule:` and both `pack:rules/` forms. [packages/iris-mcp-all/src/__tests__/validate-prompts-pack-checks.test.ts:282]
- [x] [Review][Patch] The "every row ran in a scratch copy" checks were plain `it` rows. Under `--sequence.shuffle` they could run first, and they read only three strings (verification-gap 3, Rule 19 hermeticity). Medium, fix-risk low, in-story. Fixed in both scratch files: `beforeAll`/`afterAll` compare a fingerprint of the real `skills/`, `skills-pack-src/` and pack trees and the real ops prompts module. [packages/iris-mcp-all/src/__tests__/validate-prompts-pack-checks.test.ts:52, story-41-5-qa-gen-skills-refusal.test.ts:77]
- [x] [Review][Patch] Three golden descriptions over-claimed (auditor 3 plus this review's decision #15 sweep of all 12 descriptions against their bodies). Medium, fix-risk low, in-story.
  - `trace-message-flow` said "without running a recovery", but body step 6 allows a confirmed recovery.
  - `find-patient-messages` said the PHI data policy "redacts or withholds" bodies, but `allow` is a policy value (`data-policy.ts:26`) that does neither.
  - `edit-and-test-class` said it "reads only the lines around the change", but body step 1 allows a whole-document read.

  Fixed in the three prompt sources (off the wire), with dev and interop rebuilt and `gen:skills`/`gen:pack` regenerated. The golden table, descriptions, oracle sha256 values and catalog hash are updated (Spec Change Log). [packages/iris-interop-mcp/src/prompts/traceMessageFlow.ts:26]
- [x] [Review][Defer] The presets are not nested, but the docs never say so. `provision-project-environment` declares `core` and names `iris_user_manage`, which admin's `developer` hides, so a `developer`-preset user gets a `core` skill that cannot run (blind 1). Medium, fix-risk low, in-epic. The catalog template and its golden text are spec-bound, and Story 41.7 owns the pack docs — deferred: routed DW-624 owner=41-7-skills-pack-docs-and-capstone (the lead inserts the `DW-624:` bullet under Story 41.7 in `epics.md`). A Known-limits line is added to the CHANGELOG now. [packages/client-config/skills-pack/README.md:5]
- [x] [Review][Patch] Pinning tests with no `mutation:` line (verification-gap 4) were the AC "Unchanged counts" `check:provenance` leg, AC 41.5.3's `13 generated file(s)` leg, the 41.3 grammar rows, the inverted 41.3 knowledge rows, the changed 41.1 knowledge fixture, and the real-tree "declares one tool preset" row. Low, closed in this pass: mutations V4a-V4f under `## Verification`. [_bmad-output/implementation-artifacts/spec-41-5-workflow-skills-refresh.md]
- [x] [Review][Patch] Spelling variants the classes missed (blind 4, lead item 4). Low, fix-risk low, in-story. Widened under decision #20, only where the spelling is unambiguous and the real tree stays clean: `Rule#7`, `AC 41.5.1`/`DW 615`/`AD28`, `Stories`/`story-41-5`/`Epic41`, `./` and `../` before a repository path, `.yml`, `validate:` and `check:`. Each has a sample row. Everything else is enumerated, as of 2026-10-19, under the CHANGELOG's Known limits and the Residual risks below (Rule #56); not filed as DW. [scripts/lib/validate-prompts-core.mjs:144]
- [x] [Review][Patch] The bare-`#` class flagged legitimate ObjectScript (`i#2`, `Read x#5`), an HTML entity and a lower-case `error #5659`, against decision #20's "a bare `#n` that is not an IRIS error code" (edge 7). Low, fix-risk low, in-story. Fixed: no match after a word character or `&`, and `ERROR ` in any case; `Rule#7` stays caught by the widened rule-number class. [scripts/lib/validate-prompts-core.mjs:145]
- [x] [Review][Patch] The CHANGELOG and the 41.2 stdio row credited the SDK-side test with "exactly four keys", but the SDK's parse drops unknown keys (QA Q2). The changeset said only the skill generator reads the field (blind 6, edge 10, verification-gap other 1). Low, mechanical. Fixed: the CHANGELOG Tests bullet names the raw-frame rows and the QA files, the 41.2 row title and header claim only what the SDK view pins, and the changeset names both readers. [CHANGELOG.md:62]
- [x] [Review][Patch] The QA omitted-`arguments` rows pinned DW-617's SDK refusal with no pointer, so they would go red when 43.1 fixes DW-617 (blind 3, verification-gap 2). Low, mechanical. Fixed: the header and both row titles cite DW-617 and say 43.1 inverts the rows; `occurrence=41-5-workflow-skills-refresh` appended to DW-617. [packages/iris-mcp-all/src/__tests__/story-41-5-qa-dist-consumer.test.ts:17]
- [x] [Review][Patch] `stubPrompt` and `VALID_SKILL` were copied in two test files (blind 8, Rule 2). Low, mechanical. Fixed: `stubPromptSource` and `VALID_STUB_SKILL` in `story-41-5-qa-fixture.ts`, whose defaults are byte-identical to both copies. The two ops-stub helpers differ in purpose (one re-exports the real prompts, one links the tools), so they stay separate. [packages/iris-mcp-all/src/__tests__/story-41-5-qa-fixture.ts:35]
- [x] [Review][Patch] The YAML consumer passed every frontmatter block in one argv string: 25,231 characters today, against Windows' 32,767 limit (edge 9). Low, mechanical. Fixed: the blocks go on stdin. [packages/iris-mcp-all/src/__tests__/story-41-5-qa-yaml-consumer.test.ts:44]
- [x] [Review][Patch] The scratch row "gen:skills stops before writing" claimed more than it pins: its write-mode "nothing written" leg cannot fail on an up-to-date tree (verification-gap other 2, QA Q7). Low, mechanical. Fixed: retitled to what it pins, pointing at the stale-tree QA rows. [packages/iris-mcp-all/src/__tests__/validate-prompts-pack-checks.test.ts:375]
- [x] [Review][Patch] The docs said "nine classes" but listed eight, omitting the bare `#` class (auditor 2). Low, mechanical. Fixed in `skills-pack-src/README.md:83`, the `validate-prompts.mjs` header and the CHANGELOG Added bullet. [skills-pack-src/README.md:83]
- [x] [Review][Patch] The I/O matrix row "Across servers" had no pin on the real CLI path (lead item 6; M6 left the real tree green, because `check-system-health` needs `full` either way). Low, fix-risk low, in-story. Fixed: a scratch CLI row gives `check-system-health` a body naming ops' `iris_health_check` and admin's `iris_database_manage`. Each is in its own server's `core`, so the CLI exits 0 with `14 core, 6 developer, 4 full`; declared `full`, it is refused as wider than `core`. Mutation P4 (a first-owner lookup) turns it red. [packages/iris-mcp-all/src/__tests__/validate-prompts-pack-checks.test.ts:227]

Also checked, with no finding:
- `registerPrompt` is untouched (an empty diff of `server-base.ts`), and a leak turns the raw-frame rows red (Q2, N5).
- The grammar refuses each I/O-matrix case (probed: unknown key, bad preset, `metadata: x`, empty map, tab, four-space indent, repeated key, empty value).
- `skills-pack.mjs` keeps its three imports.
- The `gen:skills` refusal is atomic: every prompt is checked before any render or write, in both modes.
- The count pins are re-derived from CLI output.
- The changeset levels follow AD-29.
- The stdio wire hashes still match after the description fixes.

**DW-623: addressed.**
- `internalReferenceProblems` reads `withoutAdaptationHeader(text)` only for a `packRel` that a provenance row names. `withoutAdaptationHeader` removes the exact header only when it is the first non-blank body line (`hasValidAdaptationHeader`).
- The real tree exempts exactly 2 lines (the SQL source and its pack copy).
- These controls are each flagged, in the core and in the scratch CLI rows: a second copy, a file no row names, the header not on the first body line, CRLF, `(c)`, the row removed, and a prompt source. M10 a/b/c show the exemption is load-bearing and no wider.
- The lead's `ledger_adjudicated` can close it `resolved-by:41-5-workflow-skills-refresh`.

**Rejected** (8 layer rows: edge 4, blind 5 with edge 6, blind 7, edge 1, edge 3, edge 5 and edge 8; also listed are the second part of blind 8 and the lead's items 2, 3 and 5):
- `false`: the header removal uses `indexOf` and may remove another copy than the first body line (edge 4). When `hasValidAdaptationHeader` holds, the first body line is a header copy. If another copy is removed, that one remains and class 7 still flags the file, so no defect can pass.
- `low`, spec-bound (`by-design`): class 5 flags a user's own `src/`, `docs/` or `.claude/` path, and class 7 flags `AGENTS.md`, `CLAUDE.md`, `.mcp.json` and `package.json` (blind 5, edge 6). The classes are decided as the top-level repository entries and that extension list; the false positives are enumerated in the CHANGELOG's Known limits.
- `low`, spec-bound: a knowledge skill that names a tool is told to "declare metadata iris-tools-preset: core", which the 41.3 knowledge pins refuse (blind 7). The message is the I/O matrix's exact text, and decision #14's reversal path is to name tools once presets exist.
- `low`: a tool-free prompt could never pass, because the generator always writes a preset (edge 1). No prompt is tool-free, and the fix adds an optional-preset branch. It becomes real when a prompt that names no tool is added.
- `low`: a `|` or a newline in a skill description breaks the `skills/README.md` table (edge 3). Every prompt is in the typed oracle, which checks ASCII, no `|` and the length. This repeats the implement review's blind 2 / edge 1.
- `low`: the rule title misreads a BOM or a heading inside a code fence (edge 5). There is one rule with a plain first heading, the title rule is spec-defined, and the fix adds branches.
- `low`: the raw-wire harness throws on a non-JSON stdout line and waits 30 s on a dead server (edge 8). Both fail loudly, never silently.
- `low`: five tests declare a local `skill?:` shape instead of importing `PromptSkillDefinition` (blind 8, second part). These are structural casts over the untyped `.mjs` loader output.
- `low`, dismissed (lead item 2): the header comments of the pack `README.md` and `skills/README.md` name `pnpm gen:pack` and `scripts/`. Neither file is agent content. The 41.6 installer installs `skills/<name>/`, the rule forms and the notice, and Claude Code loads only `skills/<name>/SKILL.md`.
- `low`, dismissed (lead item 3): "informational in v1" in `check-system-health`. It is wire-frozen body text, and no class covers it.
- `low`, re-run (lead item 5): QA's Q1 mutation, re-run after its helper tightened. It is red as recorded: 5 rows in `story-41-5-qa-dist-consumer.test.ts` and 1 in the preset oracle.

## Spec Change Log

- 2026-10-19 (lead spec gate): the 7 orchestrator decisions were taken as recommended (wave-7 decisions #16-#22). Spine AD-28 was amended with the drafted text: the frontmatter `metadata` map, the first-of-core/developer/full preset rule, the prompt `skill` field, the nine internal-reference classes with the DW-623 exemption, and the catalog wording. The spine lint passed. Counts and the wire are unchanged.
- 2026-10-19 (code review, decision #15 and decision #20): the review changed these Design Notes values in place.
  - **Three golden descriptions corrected** to what their bodies say. In `trace-message-flow`, "recommends next steps without running a recovery" became "recommends next steps, never running a recovery without the user's confirmation". In `find-patient-messages`, "under the PHI data policy, which redacts or withholds them" became "..., which by default redacts or withholds them". In `edit-and-test-class`, "reads only the lines around the change" became "reads the lines around the change".
  - **New `SKILL.md` values,** from the regenerated files. `edit-and-test-class` went from 4338 to 4333 bytes (`636f70ba...` → `a26759dc...`). `find-patient-messages` went from 3412 to 3423 (`4e6472ab...` → `9d0ccda8...`). `trace-message-flow` went from 4767 to 4798 (`b2e6b081...` → `f3a2d19c...`). The descriptions stay within 411 to 601 characters.
  - **New catalog values:** 11611 → 11648 bytes, still 48 lines, `4806e801...` → `bdd1b54f...`.
  - **The wire is unchanged.** The 16 stdio hashes still match, because the `skill` field is never sent.
  - **The internal-reference classes widened,** each for an unambiguous spelling of its own class, with the real tree still clean. The narrowed class 2 now matches decision #20's "a bare `#n`". The class names and the count of nine are unchanged, so the spine is unaffected.
  - **The prompt source text now includes each argument's name and description.** `promptSourceText` in the core is read by the CLI and the tests. The I/O matrix row "Internal reference" names four prompt fields; arguments widen it and contradict nothing.

## Review Triage Log

### 2026-10-19 — Review pass
- verdicts: 31 findings — high 0, medium 2, low 25, false 4, maybe-false 0
- findings (layer order: blind, edge-case, verification-gap, intent-alignment):
  - `[medium]` `[patch]` (blind 1, with verification-gap 1; one root cause) The I/O matrix row "Missing skill field" had no CLI-path test: only the pure `promptSkillProblems` units ran, so deleting the `process.exit(1)` guard of `gen-skills.mjs`, the `[skill-field]` section of `validate-prompts.mjs`, or the skill description in a prompt's text would have left the suite green — patched: three scratch-copy rows in `validate-prompts-pack-checks.test.ts` (a stub ops package: `gen:skills` write and `--check` exit 1 and write nothing; `validate:prompts` names each `[skill-field]` prompt; an internal reference in a skill description is refused for the prompt), each proven red (mutations N1-N3 below).
  - `[low]` `[reject]` (blind 2) `promptSkillProblems` checks only emptiness and the preset, not the ASCII, 1,024, `|`, tag and `iris_*` constraints of the `PromptSkillDefinition` comment — the spec fixes the three messages of `promptSkillProblems`; a changed description fails the typed oracle (golden equality) and its ASCII/pipe/tag/token checks, and `check:provenance` checks length and tags of the generated file; a new branch is more than a direct correction.
  - `[low]` `[reject]` (blind 3) a declared preset counts every tool a skill names, so `deploy-and-test-class` is `developer` because of steps with a fallback — spec-bound: decision #16 fixes the exactness rule ("the first of core, developer and full under which every real tool the skill names is visible").
  - `[low]` `[patch]` (blind 4, with verification-gap 4; one root cause) the scratch row titled "the check reads each tool's own server" does not vary with that property (`check-system-health` needs `full` either way) — patched: retitled to claim only what it pins; the per-server rule stays pinned by the typed unit rows (M6 line).
  - `[low]` `[reject]` (blind 5) the absolute-path class knows only POSIX roots, so `c:/git/...` passes — spec-bound: the nine classes and their patterns are decided and golden; the shipped tree holds no such path.
  - `[low]` `[reject]` (blind 6) `repositoryEntries = readdirSync(root)` makes the verdict depend on stray local entries — spec-bound (Tasks name `readdirSync(root)`); a stray entry can only add a pattern, and CI and a clean checkout agree on the shipped tree.
  - `[low]` `[reject]` (blind 7) the classes duplicate `agent-text-hygiene.ts` `FORBIDDEN` — by-design: Design Notes "Extend, don't copy" records why the stricter hand-authored list stays separate (pinned by the 41.2 to 41.4 tests).
  - `[low]` `[reject]` (blind 8) no user-facing explanation of what a preset is — the golden texts of `README.md`, `skills/README.md` and the pack catalog intro (which names `IRIS_TOOLS_PRESET` and `full` as the default) are prescribed by the spec.
  - `[low]` `[patch]` (blind 9, with verification-gap 3; one root cause) the `prompts/get` assertion `expect(rendered.description ?? definition.description).not.toBe(skill.description)` compares two definition fields because the SDK's `prompts/get` result has no `description` (Rule 19, unfalsifiable) — patched: the line is deleted; the JSON `not.toContain` checks and the golden get hashes pin that leg, and a new mutation (N5) proves it red.
  - `[low]` `[reject]` (blind 10) the "Use when" triggers of `deploy-and-test-class` and `edit-and-test-class`, and of `find-patient-messages` and `trace-message-flow`, overlap — spec-bound: the 12 descriptions are the decided golden texts (sha256-pinned).
  - `[low]` `[reject]` (edge 1) same root cause as blind 2 (a `|` or a newline in a skill description breaks the `skills/README.md` table).
  - `[low]` `[reject]` (edge 2) a frontmatter description holding a JSON newline escape is rendered verbatim into one catalog line — unlikely input (every description is one-line prose and the golden catalog pins the 18 real ones); normalizing whitespace adds behavior the template does not specify.
  - `[low]` `[reject]` (edge 3) `./` and `../` prefixed paths pass the repository-path class — spec-bound: the lookbehind is the spec's own pattern.
  - `[low]` `[reject]` (edge 4) same root cause as blind 5 (the Windows path form).
  - `[low]` `[reject]` (edge 5) same root cause as blind 6 (`readdirSync(root)`).
  - `[low]` `[reject]` (edge 6) a declared preset says nothing about the other presets — by-design: the catalog states the rule ("the first of core, developer and full ... under which every tool it names is visible"), and the presets are not nested (Design Notes).
  - `[medium]` `[patch]` (verification-gap 1) same root cause as blind 1; patched there.
  - `[low]` `[patch]` (verification-gap 2) `catalog.rules.sort` (by stem) was unpinned: the loop's file-name sort already orders every fixture, and `a-b.md` sorts before `a.md` by file name but after `a` by stem — patched: a fixture row with `a.md` and `a-b.md` in `skills-pack.test.ts`; mutation N4 (sort line deleted) is red.
  - `[low]` `[patch]` (verification-gap 3) same root cause as blind 9; patched there.
  - `[low]` `[patch]` (verification-gap 4) same root cause as blind 4; patched there (retitle; the finding's `defer` disposition was not needed).
  - `[low]` `[patch]` (verification-gap, other: Rule 19) four added or changed tests had no `mutation:` line — the `SKILL_PRESETS` equals `TOOL_PRESET_NAMES` row, the changed Story 39.6 skill-description row, the catalog's fallback, preset-validity and rule-title rows, and the `22 pack file(s)` assertion — patched: each mutation applied, observed red and reverted; lines N6 to N9 below.
  - `[low]` `[reject]` (verification-gap, other) the edited live gates A5 and P6 were never executed — the live gates need `IRIS_REQUIRE_LIVE` and a running instance, and this story may not touch IRIS; they skip unarmed, type-check and lint green, and the same two properties (skill description equals the definition's, listed description unchanged) are pinned in the default suite by `skills-generated-frontmatter.test.ts` and the stdio test.
  - `[low]` `[patch]` (verification-gap, other) the standing criterion "in either order" had no recorded evidence — patched: the added and changed test files ran with `--sequence.shuffle` and two seeds, all green (535 and 110 tests).
  - `[low]` `[patch]` (verification-gap, other: rule #54) the `roster === undefined ||` clause in `visibleUnder` cannot be reached: `loadToolPresetCatalog` imports every server's `toolPresets`, which must define `core` and `developer` — patched: the clause and its comment are removed (a malformed roster now throws instead of showing every tool).
  - `[false]` `[reject]` (verification-gap, other) `visibleUnder` re-implements the server's visibility rule and no test links a declared preset to `tools/list` — no bad outcome today: `resolveVisibleTools` returns true for a name in `include`, false for one in `exclude`, and `assertPresetCoverage` requires every tool in exactly one of the two for both named presets, so `include` membership is visibility.
  - `[false]` `[reject]` (intent 1) no test installs a skill into a harness — the installer is Story 41.6; this story pins the generated files, the grammar and the catalog.
  - `[false]` `[reject]` (intent 2) the preset check reads rosters, not the server's resolver — same as the verification-gap finding above.
  - `[low]` `[reject]` (intent 3) a prompt's own `skill.preset` is checked through the generated file — recorded under the CHANGELOG's Known limits; `gen:skills:check` reports a skill that was not regenerated.
  - `[low]` `[reject]` (intent 4) the pack README catalog, `skills/README.md` and the notice are outside the internal-reference scan — by-design: agent content is the `listAgentContentFiles` set; the spec keeps both READMEs' banners and calls `skills/README.md` contributor-facing.
  - `[low]` `[reject]` (intent 5) same root cause as blind 6 (`readdirSync(root)`).
  - `[false]` `[reject]` (intent 6) "only `gen:skills` reads the field" against two script readers — wording only: the spec's own Tasks have `validate:prompts` read the field.

## Design Notes

**Orchestrator decisions needed** (the Lead's calls, delegated). This plan follows each recommendation.

- **Orchestrator decision needed: the preset declaration's format** -- recommended:
  - **Where it lives.** In the source, the prompt's `skill.preset`. In `SKILL.md`, a frontmatter `metadata:` map with the one key `iris-tools-preset`.
  - **Values.** `core`, `developer` or `full`: the `TOOL_PRESET_NAMES` of `tool-visibility.ts:48`, which a test cross-checks against `SKILL_PRESETS` (Rule #44).
  - **Exactness.** The value must be the first of `core`, `developer` and `full` under which every real tool the skill names is visible on the server that owns it.
  - **No preset.** No declaration means "names no tool". Knowledge skills and the rule carry none, so no golden text, sha256 or rule byte moves.

  Why:
  - The Agent Skills spec reserves `metadata` ("a map from string keys to string values. Clients can use this to store additional properties not defined by the Agent Skills spec") and recommends unique keys.
  - Its reference validator refuses any other top-level field: `ALLOWED_FIELDS = {name, description, license, allowed-tools, metadata, compatibility}`, error "Unexpected fields in frontmatter".
  - Claude Code documents `metadata` as a "free-form YAML map ... read by your own tooling" and ignores it (docs read 2026-10-19).
  - The key spells `IRIS_TOOLS_PRESET`, the one env value the five servers share (AD-7).
  - Presets are not nested: admin `developer` hides `iris_user_manage`, which `core` shows. So "the preset it needs" has to be a fixed-order rule, not "the smallest".
  - Checking each token against its owner's roster covers a skill that spans servers (`check-system-health` names admin's `iris_database_manage`).
  - The spine already says the rule and the knowledge skills "declare no preset".

  Alternatives: a top-level `preset:` key (refused by the reference validator); an explicit `none` (moves six golden texts, and a rule cannot carry frontmatter); per-server values (one env value is shared).
- **Orchestrator decision needed: the skill-only field's shape** -- recommended: an optional `skill?: { description: string; preset: ToolPresetName }` on `PromptDefinition`, required by `gen:skills` and `validate:prompts`. Why:
  - It is additive (AD-15).
  - The ten fixture prompts in shared's tests need no change.
  - One object keeps both skill-only fields in one place that `registerPrompt` never reads.
- **Orchestrator decision needed: the 12 skill descriptions** -- recommended: the golden table below. Each sentence restates the skill's own steps (decision #15). Each is tool-free and is 411 to 601 characters of ASCII.
- **Orchestrator decision needed: the generated header** -- recommended: one comment line, `# DO NOT EDIT: generated from the MCP prompt of the same name.` It keeps Rule #18's marker in each file. The contributor pointer (`scripts/gen-skills.mjs`, `packages/<server>/src/prompts/`) moves to `skills/README.md`, which is not agent content (`validate-prompts.test.ts:151`).
- **Orchestrator decision needed: the no-internal-references classes** -- recommended: the nine classes below. That is the AC's three (internal rule number, DW/AD id, repository path) widened to:
  - the other planning ids;
  - story numbers;
  - repository files;
  - absolute paths;
  - repository tooling;
  - snapshot folders.

  Each passes the shipped tree (scan of all 51 sources, the old header removed), and each is an internal reference by the epic's user-facing-wording list. Two classes are deliberately left out:
  - `npm`/`npx`, because an install command can be legitimate agent content;
  - `ExecuteMCPv2`, because that IRIS package is deployed into the user's instance.

  The repository-path class matches only at the start of a path, so the user example `c:/path/to/src/**` in `deploy-and-test-class` passes; the knowledge test's form flagged it. The file-name class is what makes DW-623 load-bearing: the header names `IRIS-MCP-THIRD-PARTY-NOTICES.md`, and no other line of the shipped tree trips it.
- **Orchestrator decision needed: the catalog (AC 41.5.2)** -- recommended: the template below.
  - **Order.** The sections follow the AC's order (knowledge skills, workflow skills, rules), each sorted by name.
  - **What each entry says.** For a skill, its frontmatter description and its declared preset. For a rule, its first heading and how it loads.
  - **How it renders.** Tolerantly: a fallback text, never a refusal, because `story-41-3-qa-frontmatter-process.test.ts:210` requires `gen:pack` to exit 0 on broken frontmatter so that `check:provenance` can report it. It needs no build, because it reads the generated files, not the dists.
- **Orchestrator decision needed: `skills/README.md` in this story** -- recommended: keep generating it (so `gen:skills` stays at 13 files). It gains the skill descriptions, a `Tool preset` column and pointers to the prompt sources and the catalog. Story 41.7 (AC 41.7.1) supersedes it.

**AC interpretations** (apply and report):

- **"Every skill in the pack declares the preset it needs" (AC 41.5.4).** Every skill that names a tool declares exactly one preset; a tool-free skill and the rule declare none, as the spine already says. Every one of the 24 workflow and pack copies of a workflow skill declares one.
- **"Internal references".** Read as the nine classes. The check covers each prompt's title, description, body, argument names and descriptions (added by the code review) and skill description.
- **"The MCP prompt text keeps its user-facing role" (AC 41.5.1).** The wire bytes are unchanged, as pinned. A skill description is not a prompt-body change (AD-15): no prompt name, title, description, argument or rendered text changes, so no sanctioned-change entry is needed.

**Golden descriptions and presets.** In `prompt.skill`, and in each skill's frontmatter. These are the planned `SKILL.md` sha256 values, rendered from these values and today's `build({})`; the line counts are unchanged.

| Skill | Preset | Bytes | sha256 |
| --- | --- | --- | --- |
| audit-security-posture | full | 2748 | `8068f9063ec48465abe299f73391b61714f565f5d6cce6fe567ecc1ad84ae43d` |
| check-system-health | full | 2680 | `2cbc983d96fc39f826ab04ae7859de6f34c64d89a03c40c5d533561f7bd21cda` |
| deploy-and-test-class | developer | 6753 | `ba24af252067fe92ce4046b5956b4e2918812b1ad0775371d9b25a238ab5448c` |
| diagnose-slow-query | developer | 2209 | `3a76caf480096ca68bdfdc47150d4c4e19db383b2c2a18e7321aa9ca8706d8f3` |
| edit-and-test-class | core | 4333 | `a26759dc2c6a14e57d28462a46a1bbd890fc3af7975d0c6d75af3bc714161b3f` |
| find-patient-messages | core | 3423 | `9d0ccda8d608ca87c04de6e89384bc174afbef5c1ae742f0a2adf92cd1300193` |
| promote-environment-change | developer | 4874 | `e6458184bf4be63be6bea23d9cf1c1b141c50d820d04d0c9268d459bb5b6ed69` |
| provision-project-environment | core | 2343 | `dd8f6c73a0f16670fd93337c1fb6e2154f26fb9c246b313876b7adccd469498e` |
| recover-stuck-production | core | 2919 | `efb9c171934a20c6b6d1c611af976b4039f92d47962689e349e0bc70a433c6e1` |
| resend-failed-messages | core | 3087 | `b9e38324de5fdf454f74f45b951000bc124ee5e56465fffef41dd8cb7a5b8ccf` |
| run-external-backup | full | 2102 | `40d01bd37a98297430ca307c2a1424a940f0b2521859e7c8e10d14ba3ee59764` |
| trace-message-flow | core | 4798 | `f3a2d19c2e362852419efc7ea22afd213586b41d1eae7f936b91c753ac16d6f0` |

The descriptions, verbatim (each value is one line):

~~~text
audit-security-posture: A read-only audit of an IRIS instance's security: users whose password settings look stale or that may use a well-known default credential, every user and role that holds %All, services that are enabled without authentication or not needed, SSL/TLS configurations with a minimum TLS version below 1.2 or missing certificate paths, and whether auditing is on, ending in a report of recommended fixes; it changes nothing. Use when the user asks to audit, review or harden IRIS security, asks who holds %All, or asks whether services, SSL/TLS or auditing are set up safely.
check-system-health: Runs one composite health check of an IRIS instance across its nine areas (journal, databases, license, locks, alerts, mirror, ECP, interoperability and the system) and follows each warning, critical or error finding to the tool that explains or fixes it, never running a destructive fix without the user's confirmation. Use when the user asks whether IRIS is healthy or wants a health or status check, or reports trouble with journal space, database size, the license, locks or alerts.
deploy-and-test-class: Deploys an ObjectScript class or package from local source files to IRIS with a glob-path load and compile, fixes compile errors in the source and loads it again, runs its unit tests, compares the returned total with the number of test methods because an early partial result looks like a green run, re-attaches to a run that is still going instead of starting a second one, and measures line coverage when the user asks for it. Use when the user wants to deploy, load or import ObjectScript source into IRIS, compile it, run its %UnitTest tests, or see their coverage.
diagnose-slow-query: Diagnoses a slow IRIS SQL query from its query plan, the maps and indexes the plan reads, and the statement's cumulative run-time statistics, looking for full table scans, missing indexes, hot statements and plan inefficiencies, then recommends a fix such as a new index or a rewritten WHERE clause without applying it. Use when the user says a SQL query is slow, asks why a query does not use an index, or wants a query plan explained.
edit-and-test-class: Changes a few lines of an ObjectScript class directly in IRIS: reads the lines around the change, applies a guarded line edit that stores nothing when the class no longer matches what was read, compiles the class and fixes errors the same way, runs its unit tests and checks the returned total, and reports the diff. Use when the user wants a small fix or change to a class that lives in IRIS, especially one with no local source file, or asks to patch, compile and test a class in place.
find-patient-messages: Finds a patient's interoperability messages by an identifier such as a medical record number, through a Search Table and in search windows of at most 7 days, lists the matching message headers, and reads message bodies only when the user wants the content, under the PHI data policy, which by default redacts or withholds them. Use when the user asks for the messages, HL7 traffic or message history of a patient or medical record number in an IRIS interoperability production.
promote-environment-change: Promotes configuration and code drift from one IRIS environment to another in review-before-write order, diff -> plan -> confirmed execute -> second diff: it compares mappings, System Default Settings, web applications, supported CPF settings and, given a spec, ObjectScript source, executes only the plan steps the user picks and confirms, and checks that the promoted drift is gone. It never removes an item that exists only on the target. Use when the user wants to compare two IRIS servers or environments, or to promote, sync or copy changes from one to another, such as from development to test.
provision-project-environment: Provisions a new IRIS project environment in order: a DATA and a CODE database, a namespace over them, a user whose default namespace it is, and a web application, checking each step before the next, rolling back the completed steps when one fails, and naming the manual follow-up a new web application needs. Use when the user wants to set up or create a new IRIS project, namespace or application environment.
recover-stuck-production: Diagnoses and recovers a troubled or wedged interoperability production along an escalation ladder, in order: status, queues and error logs first, then the recover action, and the clean action only when recover does not fix it, never wiping persistent business state unless the user explicitly accepts the data loss. Use when an IRIS interoperability production is stuck, troubled or suspended, messages are not processing or queues are backing up, or the user asks to restart or recover a production.
resend-failed-messages: Resends failed interoperability messages for one configuration item, dry run first: it previews the match count and a sample, resends only after the user approves with an explicit confirmation, and then checks the new message headers. It states that a resend delivers the data downstream again and that the resend actions are writes disabled by default. Use when the user wants to retry, replay or resend failed or errored messages in an IRIS interoperability production.
run-external-backup: Freezes an IRIS instance for an external backup snapshot taken at the OS or SAN level, waits while the user takes the snapshot, and always thaws the instance afterwards, even when the snapshot fails, then confirms that journaling resumed and checks the run in the backup history. Use when the user wants to back up IRIS with an external OS-level or SAN snapshot, or asks to freeze and thaw IRIS database writes for a backup.
trace-message-flow: Traces one interoperability message flow from a session or message header ID: lists every hop, searches the session's message headers, reads the bodies that matter under the PHI data policy, draws a sequence diagram, and pulls the error log entries of each failing item, then reports where the flow failed and recommends next steps, never running a recovery without the user's confirmation. Use when the user asks what happened to a message or session, why a message failed or never arrived, or how a message moved through an IRIS interoperability production.
~~~

**Claim check (decision #15).** Each clause was matched to the body of the generated skill, as read at `26dc8b2`. For example:

- **audit:** steps 1 to 7, and "This is a READ-ONLY audit";
- **health:** "all 9 areas", step 3, and step 4's "Never execute a destructive fix";
- **deploy:** steps 1, 2, 5, 6 and 8;
- **promote:** the domains in step 1, steps 3 to 5, and the SAFETY paragraph;
- **resend:** the GOVERNANCE and DUPLICATION HAZARD paragraphs, and steps 1, 4 and 5.

None adds an IRIS fact, so no IRIS probe applies.

**The frontmatter grammar extension** (`readSkillFrontmatter`):

- **Opening the map.** A column-1 line `metadata:` with nothing after the colon but spaces or tabs opens the map. `metadata: <value>` is refused: `the field "metadata" must be a map of two-space indented "key: value" lines, not a value (frontmatter line N)`. A map with no entry is refused: `the field "metadata" holds no entry; add iris-tools-preset or remove it`.
- **Entries.** A line of exactly two spaces, then `key: value`, is an entry of the open map. Blank and `#` comment lines are skipped, as everywhere else. The map ends at the next column-1 key line or at the closing `---`.
- **Indentation.** Any other indented line (tab, four spaces), or an indented line with no open map, keeps today's message `is not "key: value" at column 1`.
- **Keys.** Only `iris-tools-preset` is allowed: `metadata line N has the key "<k>"; only iris-tools-preset is allowed`. A repeated key is refused: `repeats the metadata key "<k>"; keep one`.
- **Values.** A value is read by `parseFrontmatterValue` (it may be quoted). An empty value is refused. A value outside `SKILL_PRESETS` is refused: `the tool preset "<v>" is not one of core, developer and full (frontmatter line N)`.
- **Messages that stay.** Today's rows for an indented field, a folded value and a list value (`tags:` / `  - a`) keep their messages exactly.

**The preset check** (`presetProblems`):

- **Which tokens count.** `extractIrisTokens(text)`, in first-seen order, keeping only real tools (a known owner, or `iris_server_profiles`).
- **Visibility.** `iris_server_profiles` is always visible. Under `full`, everything is visible. Under `core` or `developer`, a tool is visible when an owning package's `rosters[pkg][preset].include` lists it.
- **`first`.** The first of `SKILL_PRESETS` that shows every counted token.
- **Messages,** for each source:
  - no tokens and no declaration: tool-free, no problem;
  - tokens and no declaration: `names <t1>, <t2> but declares no tool preset; declare metadata iris-tools-preset: <first>` for a `SKILL.md`, otherwise `...; only a SKILL.md can declare one, so name no tool here`;
  - a value outside `SKILL_PRESETS`: `declares the tool preset "<v>", which is not one of core, developer and full`;
  - a declaration that hides some tokens: `declares the <p> tool preset, which hides <t> (<pkg>)[, ...]; declare <first>`;
  - a declaration wider than `first`: `declares the <p> tool preset, but every tool it names is visible under <first>; declare <first>`;
  - a declaration but no tokens: `declares the <p> tool preset but names no tool; remove the declaration`.

**The nine internal-reference classes** (name, pattern, sample):

1. `an internal rule number`, `/\bRules? ?#\d+/i`, `see Rule #7`.
2. `a number sign and digits that are not an IRIS error code`, `/(?<![\w&])(?<![Ee][Rr][Rr][Oo][Rr] )#\d+(?!\d|:)/`, `item #58`.
3. `a planning or deferred-work id`, `/\b(?:DW|AD|AC|NFR|FR)[- ]?\d+/`, `tracked as DW-615`.
4. `a story or epic number`, `/\b(?:Stor(?:y|ies)|Epics?|Sprints?)[\s-]*\d/i`, `added in Story 41.2`.
5. `a repository path`: the top-level repository entries, escaped, joined, then `/`, behind `(?<![A-Za-z0-9_./-])` and an optional `./` or `../`. Sample `see packages/shared`.
6. `an absolute path`, `/(?<![A-Za-z0-9_.-])\/(?:Users|home|private|tmp|usr|opt|var)\//`, `open /Users/someone/file`.
7. `a repository file`, `/\b[\w-]+\.(?:md|ts|mjs|json|ya?ml|toml)\b/i`, `edit rules.md`.
8. `repository tooling`, `/\b(?:pnpm|turbo|vitest|tsc)\b|\b(?:gen|validate|check):[a-z]/`, `run pnpm test`.
9. `a snapshot folder`, `/\birislib\b|\birissys\b/`, `read irislib`.

(The code review widened classes 1, 3, 4, 5, 7 and 8 and narrowed class 2 to "a bare `#n`"; see the Spec Change Log.)

A problem is `{ label, className, match }`, where `match` is the first match. The CLI prints `  - [internal-reference] <label>: <className> (<match>)`.

**CLI output.**

- **Problem sections.** Each new section has a header, then its lines:
  - `validate-prompts: found prompts without a valid skill field:`, with `  - [skill-field] <label>: <message>`;
  - `validate-prompts: found tool-preset problems:`, with `  - [preset] <label>: <message>`;
  - `validate-prompts: found internal references in agent content:`, with the line above.

  No new line ends with `"`.
- **Golden line 2,** on the real tree:

~~~text
validate-prompts: OK — tool presets: 24 file(s) declare one (12 core, 6 developer, 6 full) and 15 tool-free file(s) declare none; no internal reference in 51 source(s), 2 adaptation header line(s) exempted.
~~~

  Write the dash as `\u2014`, like line 1. The 24 are 12 workflow plus 12 pack copies. The 15 are 6 knowledge, 6 pack knowledge, 2 pack rule forms and 1 rule. 24 + 15 = 39 content files. The two exempted lines are the SQL skill's `knowledge:` and `pack:` copies.

**The catalog template.** The renderer output for the real tree is 11,648 bytes, 48 lines, sha256 `bdd1b54f06327f00af5a46b07457e3f4a6380a97479e3225afabf3b8ed5becd3`, ASCII (after the code review's description corrections; it was 11,611 bytes, `4806e801...`). Slots are in `<>`. Each list is sorted by name, and an empty list renders `None.`. Without a readable description, an entry renders `(no description could be read from its frontmatter)`. ` (tool preset `<p>`)` appears only when a valid preset is declared. A rule's title is its first line matching `^#{1,6}[ \t]+(.+?)[ \t]*$` (a trailing CR removed), or else its stem.

~~~text
<!-- DO NOT EDIT. This directory is generated by `pnpm gen:pack` from the pack sources. Edit the sources, then regenerate. -->

# IRIS MCP skills pack

Agent skills and the always-on rule for working with the IRIS MCP Server Suite. A skill that names the suite's tools shows its tool preset: the first of `core`, `developer` and `full` (the values of `IRIS_TOOLS_PRESET`) under which every tool it names is visible. `full`, the default, shows every tool.

## Knowledge skills

An agent loads a knowledge skill when its task matches the skill's description.

- `<name>`[ (tool preset `<p>`)]: <description>

## Workflow skills

Each is generated from the MCP prompt of the same name and walks an agent through one task with the suite's tools.

- `<name>`[ (tool preset `<p>`)]: <description>

## Always-on rules

- `<stem>`: <title>. Its Claude Code form, `rules/claude-code/<file>`, has no `paths:` scope, so it loads in every session of a project that installs it. `rules/agents-md/<file>` holds the same text for `AGENTS.md`, between two marker lines.

<the Layout and Third-party content sections of today's renderPackReadme, byte for byte>
~~~

**The golden `skills/README.md` intro** (replaces the paragraph after the title):

~~~text
This directory is **generated** from the suite's MCP `prompts` capability (Epic 25). Each skill's body is the text `prompts/get` renders for the prompt of the same name. Its `description` is the prompt's separate model-invocation description, and `metadata.iris-tools-preset` is its tool preset; both are set in the prompt's `skill` field in `packages/<server>/src/prompts/`. The skills pack catalog, `packages/client-config/skills-pack/README.md`, lists these skills with the knowledge skills and the always-on rule.
~~~

**The golden `README.md:830` sentence:**

~~~text
- **As installable Agent Skills**: the same workflows are generated into a repo-root [`skills/`](skills/README.md) directory, one `SKILL.md` per prompt. Its body is the prompt's text; its frontmatter holds `name`, a `description` written for the model to choose the skill (the prompt keeps its own description), and `metadata.iris-tools-preset`, the tool preset under which every tool it names is visible. Copy the skills you want into your project's `.claude/skills/` directory (see [`skills/README.md`](skills/README.md) for details); the skills pack catalog, [`packages/client-config/skills-pack/README.md`](packages/client-config/skills-pack/README.md), lists them with the knowledge skills and the always-on rule. Every tool name referenced in a prompt or skill is validated against the live tool catalog in CI, so a renamed or removed tool breaks the build rather than shipping a broken workflow.
~~~

**`skills-pack-src/README.md` changes:**

- `:15`: `gen:skills` takes each skill's `description` and tool preset from the prompt's `skill` field.
- `:34`: the block also allows an optional `metadata` map, a `metadata:` line plus two-space `key: value` lines, whose only key is `iris-tools-preset` (`core`, `developer` or `full`).
- `:40`: replace the "A new frontmatter field ..." sentences with: "A skill that names an `iris_*` tool declares, as `metadata` `iris-tools-preset`, the first of `core`, `developer` and `full` under which every tool it names is visible; `pnpm validate:prompts` checks it."
- `:65`: add that `pnpm validate:prompts` exempts the same one line from its internal-reference check, for a skill the notice's provenance table names.
- A new `## The pack catalog` section (one paragraph: what `gen:pack` lists, and its order).
- `:78`: `validate:prompts` also checks tool presets and the nine internal-reference classes.

**Golden wire values** (Rule #36). The capture: a scratch Node script with SDK `@modelcontextprotocol/sdk@1.29.0`, `StdioClientTransport` against each `packages/<pkg>/dist/index.js`, `IRIS_HOST=127.0.0.1`, `IRIS_PORT=9`, at `26dc8b2`. Each value is `sha256(JSON.stringify(x))`. The list values hash `(await client.listPrompts()).prompts`; each `prompts/get` value hashes the full result for `arguments` = every declared argument set to `v-<name>`.

- **admin:** list `bd531fad56f723fc0bdb547d4a38bec717139f2724a3ddd3df1616488a3aa827`; get:
  - `provision-project-environment` `72cd7ebd5c7a5283183dbf40c3bf7bdaa02465cab38b81177cfc50e60d7ce215`;
  - `audit-security-posture` `fed7d6bdbbcc5520297910ca88502803ea08a246d92364abc9c8e86cbe3eb116`.
- **dev:** list `a1317b095ad7720e2caae07d57e3658a308a1bf42d2c3c6272d897520eade217`; get:
  - `diagnose-slow-query` `b038a8c18dbc1b010f4f1f2662a26b17c995e735ed3f0230ed271433ebe42abb`;
  - `deploy-and-test-class` `a33adecb68164ce91338713b4ffac873e926d6635acbe495591c722e8edeb15d`;
  - `promote-environment-change` `31c9e03e31d888530ce9c021b104e0fa2b5c8144f24bc27280bc86a5f6e3704f`;
  - `edit-and-test-class` `f97413b0c895e5663568ef0c06037db2765898b1e28e5d4ee29b62059554173e`.
- **interop:** list `71984e9be366489028552861bb096415ad6d2673f683029e35d7d94bf9785164`; get:
  - `trace-message-flow` `d774181ef6d285aeaf14fd41abdf83422a67d01e82705d125e19b92e3e1d0482`;
  - `recover-stuck-production` `186084eb03b610917a641d521db127596107ee7d5b97c402fea9c11a11eb4b4f`;
  - `resend-failed-messages` `af4ac020ae0c2e8baace9ff5686431f60f3cb812fc479543569c36261da5211a`;
  - `find-patient-messages` `9f1b22aa8fc71c837b2a792f759b854ac7bc5e42bb2f1e822ddbc873401f080d`.
- **ops:** list `a8a37a4ec55f819cfdfd6d9106a7ddbca413b47e3da758816119cb5398ff55bb`; get:
  - `check-system-health` `3cdb4da3fbaffc886a64469b0e6525249ab83f52d3e9579e5b3bb2c8142d48d7`;
  - `run-external-backup` `70c81a1f821451a05e2e414f2d9503976e2ad9663e74a3f94a40d39a7fe29e0a`.

Write the new describe first and see it green on the unchanged dists, then change the source.

**Spine text for the lead** (Rule 20, light path; AD-28):

- **"Skill frontmatter".** Replace "holding only `name` and `description`" with: "holding `name` and `description` and, optionally, a `metadata` map whose one allowed key is `iris-tools-preset` (Story 41.5)".
- **"Tool names and presets".** Append: "A skill that names an `iris_*` tool declares, as `metadata` `iris-tools-preset`, the first of `core`, `developer` and `full` under which every tool it names is visible on the server that owns it; a skill or rule that names no tool declares none. The source of a workflow skill's preset and description is the prompt's `skill` field, which `registerPrompt` never sends (pinned over stdio)."
- **"No internal references".** Append: "`validate:prompts` checks every prompt, its skill description included, and every agent content file against nine classes. The one exemption is the exact adaptation header as the first body line of a file the provenance table names."
- **"One pack".** "Renders only the pack README" becomes "renders the pack README as a catalog of the knowledge skills, the workflow skills and the rules".
- **memlog line:** "AD-28 (41.5): skill-only PromptDefinition.skill (description, preset) and SKILL.md metadata iris-tools-preset (first of core/developer/full that shows every named tool; none for tool-free files); validate:prompts checks presets and nine internal-reference classes, exempting only the provenance-row adaptation header. Prevents a skill that names hidden tools and internal references in agent content."

**Governing ADs:**

- **AD-28:** prompts are authored once; the skill-only description field and its pin; preset declarations and their check; no internal references, checked mechanically; skill frontmatter; one pack.
- **AD-15:** an additive optional field; the wire byte-identical, pinned.
- **AD-14:** the generators only.
- **AD-7:** visibility is advertise-time; no roster changes; `iris_server_profiles` is always visible.
- **AD-2:** checks in `scripts/lib`, shared by CLI and test; `client-config` and `gen:pack` read no server dist.
- **AD-29:** minor and patch changesets.
- **Project rules:** #18, #36, #44, #51, #54, #55, #56, #59, and Rule 14.

No AC contradicts an AD. AD-28's "holding only `name` and `description`" itself says that a preset field extends that rule, so the spine text above is an amendment, not a conflict.

**Extend, don't copy (Rule 2):**

- `renderSkillMd` moves into `workflow-skills.mjs` instead of being duplicated, so tests can drive it.
- `checkedText` becomes the shared `withoutAdaptationHeader`.
- `skillFrontmatterProblems` becomes a view of the new reader.
- The new checks extend `validate-prompts-core.mjs`, and the catalog loader extends `tool-catalog.mjs`.
- **Kept separate, on purpose:** `agent-text-hygiene.ts` `FORBIDDEN` stays the stricter list for tool-free hand-authored text. Its class names and samples are pinned by the 41.2 to 41.4 tests, and it bans tool names and "probe", which workflow content legitimately holds.
- The new `validate-prompts-pack-checks.test.ts` reuses `story-41-1-qa-fixture.ts`.

**Integration (Rules 1/2):**

- **Integration ACs:**
  - an MCP client over stdio sees unchanged prompts;
  - the `validate:prompts` CLI reads each declaration and exits 1 on a bad one;
  - `check:provenance` reads the extended grammar;
  - `gen:pack` reads skill frontmatter into the catalog.
- **Consumed-by:**
  - **41.6:** installs `skills/<name>/` with the `metadata` block intact (a hashed, owned file).
  - **41.7:** the docs point at the catalog, which supersedes `skills/README.md`. The capstone's "valid frontmatter" includes `metadata`.
  - **42.8:** the catalog is the plugin root's README.
- **Consumes:**
  - 41.1's `listAgentContentFiles`, `gen:pack` and the validator;
  - 41.3's frontmatter rule;
  - 41.4's header exemption and provenance row;
  - Epic 30's preset rosters.

**Ledger inbox (Rule 17).** DW-623 is addressed by the DW-623 rows of the I/O matrix, the `validate-prompts.test.ts` controls and the scratch rows of `validate-prompts-pack-checks.test.ts`.

## Verification

- **How commands run.** Every command runs from `/Users/jbrandt/git/iris-execute-mcp-v2` in the foreground with `timeout: 600000`, one package or one test-file group per call. No turbo run.
- **Builds.** Rebuild after editing a package's `src/` (`checkDistFresh` is mtime-based): `pnpm --filter @iris-mcp/shared build`, then `pnpm --filter @iris-mcp/dev build`, `pnpm --filter @iris-mcp/admin build`, `pnpm --filter @iris-mcp/interop build` and `pnpm --filter @iris-mcp/ops build`, one call each. Then run `pnpm gen:skills` and `pnpm gen:pack`.
- **IRIS.** No IRIS call, no stateful OS test class and no `ExecuteMCPv2.Temp.*` fixture. The live gates A5 and P6 are not armed, so they skip.

**Shared surfaces:** these change, and other tests assert on them.

- The 12 `skills/<name>/SKILL.md` files and their pack copies (frontmatter).
- `skills/README.md`.
- The pack `README.md`.
- `validate:prompts` output (line 2, and the new problem sections).
- The frontmatter grammar's unknown-field message.
- `PromptDefinition` (a shared export).
- The 41.2 stdio test.
- `skills-pack-src/README.md`, `README.md:830` and the CHANGELOG's newest section.

**Standing criterion:** every test added or changed passes on a fresh environment, in either order.

**Commands:**

- `(loop)` `shasum -a 256 skills/*/SKILL.md packages/client-config/skills-pack/README.md` -- expected: the 12 golden values and the catalog's `bdd1b54f...` (it was `4806e801...` before the code review).
- `(loop)` `pnpm gen:skills` twice, then `pnpm gen:skills:check` -- expected: no change on the second run, and `13 generated file(s)`.
- `(loop)` `pnpm gen:pack` twice, then `pnpm gen:pack:check` -- expected: `22 pack file(s)`.
- `(loop)` `pnpm validate:prompts`, then `pnpm check:provenance` -- expected: the unchanged line 1 and the golden line 2; `1 provenance row(s), 39 agent file(s), 8 distribution(s)`.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run` over `src/__tests__/validate-prompts.test.ts src/__tests__/validate-prompts-pack-checks.test.ts src/__tests__/skills-generated-frontmatter.test.ts src/__tests__/skills-pack.test.ts src/__tests__/skills-pack-frontmatter.test.ts src/__tests__/skills-pack-knowledge.test.ts src/__tests__/skills-pack-rule.test.ts src/__tests__/pack-provenance.test.ts src/__tests__/gen-skills-stray-file.test.ts` -- expected: pass.
- `(loop)` the same runner, in one call, over `src/__tests__/story-41-2-qa-prompts-stdio-wire.test.ts src/__tests__/story-39-6-qa-forensics-prompts-sdk-wire.test.ts src/__tests__/prompt-safety-invariants.test.ts src/__tests__/story-40-4-qa-live-gate.test.ts src/__tests__/story-40-5-qa-live-gate.test.ts` -- expected: pass, with the live gates skipping.
- `(loop)` the five `story-41-1-qa-*.test.ts` files in one call; the two `story-41-3-qa-*.test.ts` files in another; `story-41-4-qa-first-row-process.test.ts` and the `story-41-2-qa-*.test.ts` files in a third -- expected: pass.
- `(loop)` `pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/prompts.test.ts` -- expected: pass.
- `(once)` One call each:
  - `pnpm --filter @iris-mcp/shared test`, and the same for dev, admin, interop, ops and client-config;
  - `pnpm --filter <pkg> type-check` and `pnpm --filter <pkg> lint` for the same six;
  - the full `@iris-mcp/all` suite in three calls (`ls src/__tests__/*.test.ts | awk 'NR%3==k'`, k = 1, 2, 0).

  Expected: green.
- `(once)` `pnpm gen:governance-baseline:check`, `pnpm gen:tools-list-snapshot:check`, `node scripts/check-epics-sync.mjs` and `git diff --stat packages/shared/src/bootstrap-classes.ts` -- expected: OK, and an empty diff.

**Planned mutations (Rule 19).** Apply each mutation, observe red, then revert, rebuilding and regenerating where the mutation needs it. Confirm that `git status --short` and `git diff --stat` are unchanged, and record each as `mutation: <change> → <test>`.

- **M1** (AC 41.5.1): one word of `editAndTestClass.ts`'s `skill.description` changed, dev rebuilt, then `gen:skills` → the oracle row in `skills-generated-frontmatter.test.ts` is red (and `gen:skills:check` reports DRIFT when the files are not regenerated).
- **M2** (the off-wire pin): `description: def.skill?.description ?? def.description` in both branches of `registerPrompt`, shared rebuilt → the new stdio describe (the wire description and the golden list hashes) is red.
- **M3** (preset, on the guarded path from source to file): `deployAndTestClass.ts` `skill.preset` set to `"core"`, dev rebuilt, then `gen:skills` and `gen:pack` → `pnpm validate:prompts` exits 1 with `[preset]` for the `workflow:` and `pack:` labels of `deploy-and-test-class`, and the real-tree test in `validate-prompts.test.ts` is red.
- **M4** (minimality): the wider-than-`first` branch of `presetProblems` disabled → the unit control and the scratch "widened to full" row are red.
- **M5** (undeclared): the no-declaration branch disabled → the inverted 41.3 row (a real tool in a knowledge skill) and the scratch rule row are red.
- **M6** (per-server): every token looked up in the first owner package of the skill's first token → the two-servers unit control is red.
- **M7** (the header is included): `workflow-skills.mjs` emits the old three-line header, then `gen:skills` and `gen:pack` → `pnpm validate:prompts` exits 1 with `[internal-reference]` for all 24 workflow and pack skill files. The scratch "old header" row covers the same path in the default suite.
- **M8** (prompts are covered): the core skips `prompt:` sources → the prompt-source control is red. Then add `see Rule #7` to a prompt's `skill.description` and rebuild → the CLI names `prompt:<pkg>/<name>`.
- **M9** (the classes): the repository-path pattern replaced with `/$^/` → the class-sample test and the inverted 41.3 "repository path" row are red.
- **M10** (DW-623):
  - (a) the exemption applied without the row set → the "not row-marked" control and its scratch row are red;
  - (b) every copy of the header removed → the "second copy" control and its scratch row are red;
  - (c) no exemption → the real-tree validator is red (2 files), and so is the "accepted" control.
- **M11** (grammar): the metadata map no longer accepted → the "valid block" row, the committed-pack sweep (`skills-pack-frontmatter.test.ts:431`) and `pnpm check:provenance` are red.
- **M12** (catalog): the knowledge and workflow sections swapped in `renderPackReadme` → the real-tree catalog test is red, and `gen:pack:check` reports DRIFT for `README.md`.
- **M13** (the `skill` field is required): `skill` removed from one prompt, its package rebuilt → `pnpm gen:skills` exits 1 and writes nothing, and `pnpm validate:prompts` names `[skill-field]`.
- **Unchanged counts:** pinned by the existing `(once)` gates.

**Golden values (implement stage, 2026-10-19).** Every golden value reproduced on its first run, so no golden value was edited and no mis-capture was found.

- The 16 wire hashes (4 `prompts/list`, 12 `prompts/get`) reproduced on the unchanged dists before any source change: the new stdio describe was written first and was green (27 tests).
- All 12 generated `SKILL.md` sha256 values, and their byte sizes (2748, 2680, 6753, 2209, 4338, 3412, 4874, 2343, 2919, 3087, 2102, 4767), matched the golden table.
- The pack `README.md` is 11611 bytes, 48 lines, sha256 `4806e801f7a9dff2eae1d4099a6dc481d5d2ea410407584fca76e22e85c99b82`, ASCII.
- `pnpm validate:prompts` line 2 equals the golden second line, and `gen:skills` and `gen:pack` ran twice with no change after the first run.

**Mutation evidence (implement stage, 2026-10-19).** Each mutation was applied, run, observed red and reverted. After each revert, one snapshot hash (`git status --short`, `git diff` and the sha256 of every untracked file) equalled the one taken before the first mutation (`8a7ca7f6bc873981bfab2b2aa5319cc2288c9c9f4ba96f4ae5a8e9c1e8bae602`), so the tree was byte-identical. Rebuilds and regenerations followed each revert where the mutation needed them.

- mutation: M1 `editAndTestClass.ts` `skill.description` "around the change" changed to "near the change", dev rebuilt → `pnpm gen:skills:check` exit 1 with DRIFT in `skills/edit-and-test-class/SKILL.md` and `skills/README.md`; after `gen:skills`, `skills-generated-frontmatter.test.ts` 3 red (the edit-and-test-class golden-file row, whose sha256 became `1ae101f3...` instead of `636f70ba...`; the description-equals-oracle row; the `skills/README.md` row). Reverted, dev rebuilt, `gen:skills` rerun.
- mutation: M2 `registerPrompt` passes `def.skill?.description ?? def.description` in both branches, shared rebuilt → `story-41-2-qa-prompts-stdio-wire.test.ts` 8 red (4 `prompts/list` golden hashes and 4 "serves only its four keys and its own description" rows, one per server); `prompts.test.ts` in shared 1 red (the in-memory "skill-only field is never listed" row). The `prompts/get` hashes stayed green, because the SDK's `prompts/get` result carries no description. Reverted, shared rebuilt; `git diff --stat packages/shared/src/server-base.ts` empty.
- mutation: M3 `deployAndTestClass.ts` `skill.preset` "developer" changed to "core", dev rebuilt, `gen:skills` and `gen:pack` rerun → `pnpm validate:prompts` exit 1 with `[preset] workflow:deploy-and-test-class/SKILL.md` and `[preset] pack:skills/deploy-and-test-class/SKILL.md`, each "declares the core tool preset, which hides iris_test_status (iris-dev-mcp), iris_test_coverage (iris-dev-mcp); declare developer"; `validate-prompts.test.ts` 4 red of 60 (the real-tree preset row, the CLI golden-line row, and two real-tree CLI rows). Reverted, dev rebuilt, both generators rerun.
- mutation: M4 the wider-than-`first` branch of `presetProblems` changed to `else if (false)` → `validate-prompts.test.ts` 2 red (full and developer "wider than needed" unit rows) and `validate-prompts-pack-checks.test.ts` 1 red (the "widened to full" scratch row). Reverted.
- mutation: M5 the no-declaration branch of `presetProblems` changed to count every undeclared file as tool-free → 6 red: `validate-prompts.test.ts` 2 (undeclared SKILL.md, undeclared non-SKILL.md), `story-41-3-qa-knowledge-gate-process.test.ts` 1 (the inverted "real tool in a knowledge skill" row), `validate-prompts-pack-checks.test.ts` 3 (declaration removed, tool in the rule, tool in a knowledge skill). Reverted.
- mutation: M6 every token of a source looked up in the first owner package of its first token → `validate-prompts.test.ts` 3 red (the two-servers row, the "tool owned by two servers" row, and the "too narrow" row that names a tool of each server). The real tree and the scratch `check-system-health` row stayed green under M6, because that skill needs `full` either way; the unit rows are the guard. Reverted.
- mutation: M7 `workflow-skills.mjs` emits the old three-line header, `gen:skills` and `gen:pack` rerun → `pnpm validate:prompts` exit 1 with 72 `[internal-reference]` lines, 3 classes (path, file, tooling) for each of the 24 workflow and pack skill files. Reverted, both generators rerun. The scratch "old header" row covers the same path in the default suite.
- mutation: M8 (a) `internalReferenceProblems` skips `prompt:` sources → `validate-prompts.test.ts` 1 red (the "header in a prompt source is flagged" control); (b) with the core restored, `see Rule #7` appended to the `skill.description` of `run-external-backup`, ops rebuilt → `pnpm validate:prompts` exit 1 with `[internal-reference] prompt:iris-ops-mcp/run-external-backup` for "an internal rule number (Rule #7)" and "a number sign and digits ... (#7)". Both reverted, ops rebuilt.
- mutation: M9 the repository-path pattern replaced with `/$^/` → `validate-prompts.test.ts` 2 red (the class-sample row and the regex-character row) and `story-41-3-qa-knowledge-gate-process.test.ts` 1 red (the inverted "repository path" row); with the same mutation `validate-prompts-pack-checks.test.ts` 1 red (the old-header row, which expects `a repository path (scripts/)`). Reverted.
- mutation: M10 (a) the exemption applied to every source, without the row set → `validate-prompts.test.ts` 2 red ("no exemption" control, "not row-marked" control) and `validate-prompts-pack-checks.test.ts` 2 red (the gotchas-header row and the row-removed row); (b) `withoutAdaptationHeader` removes every copy of the header → `validate-prompts.test.ts` 1 red ("second copy"), `skills-pack-knowledge.test.ts` 1 red ("flags a second copy of the header") and `validate-prompts-pack-checks.test.ts` 1 red (the second-copy row); (c) no exemption (`read = text`) → the real-tree `pnpm validate:prompts` exit 1 with `[internal-reference]` for exactly `pack:skills/iris-mcp-objectscript-sql/SKILL.md` and `knowledge:iris-mcp-objectscript-sql/SKILL.md` ("a repository file (IRIS-MCP-THIRD-PARTY-NOTICES.md)"), and `validate-prompts.test.ts` + `validate-prompts-pack-checks.test.ts` red on 10 or more rows (the listing was cut at 10), among them the real-tree row and the "accepted" control. All reverted.
- mutation: M11 `allowedFields` without `metadata` (the map no longer accepted) → `skills-pack-frontmatter.test.ts` 35 red (every metadata good row, the bad rows that expect a metadata message, and the committed-pack "raises no problem for any of them" sweep) and `pnpm check:provenance` exit 1. Reverted.
- mutation: M12 the knowledge and workflow sections swapped in `renderPackReadme` → `pnpm gen:pack:check` exit 1 with DRIFT in `packages/client-config/skills-pack/README.md` and `skills-pack.test.ts` 5 red; after `gen:pack` under the mutation, the real-tree rows (golden sha256/size/lines; sections in order) are red too. Reverted, `gen:pack` rerun (README sha256 back to `4806e801...`).
- mutation: M13 the `skill` block removed from `runExternalBackup.ts`, ops rebuilt → `pnpm gen:skills` exit 1 printing "gen-skills: prompt iris-ops-mcp/run-external-backup has no skill field; ..." with `skills/run-external-backup/SKILL.md` byte-identical (sha256 `40d01bd3...` before and after, so nothing was written); `pnpm gen:skills:check` exit 1; `pnpm validate:prompts` exit 1 with `[skill-field] prompt:iris-ops-mcp/run-external-backup`. Reverted, ops rebuilt, both generators rerun.

**Mutation evidence (review pass, 2026-10-19).** The tests added or changed by the review patches. Each mutation was applied, run, observed red and reverted; after the reverts the snapshot hash of `git status --short` plus `git diff` equalled the one taken before the first of them (`8c648ca2b8ebf21d56037eb173f554f03404ee073ce1511c26ad8d9451d2b628`), so the tree was byte-identical. Rebuilds followed where the mutation needed them (shared, N5).

- mutation: N1 (the matrix row "Missing skill field", `gen:skills`) the guard `skillProblems.length > 0` of `gen-skills.mjs` changed to `> 99` → `validate-prompts-pack-checks.test.ts` 1 red ("gen:skills stops before writing, in write mode and in --check mode"). Reverted.
- mutation: N2 (`validate:prompts` `[skill-field]`) `skillFieldProblems.length` removed from `failed` in `validate-prompts.mjs` → `validate-prompts-pack-checks.test.ts` 1 red ("validate:prompts names each prompt without a valid skill field"). Reverted.
- mutation: N3 (the skill description is scanned) `\n${prompt.skill?.description ?? ''}` removed from a prompt's source text in `validate-prompts.mjs` → `validate-prompts-pack-checks.test.ts` 1 red ("an internal reference in a prompt's skill description is refused"). Reverted.
- mutation: N4 (the rules sort) the `catalog.rules.sort(...)` line of `assemblePack` deleted → `skills-pack.test.ts` 1 red ("rules are sorted by name, not by file name"). Reverted.
- mutation: N5 (the `prompts/get` leg of the off-wire pin) the `render` of `registerPrompt` returns `description: def.skill?.description` besides `messages`, shared rebuilt → `story-41-2-qa-prompts-stdio-wire.test.ts` 8 red (the 4 "prompts/get carries no skill field, no skill description and no preset key" rows and the 4 "every prompts/get hashes to its golden value" rows). Reverted, shared rebuilt; `git diff --stat packages/shared/src/server-base.ts` empty and the file passes 35 of 35 again.
- mutation: N6 (`SKILL_PRESETS` against shared's `TOOL_PRESET_NAMES`, Rule #44) `'lite'` appended to `SKILL_PRESETS` → `skills-pack-frontmatter.test.ts` 2 red (the `TOOL_PRESET_NAMES` row and "refuses a preset outside core, developer and full"). Reverted.
- mutation: N7 (the changed Story 39.6 row) the description of `skills/find-patient-messages/SKILL.md` changed from "Finds" to "Locates" → `story-39-6-qa-forensics-prompts-sdk-wire.test.ts` 1 red ("the generated skill carries the skill description its definition declares"). Reverted.
- mutation: N8 (the catalog beyond section order) (a) `CATALOG_NO_DESCRIPTION` shortened → `skills-pack.test.ts` 3 red (the order row, the fallback row and the gen-pack CLI row); (b) both preset-validity guards (`catalogSkillLine`, `catalogSkill`) removed → 1 red ("a preset renders only when it is declared and valid"); (c) the trailing-CR strip of `ruleTitle` removed → 1 red ("a rule's title is its first heading"); (d) `RULE_HEADING`'s `[ \t]+` after the hashes changed to `[ \t]*` → the same row red. Each reverted.
- mutation: N9 (the `22 pack file(s)` assertion) `gen-pack.mjs` prints `files.size + 1` → `skills-pack.test.ts` 1 red ("gen-pack --check passes on the committed tree"). Reverted.
- Either order (the standing criterion): the added and changed test files (`validate-prompts`, `validate-prompts-pack-checks`, `skills-generated-frontmatter`, `skills-pack`, `skills-pack-frontmatter`, `skills-pack-knowledge`, `story-41-2-qa-prompts-stdio-wire`, `story-39-6-qa-forensics-prompts-sdk-wire`, both `story-41-3-qa-*` process files and `story-41-1-qa-validate-prompts-pack`) ran with `--sequence.shuffle --sequence.seed=20261019`: 535 of 535 passed; `validate-prompts-pack-checks`, `skills-pack` and `validate-prompts` with seed 99: 110 of 110.

**Commands run (implement stage).**

- Rebuilds, one call each: shared, dev, admin, interop, ops (no `iris-mcp-all` build exists). Then `pnpm gen:skills` and `pnpm gen:pack`.
- `(loop)` groups green: the nine-file validator/pack group (562 tests), the five-file wire group (121; the live gates A5 and P6 skipped, not armed), the four `story-41-1-qa-*` files (118), the two `story-41-3-qa-*` files (63), `story-41-4-qa-first-row-process` with the `story-41-2-qa-*` files (129), and shared `prompts.test.ts` (18).
- `(once)`: `pnpm --filter <pkg> test` for shared (2072 tests), dev (1663), admin (498), interop (672), ops (350) and client-config (514); `type-check` and `lint` for the same six (lint prints 0 errors; the one shared warning is in untouched `cli/governance.ts`); the full `@iris-mcp/all` suite in three calls over 117 files (870 + 1138 + 807 passed, 1 + 2 + 1 skipped).
- `(once)` gates: `gen:governance-baseline:check` OK (141 frozen keys; 212 live; 71 post-foundation), `gen:tools-list-snapshot:check` OK (115 of 115, 0 new), `node scripts/check-epics-sync.mjs` OK, `git diff --stat packages/shared/src/bootstrap-classes.ts` empty, `BOOTSTRAP_VERSION` still `5296a1c836f4`, `gen:skills:check` 13 files, `gen:pack:check` 22 files, `check:provenance` "1 provenance row(s), 39 agent file(s), 8 distribution(s)".

**Commands run (review pass, after the last patch).** `(loop)` groups green again: the nine-file validator/pack group, the five-file wire group (live gates skipped), the four `story-41-1-qa-*` files, the two `story-41-3-qa-*` files, `story-41-4-qa-first-row-process` with the `story-41-2-qa-*` files, and shared `prompts.test.ts`. `gen:skills` and `gen:pack` (twice each) changed nothing; the 12 `SKILL.md` and the catalog still equal their golden sha256 values. `(once)`, run once after the last patch: `pnpm --filter <pkg> test` for shared (2072), dev (1663), admin (498), interop (672), ops (350) and client-config (514); `type-check` and `lint` for the same six (0 errors; the one shared lint warning is in untouched `cli/governance.ts`); the full `@iris-mcp/all` suite in three calls over 117 files (873 + 1138 + 808 passed, 1 + 2 + 1 skipped; the three review-pass rows account for +4 against the implement stage); `gen:governance-baseline:check` OK (141 frozen keys), `gen:tools-list-snapshot:check` OK (115 of 115), `node scripts/check-epics-sync.mjs` OK, `git diff --stat packages/shared/src/bootstrap-classes.ts` empty (`BOOTSTRAP_VERSION` stays `5296a1c836f4`), `gen:skills:check` 13 files, `gen:pack:check` 22 files, `check:provenance` "1 provenance row(s), 39 agent file(s), 8 distribution(s)".

**QA (2026-10-19): real-runtime gap tests.** Four new test files and one helper, all in `packages/iris-mcp-all/src/__tests__/`, in the default suite (`*.test.ts`, none excluded; none arms on `IRIS_REQUIRE_LIVE`, so none belongs in a prepublish roster). No IRIS, no network; each server is started with `default` on the closed port 127.0.0.1:9.

- `story-41-5-qa-fixture.ts` (QA): helper only; a fresh-Node-process import of a built prompts module, a frontmatter reader that does not use `skills-pack.mjs`, and a listing of the 39 content files.
- `story-41-5-qa-dist-consumer.test.ts` (QA, 28 tests): a fresh Node process finds `skill` on all 12 definitions; a real SDK `Client` over stdio; the raw JSON-RPC frames of each prompt server read without the SDK; `prompts/get` with `arguments` omitted for the 4 all-optional prompts; `arguments: {}` renders the bytes of the generated skills at 9ae509b (sha256 captured with `git show 9ae509b:skills/<name>/SKILL.md`).
- `story-41-5-qa-preset-oracle.test.ts` (QA, 47 tests): each of the 5 built servers is started under `IRIS_TOOLS_PRESET=core|developer|full` and its `tools/list` is the oracle for the first-of-core/developer/full rule over all 39 content files; independent of `validate-prompts-core.mjs` and the rosters. Also the spec's preset table, source/pack-copy parity and the dist definitions' presets.
- `story-41-5-qa-gen-skills-refusal.test.ts` (QA, 19 tests): `gen:skills` and `gen:skills --check` on scratch copies, 9 kinds of invalid `skill` field, a stale `skills/` tree for write mode and an up-to-date tree for `--check`, each with a repaired control.
- `story-41-5-qa-yaml-consumer.test.ts` (QA, 39 tests): every `SKILL.md` frontmatter parsed with the real `yaml` package of client-config in a fresh process, checked against the Agent Skills shape, with 4 negative controls.

- mutation: Q1 (a fresh process finds `skill`) the `skill` block removed from `runExternalBackup.ts`, ops rebuilt → `story-41-5-qa-dist-consumer.test.ts` red: ops "every definition carries a skill-only field", "the 12 definitions equal the 12 generated skills", "never carry its skill description", and 2 raw-frame rows; `story-41-5-qa-preset-oracle.test.ts` 1 red (the built definitions' preset). Reverted, ops rebuilt.
- mutation: Q2 (no `skill` member on the wire) the `prompts/list` handler wrapped to add a top-level `skill` to each entry, shared rebuilt → dist-consumer 4 red (the 4 "prompts/list frame holds exactly name, title, description and arguments" rows) and shared `prompts.test.ts` 1 red; `story-41-2-qa-prompts-stdio-wire.test.ts` stays 35/35 green, because the SDK client's parse drops a key it does not know (shown: `ListPromptsResultSchema.safeParse` of `{name, skill}` returns `{name}`). Reverted, shared rebuilt.
- mutation: Q3 (`arguments` omitted entirely, rule #46) the `prompts/get` handler wrapped to turn an omitted `arguments` into `{}`, shared rebuilt → dist-consumer 6 red (admin, interop and ops, each the SDK row and the raw-frame row; dev has no all-optional prompt); `story-41-2-qa-prompts-stdio-wire.test.ts` stays green, because its row accepts a render or a refusal. Reverted, shared rebuilt.
- mutation: Q4 (the prompt's own preset) `runExternalBackup.ts` `skill.preset` "full" changed to "core", ops rebuilt, generated files left as they were → dist-consumer 1 red ("the 12 definitions equal the 12 generated skills") and preset-oracle 1 red ("the built prompt definitions declare the preset the oracle computes"); `pnpm validate:prompts` stays green and `pnpm gen:skills:check` reports DRIFT for `skills/run-external-backup/SKILL.md` and `skills/README.md`. Reverted, ops rebuilt.
- mutation: Q5 (declared presets against the real servers) the pack copy of `edit-and-test-class` widened from core to developer and `skills/deploy-and-test-class` narrowed from developer to core → preset-oracle 4 red (the two file rows, the spec-table row, the source/pack parity row). Reverted.
- mutation: Q6 (the oracle can vary) `{ IRIS_TOOLS_PRESET: preset }` replaced by `{}` where the oracle starts each server → preset-oracle 15 red (the "core and developer each hide tools" row, 12 file rows, the table row, the definitions row). Reverted.
- mutation: Q7 (`gen:skills` refuses before writing) the guard of `gen-skills.mjs` changed to `process.exitCode = 1` plus skipping each invalid prompt → `story-41-5-qa-gen-skills-refusal.test.ts` 18 red of 19 (9 write-mode rows on a stale tree, 9 `--check` rows); `validate-prompts-pack-checks.test.ts` (15), `skills-generated-frontmatter.test.ts` and `gen-skills-stray-file.test.ts` (36) stay green, because their stub is broken from the first prompt (a missing `skill` crashes the README render before any write) and the tree it compares was already up to date. Reverted.
- mutation: Q8 (a real YAML parser reads the frontmatter) the `name` of the pack copy of `trace-message-flow` changed to `Trace-Message-Flow` → `story-41-5-qa-yaml-consumer.test.ts` 1 red (that file's row). Reverted.
- After every revert `git diff --stat` and `git status --short` showed only the QA files and this spec; generated files and dists were rebuilt or regenerated where a mutation needed it (`gen:skills:check` 13 files, `gen:pack:check` 22 files, `validate:prompts` golden lines, `check:provenance` unchanged).
- Either order: the four test files ran with `--sequence.shuffle --sequence.seed=20261019` and `--sequence.seed=77`: 133 of 133 passed. The `(loop)` groups still pass (566, 121, 118, 63, 137 and shared 18).

**QA enumeration check (rule #56; report only, no class was widened).** Each item was run through `validate:prompts` in a scratch copy, or read from the real tree. Passing means the nine classes do not catch it.

- In the real tree, outside the scanned set: the pack `README.md` (shipped in the npm tarball, `files: ["skills-pack"]`) opens with a comment naming `pnpm gen:pack`; `skills/README.md` names `Epic 25`, `scripts/gen-skills.mjs`, `scripts/validate-prompts.mjs`, `packages/<server>/src/prompts/` and `pnpm gen:skills`; neither is a `listAgentContentFiles` source.
- In the real tree, inside the scanned set but uncaught: `check-system-health` says its areas are "informational in v1".
- On the wire, outside both validator scans: a prompt's `arguments` (name and description) are in `prompts/list` but not in `renderPromptText`. A scratch stub with `See Rule #7 and run pnpm.`, `Read packages/shared/src.` or an unknown `iris_not_a_real_tool` in an argument description passes (exit 0). Three real argument descriptions name tools (`iris_env_promote`, `iris_env_diff`, `iris_production_status`), so a rename would not break the build for them.
- Spelling variants that pass: `Rule 16` and `decision 15` (no `#`); `AC 41.5.1`, `AC41.5.1`, `NFR 12`, `FR12`, `AD28`, `DW 615`; `epic-41`, `Epic41`, `story-41-5`, `Stories 41.2 and 41.3`, `S41.5`, `wave 7`, a bare `41.5`; `GH-123`, `PR 45`, `issue 12`, `JIRA-123`; `spec-41-5`, `41-5-workflow-skills-refresh`.
- Tooling and files that pass: `validate:prompts`, `check:provenance`, `gen-skills`, `gen-pack`, `npm run build`, `yarn`, `eslint`, `changeset`; `tsconfig`, `CHANGELOG`, `README`, `.gitignore`, `node_modules`, and any name ending `.js`, `.cjs`, `.yml`, `.sh` or `.cls`.
- Paths and environment that pass: `./scripts/helper`, `../packages/shared`, `~/git/...`, `C:\git\...`, `c:/git/.../src/ExecuteMCPv2`, `file:///...` (the last two forms are already in the Residual risks), `ExecuteMCPv2/REST/Dispatch`, the namespace `HSCUSTOM`, `localhost:52773`, the repository name `iris-execute-mcp-v2`, `ExecuteMCPv2.Temp.Probe`, `IRIS_REQUIRE_LIVE`, `BOOTSTRAP_VERSION`, a commit hash, `IRIS 2026.2 Build 221U`.
- Process words that pass: the architecture spine, ledger, retrospective, burn-down, BMAD, Project Lead, orchestrator, project rules, golden, oracle, mutation. The two forms with a `#` (`decision #15`) and `pnpm` are caught.

**Mutation evidence (code review, 2026-10-19).** Each mutation was applied, run, observed red and reverted. After each revert, the snapshot hash of `git status --short`, `git diff` and the sha256 of every untracked file equalled the one taken before the first mutation (`5b7898aa0b4a93a224aaeafca927c578970716266f93e6f787276c6a485ff406`). A rebuild followed each revert that needed one.

- mutation: P1 (AC 41.5.4, a prompt's argument text is scanned). `promptSourceText` returns the rendered text and the skill description without the argument lines → 2 red: the source-text unit row in `validate-prompts.test.ts`, and the title, description, body and argument CLI row in `validate-prompts-pack-checks.test.ts`. Reverted.
- mutation: P2 (the CLI builds a prompt's text through the core). The CLI's prompt text is replaced by `prompt.skill?.description` alone → `validate-prompts-pack-checks.test.ts` 1 red, the same CLI row. The real-tree rows and the skill-description row stay green, which is the gap that row closes. Reverted.
- mutation: P3 (AC 41.5.4, the rule leg). The CLI drops the `rule:` and `pack:rules/` sources from the internal-reference call → `validate-prompts-pack-checks.test.ts` 1 red, the rule row. Every other row and the real tree stay green. Reverted.
- mutation: P4 (I/O row "Across servers", on the CLI path). M6 is re-applied for each source: every token is looked up in the first owner of the source's first token → 4 red. In `validate-prompts.test.ts` these are the three unit rows M6 named. In `validate-prompts-pack-checks.test.ts` it is the cross-server CLI row, whose green leg now exits 1. Reverted.
- mutation: P5 (the widened and narrowed classes). The seven changed patterns are restored to their pre-review form → `validate-prompts.test.ts` 17 red. That is the 12 spelling rows, the 4 accept rows (`i#2`, `Read x#5`, `error #5659`, `&#169;`) and the `Rule#7` row. Reverted.
- mutation: P6 (each prompt's preset over its widened text). `recoverStuckProduction.ts` `skill.preset` goes from `core` to `developer`, with interop rebuilt → `validate-prompts.test.ts` 1 red ("each prompt's own skill.preset is the first preset ..."). Reverted, interop rebuilt.
- mutation: V4a (AC "Unchanged counts", the `check:provenance` leg). `check-provenance.mjs` prints `agentFiles + 1` → 5 red across `story-41-1-qa-provenance-cli.test.ts` and `story-41-4-qa-first-row-process.test.ts`. Reverted.
  - The governance-baseline, tools-list-snapshot and bootstrap legs are the pre-existing `(once)` gates. This story changes none of their inputs, so they were not re-mutated.
- mutation: V4b (AC 41.5.3, `13 generated file(s)`). `gen-skills --check` prints `files.size + 1` → `story-41-1-qa-pack-scratch-cli.test.ts` 2 red. Reverted.
- mutation: V4c (I/O row "Grammar", the 41.3 process rows).
  - The unknown-metadata-key refusal is disabled → `story-41-3-qa-frontmatter-process.test.ts` 1 red ("an unknown metadata key"). Reverted.
  - M11 (`metadata` not an allowed field), re-run on the same file → 30 red, among them "accepts a metadata map that declares a tool preset". Reverted.
- mutation: V4d (the inverted 41.3 knowledge rows). Classes 1 and 3 become `/(?!)/` → `story-41-3-qa-knowledge-gate-process.test.ts` 3 red (the rule number, the DW id and the AD id). Reverted.
- mutation: V4e (the changed 41.1 knowledge fixture). `declaredToolPreset` always returns `null` → `story-41-1-qa-validate-prompts-pack.test.ts` 3 red, among them "good knowledge and rule sources are counted by kind once the pack is built". Reverted.
- mutation: V4f (the real-tree "declares one tool preset" row). `readSkillFrontmatter` no longer records a metadata value → `skills-pack-frontmatter.test.ts` 6 red, among them "each workflow skill declares one tool preset in its metadata, and no knowledge skill declares any". Reverted.
- mutation: Q1, re-run (lead item 5, after the helper tightened). The `skill` block is removed from `runExternalBackup.ts`, with ops rebuilt → red as recorded: 5 rows of `story-41-5-qa-dist-consumer.test.ts` and 1 of `story-41-5-qa-preset-oracle.test.ts`. Reverted, ops rebuilt.
- mutation: Q8, re-run (the YAML consumer now reads its blocks from stdin). The pack copy's `name: trace-message-flow` becomes `Trace-Message-Flow` → `story-41-5-qa-yaml-consumer.test.ts` 1 red. Reverted.
- Not re-mutated, with reasons:
  - **The two real-tree fingerprints** (`afterAll` in `validate-prompts-pack-checks.test.ts` and `story-41-5-qa-gen-skills-refusal.test.ts`). Showing them red needs a write into the real tree, which this review may not make. Each compares two fingerprints that the same function takes.
  - **The three corrected descriptions.** They are pinned by the oracle rows whose red M1 showed. The mechanism is unchanged, and M1's "around the change" is still in the description.
- Either order: the 8 added or changed test files ran with `--sequence.shuffle --sequence.seed=20261019` and with `--sequence.seed=4242`, 287 of 287 green both times.

**Commands run (code review, after the last patch).**
- Rebuilds: dev and interop after the description fixes, ops after Q1, interop after P6. Then `pnpm gen:skills` twice, `gen:skills:check` (13 files), `pnpm gen:pack` twice, and `gen:pack:check` (22 files).
- `node scripts/validate-prompts.mjs`: both golden lines unchanged.
- `pnpm check:provenance`: "1 provenance row(s), 39 agent file(s), 8 distribution(s)".
- `gen:governance-baseline:check` OK, `gen:tools-list-snapshot:check` OK (115), `node scripts/check-epics-sync.mjs` OK, and `git diff --stat packages/shared/src/bootstrap-classes.ts` empty.
- The test groups:

  | Group | Tests | Note |
  | --- | --- | --- |
  | The nine-file validator/pack group | 589 | |
  | The four `story-41-5-qa-*` files | 132 | |
  | The five-file wire group | 121 | live gates skipped |
  | The `story-41-1-qa-*` files | 118 | |
  | The `story-41-3-qa-*` files | 63 | |
  | `story-41-4-qa-first-row-process` with the `story-41-2-qa-*` files | 129 | |
  | Shared `prompts.test.ts` | 18 | |
  | `@iris-mcp/dev` | 1663 | |
  | `@iris-mcp/interop` | 672 | |
  | The full `@iris-mcp/all` suite, 121 files in three calls | 975 + 1132 + 867 | 1 + 2 + 1 skipped |
- `type-check` and `lint` for dev and interop were clean.
- An ad hoc `tsc --noEmit` (bundler resolution) over the changed `@iris-mcp/all` tests found no error on a changed line. Those tests have no type-check or lint script of their own.

## Auto Run Result

Status: done
Blocking condition: none

**Implement and review (2026-10-19).**

- **Summary.** `PromptDefinition` has an optional skill-only `skill: { description, preset }` (`PromptSkillDefinition`), set on all 12 prompts and never sent by `registerPrompt`. `gen:skills` renders each skill with its own `Use when` description, a `metadata` `iris-tools-preset` and a one-line DO-NOT-EDIT comment, and stops before any write when a prompt has no valid `skill` field. The frontmatter grammar accepts the optional `metadata` map, and `gen:pack` renders the pack README as a catalog of the 6 knowledge skills, the 12 workflow skills and the 1 rule. `validate:prompts` gains the skill-field, tool-preset and nine-class internal-reference checks, with the one DW-623 adaptation-header exemption and the golden second line. All 12 `SKILL.md` and the catalog reproduce their golden sha256 values; the 4 list and 12 get wire hashes are unchanged; `BOOTSTRAP_VERSION` is unchanged (`5296a1c836f4`).
- **Files changed.**
  - Shared: `packages/shared/src/tool-types.ts`, `packages/shared/src/index.ts` (the type and its export); `packages/shared/src/__tests__/prompts.test.ts` (in-memory list pin).
  - The 12 prompt definitions under `packages/iris-{admin,dev,interop,ops}-mcp/src/prompts/` (a `skill` property each).
  - Scripts: new `scripts/lib/workflow-skills.mjs`; `scripts/gen-skills.mjs`, `scripts/lib/skills-pack.mjs`, `scripts/lib/provenance-core.mjs`, `scripts/lib/tool-catalog.mjs`, `scripts/lib/validate-prompts-core.mjs`, `scripts/validate-prompts.mjs`, `scripts/check-provenance.mjs` (comment).
  - Generated by `gen:skills` and `gen:pack`: `skills/**` (12 skills and `skills/README.md`) and `packages/client-config/skills-pack/**` (12 skill copies and the catalog `README.md`).
  - Tests: new `validate-prompts-pack-checks.test.ts`; changed `skills-generated-frontmatter`, `skills-pack`, `skills-pack-frontmatter`, `skills-pack-knowledge`, `validate-prompts`, `story-39-6-qa-forensics-prompts-sdk-wire`, `story-40-4-qa-live-gate`, `story-40-5-qa-live-gate`, `story-41-1-qa-validate-prompts-pack`, `story-41-2-qa-prompts-stdio-wire`, `story-41-3-qa-frontmatter-process` and `story-41-3-qa-knowledge-gate-process`.
  - Docs: `README.md`, `skills-pack-src/README.md`, `CHANGELOG.md`, new `.changeset/story-41-5-workflow-skills-refresh.md`.
- **Review findings** (31, counted mechanically from the triage log: high 0, medium 2, low 25, false 4, maybe-false 0).
  - **Patched (10 findings, 7 entries):** the missing CLI-path rows for a prompt without a valid `skill` field and for an internal reference in a skill description (one medium entry); the overclaiming per-server scratch row title; the unfalsifiable `prompts/get` assertion; the unpinned rules sort; four missing `mutation:` lines; the "either order" evidence; and the unreachable roster clause in `visibleUnder`.
  - **Deferred:** none.
  - **Rejected (21), each with its reason in the triage log:** spec-bound decisions (the exactness rule of the preset, the nine class patterns, `readdirSync(root)`, the golden descriptions and docs texts), by-design separations (`agent-text-hygiene.ts`), duplicates of a patched or rejected root cause, the unarmed live gates (A5, P6), and descriptive intent-alignment notes.
- **Follow-up review recommended:** `false` (first pass: no high entry patched, one medium entry patched).
- **Verification.** Every `(loop)` and `(once)` command of `## Verification` ran green after the last patch (listed above). Mutations M1 to M13 and N1 to N9 were each applied, observed red and reverted with a byte-identical tree; the preset, internal-reference and DW-623 checks are proven red on the real CLI path, through `validate:prompts` on the real tree (M3, M7, M8b, M10c, M13) and through scratch copies (`validate-prompts-pack-checks.test.ts`).
- **Residual risks.**
  - The live gates A5 and P6 were edited but not executed (unarmed; no IRIS call).
  - The per-server preset lookup was pinned by unit rows only; no real-tree skill needs it to differ from a first-owner lookup (M6 line). Closed by the code review: a scratch CLI row with an ops tool and admin's `iris_database_manage` (mutation P4).
  - The absolute-path class knows POSIX roots only; both are the decided patterns. (A `./` or `../` prefixed repository path is caught since the code review.)
  - Code review, the internal-reference enumeration as of 2026-10-19 (Rule #56; mirrored under the CHANGELOG's Known limits). Every item was run through the check on the real repository entries.
    - **Spellings that pass.** Planning words: `Rule 16` with no `#` (left out because interoperability routing rules are numbered in legitimate text), `decision 15`, `wave 7`, a bare `41.5`, `S41.5`, a story key, `spec-41-5`, `GH-123`, `PR 45`, `issue 12` and `JIRA-123`. Tools and files: `gen-skills`, `gen-pack`, `npm run build`, `yarn`, `eslint`, `changeset`, `tsconfig`, `CHANGELOG`, `README`, `.gitignore`, `node_modules` with no `/` after it, and `.js`/`.cjs`/`.sh`/`.cls` names. Paths and environment: `~/git/...`, Windows paths and `file:///C:/...`, `ExecuteMCPv2/...`, `IRIS_REQUIRE_LIVE`, `BOOTSTRAP_VERSION`, a commit hash, a build string and the repository's name. Process words: spine, ledger, retrospective, burn-down, BMAD, Project Lead, orchestrator, project rules, golden, oracle, mutation.
    - **Legitimate text that is flagged.** A path under a top-level name of this repository (`src/`, `docs/`, `.claude/`, any untracked root entry), and the file names `AGENTS.md`, `CLAUDE.md`, `.mcp.json` and `package.json`.
    - **Deliberately not flagged:** `npm`, `npx`, `ExecuteMCPv2`, `HSCUSTOM` and `localhost:52773`.
  - Code review: the presets are not nested, and only the CHANGELOG says so; routed to Story 41.7's docs as DW-624.

**Plan stage (2026-10-19).** Halted after planning, as directed.

- **Planned:**
  - a skill-only `PromptDefinition.skill` (description, preset), set on all 12 prompts;
  - generated skills with model-invocation descriptions, `metadata` `iris-tools-preset` and a one-line DO-NOT-EDIT comment;
  - the extended frontmatter grammar;
  - the pack README as a catalog;
  - `validate:prompts` preset-visibility and no-internal-references checks, with the DW-623 one-line exemption.
- **Golden values:** the 12 generated `SKILL.md` files, the catalog and the baseline wire output (4 list and 12 get hashes, stdio, SDK 1.29.0, `26dc8b2`). All were rendered or captured by scratch scripts that wrote nothing in the repository.
- **Checked live against the tree:**
  - every golden description clause matches its skill body;
  - each declared preset equals the first preset that shows every named tool;
  - the nine internal-reference classes pass all 51 sources once the old header is removed, and only the adaptation header trips the file-name class.
- **Researched:** the Agent Skills spec (`metadata` map), the skills-ref validator (`ALLOWED_FIELDS` refuses other top-level keys), and the Claude Code skills docs (unknown fields ignored, `metadata` for own tooling), 2026-10-19.
- **IRIS:** none touched; no probe class created.
- **Orchestrator decisions needed:** seven, each with its recommendation in Design Notes:
  - the preset format;
  - the skill field's shape;
  - the 12 descriptions;
  - the header;
  - the internal-reference classes;
  - the catalog;
  - `skills/README.md`.
- **Ledger:** DW-623 addressed. **Deferred:** none.
