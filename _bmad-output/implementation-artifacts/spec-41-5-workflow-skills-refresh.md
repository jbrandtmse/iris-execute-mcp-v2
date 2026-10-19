---
title: 'Story 41.5: Workflow Skills Refresh'
type: 'feature'
created: '2026-10-19'
status: 'ready-for-dev'
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

## Spec Change Log

- 2026-10-19 (lead spec gate): the 7 orchestrator decisions were taken as recommended (wave-7 decisions #16-#22). Spine AD-28 was amended with the drafted text: the frontmatter `metadata` map, the first-of-core/developer/full preset rule, the prompt `skill` field, the nine internal-reference classes with the DW-623 exemption, and the catalog wording. The spine lint passed. Counts and the wire are unchanged.

## Review Triage Log

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
- **"Internal references".** Read as the nine classes. The check covers each prompt's title, description, body and skill description.
- **"The MCP prompt text keeps its user-facing role" (AC 41.5.1).** The wire bytes are unchanged, as pinned. A skill description is not a prompt-body change (AD-15): no prompt name, title, description, argument or rendered text changes, so no sanctioned-change entry is needed.

**Golden descriptions and presets.** In `prompt.skill`, and in each skill's frontmatter. These are the planned `SKILL.md` sha256 values, rendered from these values and today's `build({})`; the line counts are unchanged.

| Skill | Preset | Bytes | sha256 |
| --- | --- | --- | --- |
| audit-security-posture | full | 2748 | `8068f9063ec48465abe299f73391b61714f565f5d6cce6fe567ecc1ad84ae43d` |
| check-system-health | full | 2680 | `2cbc983d96fc39f826ab04ae7859de6f34c64d89a03c40c5d533561f7bd21cda` |
| deploy-and-test-class | developer | 6753 | `ba24af252067fe92ce4046b5956b4e2918812b1ad0775371d9b25a238ab5448c` |
| diagnose-slow-query | developer | 2209 | `3a76caf480096ca68bdfdc47150d4c4e19db383b2c2a18e7321aa9ca8706d8f3` |
| edit-and-test-class | core | 4338 | `636f70baddf7add206532d64372ab53adfd337336766f6366250b1c0545b478d` |
| find-patient-messages | core | 3412 | `4e6472ab0fc3748e82a4d5a458de546c26e4aff5d713395cf86fd32264e66daa` |
| promote-environment-change | developer | 4874 | `e6458184bf4be63be6bea23d9cf1c1b141c50d820d04d0c9268d459bb5b6ed69` |
| provision-project-environment | core | 2343 | `dd8f6c73a0f16670fd93337c1fb6e2154f26fb9c246b313876b7adccd469498e` |
| recover-stuck-production | core | 2919 | `efb9c171934a20c6b6d1c611af976b4039f92d47962689e349e0bc70a433c6e1` |
| resend-failed-messages | core | 3087 | `b9e38324de5fdf454f74f45b951000bc124ee5e56465fffef41dd8cb7a5b8ccf` |
| run-external-backup | full | 2102 | `40d01bd37a98297430ca307c2a1424a940f0b2521859e7c8e10d14ba3ee59764` |
| trace-message-flow | core | 4767 | `b2e6b0812fecec3f07f384072bd574d687e1b3164802c1c43e28f0e40de2d2d8` |

The descriptions, verbatim (each value is one line):

~~~text
audit-security-posture: A read-only audit of an IRIS instance's security: users whose password settings look stale or that may use a well-known default credential, every user and role that holds %All, services that are enabled without authentication or not needed, SSL/TLS configurations with a minimum TLS version below 1.2 or missing certificate paths, and whether auditing is on, ending in a report of recommended fixes; it changes nothing. Use when the user asks to audit, review or harden IRIS security, asks who holds %All, or asks whether services, SSL/TLS or auditing are set up safely.
check-system-health: Runs one composite health check of an IRIS instance across its nine areas (journal, databases, license, locks, alerts, mirror, ECP, interoperability and the system) and follows each warning, critical or error finding to the tool that explains or fixes it, never running a destructive fix without the user's confirmation. Use when the user asks whether IRIS is healthy or wants a health or status check, or reports trouble with journal space, database size, the license, locks or alerts.
deploy-and-test-class: Deploys an ObjectScript class or package from local source files to IRIS with a glob-path load and compile, fixes compile errors in the source and loads it again, runs its unit tests, compares the returned total with the number of test methods because an early partial result looks like a green run, re-attaches to a run that is still going instead of starting a second one, and measures line coverage when the user asks for it. Use when the user wants to deploy, load or import ObjectScript source into IRIS, compile it, run its %UnitTest tests, or see their coverage.
diagnose-slow-query: Diagnoses a slow IRIS SQL query from its query plan, the maps and indexes the plan reads, and the statement's cumulative run-time statistics, looking for full table scans, missing indexes, hot statements and plan inefficiencies, then recommends a fix such as a new index or a rewritten WHERE clause without applying it. Use when the user says a SQL query is slow, asks why a query does not use an index, or wants a query plan explained.
edit-and-test-class: Changes a few lines of an ObjectScript class directly in IRIS: reads only the lines around the change, applies a guarded line edit that stores nothing when the class no longer matches what was read, compiles the class and fixes errors the same way, runs its unit tests and checks the returned total, and reports the diff. Use when the user wants a small fix or change to a class that lives in IRIS, especially one with no local source file, or asks to patch, compile and test a class in place.
find-patient-messages: Finds a patient's interoperability messages by an identifier such as a medical record number, through a Search Table and in search windows of at most 7 days, lists the matching message headers, and reads message bodies only when the user wants the content, under the PHI data policy, which redacts or withholds them. Use when the user asks for the messages, HL7 traffic or message history of a patient or medical record number in an IRIS interoperability production.
promote-environment-change: Promotes configuration and code drift from one IRIS environment to another in review-before-write order, diff -> plan -> confirmed execute -> second diff: it compares mappings, System Default Settings, web applications, supported CPF settings and, given a spec, ObjectScript source, executes only the plan steps the user picks and confirms, and checks that the promoted drift is gone. It never removes an item that exists only on the target. Use when the user wants to compare two IRIS servers or environments, or to promote, sync or copy changes from one to another, such as from development to test.
provision-project-environment: Provisions a new IRIS project environment in order: a DATA and a CODE database, a namespace over them, a user whose default namespace it is, and a web application, checking each step before the next, rolling back the completed steps when one fails, and naming the manual follow-up a new web application needs. Use when the user wants to set up or create a new IRIS project, namespace or application environment.
recover-stuck-production: Diagnoses and recovers a troubled or wedged interoperability production along an escalation ladder, in order: status, queues and error logs first, then the recover action, and the clean action only when recover does not fix it, never wiping persistent business state unless the user explicitly accepts the data loss. Use when an IRIS interoperability production is stuck, troubled or suspended, messages are not processing or queues are backing up, or the user asks to restart or recover a production.
resend-failed-messages: Resends failed interoperability messages for one configuration item, dry run first: it previews the match count and a sample, resends only after the user approves with an explicit confirmation, and then checks the new message headers. It states that a resend delivers the data downstream again and that the resend actions are writes disabled by default. Use when the user wants to retry, replay or resend failed or errored messages in an IRIS interoperability production.
run-external-backup: Freezes an IRIS instance for an external backup snapshot taken at the OS or SAN level, waits while the user takes the snapshot, and always thaws the instance afterwards, even when the snapshot fails, then confirms that journaling resumed and checks the run in the backup history. Use when the user wants to back up IRIS with an external OS-level or SAN snapshot, or asks to freeze and thaw IRIS database writes for a backup.
trace-message-flow: Traces one interoperability message flow from a session or message header ID: lists every hop, searches the session's message headers, reads the bodies that matter under the PHI data policy, draws a sequence diagram, and pulls the error log entries of each failing item, then reports where the flow failed and recommends next steps without running a recovery. Use when the user asks what happened to a message or session, why a message failed or never arrived, or how a message moved through an IRIS interoperability production.
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

1. `an internal rule number`, `/\bRules? #\d+/i`, `see Rule #7`.
2. `a number sign and digits that are not an IRIS error code`, `/(?<!ERROR )#\d+(?!\d|:)/`, `item #58`.
3. `a planning or deferred-work id`, `/\b(?:DW|AD|AC|NFR|FR)-\d+/`, `tracked as DW-615`.
4. `a story or epic number`, `/\b(?:Story|Epic|Sprint)\s+\d/i`, `added in Story 41.2`.
5. `a repository path`: the top-level repository entries, escaped, joined, then `/`, behind `(?<![A-Za-z0-9_./-])`. Sample `see packages/shared`.
6. `an absolute path`, `/(?<![A-Za-z0-9_.-])\/(?:Users|home|private|tmp|usr|opt|var)\//`, `open /Users/someone/file`.
7. `a repository file`, `/\b[\w-]+\.(?:md|ts|mjs|json|yaml|toml)\b/i`, `edit rules.md`.
8. `repository tooling`, `/\b(?:pnpm|turbo|vitest|tsc)\b|\bgen:[a-z]/`, `run pnpm test`.
9. `a snapshot folder`, `/\birislib\b|\birissys\b/`, `read irislib`.

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

**The catalog template.** The renderer output for the real tree is 11,611 bytes, 48 lines, sha256 `4806e801f7a9dff2eae1d4099a6dc481d5d2ea410407584fca76e22e85c99b82`, ASCII. Slots are in `<>`. Each list is sorted by name, and an empty list renders `None.`. Without a readable description, an entry renders `(no description could be read from its frontmatter)`. ` (tool preset `<p>`)` appears only when a valid preset is declared. A rule's title is its first line matching `^#{1,6}[ \t]+(.+?)[ \t]*$` (a trailing CR removed), or else its stem.

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

- `(loop)` `shasum -a 256 skills/*/SKILL.md packages/client-config/skills-pack/README.md` -- expected: the 12 golden values and the catalog's `4806e801...`.
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

## Auto Run Result

Status: ready-for-dev
Blocking condition: none

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
