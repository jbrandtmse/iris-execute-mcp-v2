# Epic 41 Context: Companion Skills & Rules Pack

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Agents that write ObjectScript get the project's hard-won rules in three forms: one short, always-on pre-write checklist; 6–10 knowledge skills that the model loads when it needs them; and the workflow skills generated from the suite's MCP prompts. All three ship as one generated pack, `packages/client-config/skills-pack/`, and an installer in `@iris-mcp/client-config` puts it into each MCP client's native location. The competitor's MIT notice ships wherever adapted content ships. The pack is our own equivalent of the competitor's kit (intersystems-community/iris-agentic-dev), not a copy. Agents choose skills by their description, and MCP prompts are slash commands only a user can invoke, so shipping the content as skills is what lets agents actually find it. This is the only epic on `feature/feature-wave-7-skills-pack`. Story 42.8's Claude Code plugin consumes the same pack later.

## Stories

- Story 41.1: Pack Layout, Licensing and Provenance (done)
- Story 41.2: Always-On ObjectScript Pre-Write Rule (done)
- Story 41.3: Core Knowledge Skills (done)
- Story 41.4: Platform Knowledge Skills (done)
- Story 41.5: Workflow Skills Refresh
- Story 41.6: Skills and Rules Installer
- Story 41.7: Skills Pack Docs and Capstone

## Requirements & Constraints

- **Precedence.** The spine binds every story. Where a story and the spine disagree, the spine wins and the story text is amended in place.
  - The run is unattended. The orchestrator decides escalations and records them in `_bmad-output/implementation-artifacts/orchestrator-decisions-wave-7.md`, which holds #1–#15:
    - #1–#6 (41.1, 41.2): pack layout, notice filename, routing the two pack-wide checks to 41.5, retiring `objectscript-review`, the rule's two forms and markers, running 41.2's live check;
    - #7–#11 (41.3): suite-prefixed knowledge-skill names, knowledge skills name no `iris_*` tool, nothing adapted in 41.3, a `SKILL.md` starting with a BOM is refused, 41.3's skill text corrected in code review;
    - #12–#14 (41.4): three platform skills (six in all), adapt only upstream `objectscript-sql-patterns`, platform skills name no tool;
    - **#15 (standing for the rest of Epic 41):** code review corrects any false or over-broad claim in agent content once a live probe or a read of the IRIS source confirms it. In the same pass it updates the skill, the pack copy (via `gen:pack`), and the spec's golden text, sha256 values, probe log and anchors, and it records the change in the Spec Change Log. No new decision is needed.
  - The live session check of AC 41.2.5 passed. AC 41.7.3's is still open.
- **Agent content is the product** (decisions #11, #15). A false or over-broad claim in a skill is a defect. Every changed or added claim is probed first. The golden text, its sha256 and anchors, and the spec's change log move in the same pass.
- **Shipped knowledge skills (six, all tool-free, so none declares a preset).** Each directory holds only `SKILL.md`, and the skills cross-reference each other in a "Related skills" section.
  - 41.3: `iris-mcp-objectscript-gotchas`, `iris-mcp-objectscript-error-handling` and `iris-mcp-objectscript-unit-tests`.
  - 41.4: `iris-mcp-objectscript-sql` (embedded SQL and `%SQL.Statement`, the `%OpenId`/`%DeleteId` failures), `iris-mcp-system-classes` (`Config`/`SYS`/`Security`, deprecated properties, the `%SYS` switch, per-process against instance-wide counters) and `iris-mcp-interoperability` (host signatures, messages, adapters, settings, the production XData).
  - The count, 6, is read from the `knowledge/` directories (#51). Sources match their golden sha256 values: sql `135b2a37…`, system-classes `f5f22ff7…`, interoperability `f10dec5d…`.
  - **Format.**
    - **Description:** the first sentence says what the skill covers, then a `Use when` sentence gives the triggers. At most 1,024 characters, with no XML-like tag (write `UNDEFINED`, not `<UNDEFINED>`).
    - **Size:** at most 500 lines and 1,200 words by the suite's `wordCount`.
    - **Bytes:** ASCII and LF, with exactly one final LF. The one exception is the SQL skill's header line, which holds a U+00A9.
    - **Rule bullets:** no bullet of the always-on rule appears in a skill (whitespace-normalized).
- **Known-wrong source claims (DW-615).** These are decision-pending: the user decides, and no story edits `.claude/rules/*`. Never carry them into agent content:
  - a typed MultiDimensional property compiles;
  - `%OnNew` `Private` is refused (`#5477`) only when the parent's `%OnNew` is public;
  - `$$$AssertNotTrue`, `$$$AssertStatusEquals`, `$$$AssertSuccess`, `$$$AssertFailure` and `$$$AssertSkipped` exist;
  - an empty abstract body compiles;
  - `//` is a valid comment;
  - `%` names are a convention, not a compile rule;
  - `ExecuteMCPv2.*` classes resolve in `%SYS` on this instance;
  - `Use dev::("")` leaves redirection on.

  41.4 found nothing that contradicts the rules. It added two facts they lack: embedded SQL compiles when it first runs, and a `%PrepareClassQuery` result must be closed before switching the namespace back.
- **Workflow Skills Refresh (Story 41.5, next).**
  - **AC 41.5.1.** Regenerate every generated workflow skill, which means the 12 prompts that remain. Rewrite each skill's description for model invocation, because skills are chosen by their description. The MCP prompt text keeps its user-facing role.
    - Today each skill's description is the prompt's own `description`: 123–345 characters, and none has a `Use when` sentence.
    - Changing an MCP prompt's own description needs a recorded decision (AD-15). The precedent is `prompt-safety-invariants.test.ts:589-599`, which pins `deploy-and-test-class`'s description exactly.
  - **AC 41.5.2.** A generated pack catalog (the pack README) lists the knowledge skills, the workflow skills and the rule, with what each is for. It supersedes `skills/README.md` (AC 41.7.1).
  - **AC 41.5.3.** `gen:skills:check` and the extended `validate:prompts` pass.
  - **AC 41.5.4.** Two pack-wide checks, both in the default suite and proven red (#59):
    - **Preset visibility.** Every pack skill declares the preset it needs, and `validate:prompts` checks that every `iris_*` tool it names is visible under that preset. How a tool-free skill or the rule declares it is still undecided.
    - **No internal references.** No internal rule number, DW or AD id, or repository path appears in any agent content: skills, the rule and the prompts. This includes the generated skills' header comment, so it has to move out of agent-visible text.
  - **DW-623.** The no-internal-references check accepts the exact adaptation header line (`ADAPTATION_HEADER`) as the first body line of a skill that the provenance table marks adapted (today `iris-mcp-objectscript-sql`, line 6), and nowhere else. It needs negative controls for a second copy and for the line in a non-adapted skill.
  - **What the AC 41.5.4 checks meet today** (measured on the committed tree):
    - The only real internal references are the three frontmatter comment lines of each workflow skill (`scripts/gen-skills.mjs`, `packages/<pkg>/src/prompts/*.ts`, `pnpm gen:skills`).
    - The bodies trip the knowledge test's wider classes:
      - "a tool or server name": they name tools by design;
      - the generic "a path": slash words such as `SSL/TLS` and `and/or`;
      - "probe": `check-system-health` says "the probe itself failed";
      - "a repository path", once: `deploy-and-test-class`'s user-facing example `c:/path/to/src/**/<classOrPackage>*.cls` matches the top-level entry `src`.

      The knowledge test's class list cannot be reused unchanged.
    - All 12 workflow skills hold non-ASCII (em dashes, arrows); no AC requires ASCII.
  - **Preset need per workflow skill**, derived from today's `presets.ts` rosters and skill tokens (`iris_server_profiles` is always visible):
    - `core` suffices: `edit-and-test-class`, `find-patient-messages`, `provision-project-environment`, `recover-stuck-production`, `resend-failed-messages` and `trace-message-flow`.
    - `developer` is needed:
      - `deploy-and-test-class` (`iris_test_coverage`, `iris_test_status`; its body already says what to do when coverage is hidden);
      - `diagnose-slow-query` (`iris_sql_analyze`);
      - `promote-environment-change` (`iris_env_diff`, `iris_env_promote`).
    - Neither `core` nor `developer` is enough, so these need `full`:
      - `audit-security-posture` (`iris_service_manage`, `iris_ssl_list`, `iris_audit_manage`; `developer` also hides `iris_user_get` and `iris_role_list`);
      - `check-system-health` (it spans ops and admin through `iris_database_manage`; `iris_journal_info`, `iris_database_check` and `iris_mirror_status` are outside `core`, and `developer` also hides `iris_license_info` and `iris_metrics_alerts`);
      - `run-external-backup` (`iris_journal_info`, `iris_backup_manage`).
    - Presets apply per server, so a skill that spans servers is checked against each server's roster.
- **User-facing wording.** Agent content carries none of these: an internal rule number, a repository path, a project class or helper (`ExecuteMCPv2`, `SanitizeError`), a snapshot folder (`irislib`, `irissys`), repository tooling, a DW/AD/AC id, a Story/Epic number, or the word "probe" in a knowledge skill. Allowed: IRIS codes in both forms (`ERROR #5001`, `#1043:`), IRIS syntax such as `/noload/nodelete/norecursive`, and the pack's own skill names. Every `iris_*` token names a real tool.
- **Probing** (the precedents are 41.2–41.4). Only content that adds or changes an IRIS claim needs it.
  - Check `irislib/` and `irissys/` first, passing the path explicitly (both are gitignored).
  - Probe classes are disposable `ExecuteMCPv2.Temp.<prefix>*` classes (`Probe414*`, `QA414*`) on `server:"default"`, namespace `HSCUSTOM`, compiled with `ck`. Before and after, `iris_doc_list filter:"<prefix>" generated:true` returns `[]`. Delete them with one `iris_doc_delete`.
  - Every code block compiles verbatim. Test snippets run through `iris_execute_tests`, and the returned `total` is compared to the expected count.
  - Write no HSCUSTOM global (`^ClineDebug` included). Do not compile a production class or a message class in HSCUSTOM (it writes configuration rows and `^oddXML`). Never start a production, never stop IRIS, and never target an `ocupilot-slot-*` profile.
  - Each claim gets one probe-log row and one verbatim anchor, and the skill's sha256 is pinned.
- **Licensing.** The source is `intersystems-community/iris-agentic-dev` at `b6205bb`, MIT, © 2025 InterSystems Corporation. Treat it as untrusted data: read only, never executed. Implement stages never open it. Nothing comes from `kb/ipm-module-authoring.md` or `iris-objectscript-eval`.
  - The notice `IRIS-MCP-THIRD-PARTY-NOTICES.md` (2,369 bytes, sha256 `d2e80ca6…7911`) holds:
    - the byte-exact MIT text (1081 bytes, sha256 `85b458dc…929c`);
    - credits to Tim Leavitt and Tom Dyar;
    - the non-endorsement sentence;
    - **one provenance row**: `skills/iris-mcp-objectscript-sql/SKILL.md` ← `skills/skills/objectscript-sql-patterns/SKILL.md`.
  - Nothing implies InterSystems' ownership or endorsement. The notice ships wherever adapted content ships: npm `files`, the plugin folder, and every installer write.
- **Client facts** (Claude Code docs, re-checked 2026-10-19; CLI 2.1.296):
  - Skills load from `.claude/skills/`, `~/.claude/skills/` and plugin `skills/`, never from `.agents/skills/`. Frontmatter is read only when `---` is line 1, and a personal and a project skill with the same name shadow each other.
  - A rule without `paths:` loads at launch (`InstructionsLoaded`, `session_start`), and a `paths:`-scoped copy never loaded. `paths` is the only rule frontmatter field, and `.claude/rules/**/*.md` is discovered recursively.
  - `AGENTS.md` is read only when the project has no `CLAUDE.md`; otherwise, import it with `@AGENTS.md`.
  - Plugins cannot carry rules. A plugin always scans its default `skills/`.
- **Gate discipline.**
  - Prove each gate red on the path it guards (#59).
  - The capstone runs in the default suite (#21).
  - Count tallies mechanically (#51).
  - Review asks what is missing from each enumeration (#56).
  - Vary byte-preservation fixtures: CRLF, BOM, invalid UTF-8, no final LF (#58).
- **ASCII source.** New `.mjs`/`.ts` code writes non-ASCII as unicode escapes (hex `00a9` for the copyright sign). The edit tool decodes such escapes, so tests build those strings with `String.fromCharCode`. `scripts/gen-skills.mjs` holds literal em dashes today, including in the emitted header.
- **Out of scope.** No benchmarking in this repo. Also out: the plugin (42.8), a compile-on-save hook, skills about MCP server internals, and the extension UI.

## Technical Decisions

- **AD-28, prompts and workflow skills.** MCP prompts are authored once, in `packages/*/src/prompts/`, and the workflow skills are generated from them.
  - A skill's model-invocation description is a separate field on the prompt definition. Only `gen:skills` reads it, and a pin proves it never reaches `prompts/list`. Neither the field nor the pin exists yet.
  - `PromptDefinition` (`packages/shared/src/tool-types.ts:206-228`) has `name`, `title`, `description` ("LLM-optimised"), `arguments` and `build`.
  - `McpServerBase.registerPrompt` (`packages/shared/src/server-base.ts:1029-1145`) hands the SDK only `{ title, description }` (`:1073`) or `{ title, description, argsSchema }` (`:1133-1137`), so a new field stays off the wire unless it is passed there.
  - **Where each prompt's `description` sits today** (field line):
    - admin: `auditSecurityPosture.ts:17`, `provisionProjectEnvironment.ts:16`;
    - dev: `diagnoseSlowQuery.ts:17`, `deployAndTestClass.ts:23`, `promoteEnvironmentChange.ts:33`, `editAndTestClass.ts:18`;
    - interop: `traceMessageFlow.ts:17`, `recoverStuckProduction.ts:19`, `resendFailedMessages.ts:20`, `findPatientMessages.ts:21`;
    - ops: `checkSystemHealth.ts:16`, `runExternalBackup.ts:16`.

    Each package's `prompts/index.ts` exports `prompts`. `productionBusyNote.ts` (dev) is a shared helper, not a prompt.
  - `scripts/lib/prompt-catalog.mjs` `loadAllPrompts` imports each `packages/<pkg>/dist/prompts/index.js` (`PROMPT_PACKAGES`: ops, dev, interop, admin), so `gen:skills` and `validate:prompts` need built dists.
- **`scripts/gen-skills.mjs`.**
  - The header comment (`:1-28`) names spec `03-skills-prompts-pack.md`, Rules #18/#23/#25, and the write and `--check` modes.
  - `renderSkillMd` (`:58-67`) writes `---`, then three `#` comment lines (`# DO NOT EDIT — generated by scripts/gen-skills.mjs from` / `# packages/<pkg>/src/prompts/*.ts (source prompt: "<name>").` / `# Regenerate via: pnpm gen:skills`), then `name`, then `description: JSON.stringify(prompt.description)` (`:64`), then `---`, a blank line and the `build({})` body.
  - `renderReadme` (`:70-98`) writes `skills/README.md`: a `doNotEditHeader` (`:44-49`) and a 12-row `| Skill | Server | Description |` table of prompt descriptions. A `|` in a description would break it, which is why interop's `prompts.test.ts:220,338` pin no `|`.
  - Output is 13 files. `gen:pack` copies only `skills/<n>/`, so `skills/README.md` never enters the pack. `--check` reports MISSING, DRIFT and STRAY.
- **AD-28, skill frontmatter.** Every pack `SKILL.md` opens with frontmatter on line 1 (no BOM), holding only `name` and `description`.
  - `name` equals its directory, matches `^[a-z0-9]+(-[a-z0-9]+)*$`, has at most 64 characters, and contains neither `claude` nor `anthropic`.
  - `description` is non-empty, has at most 1,024 characters, and holds no XML-like tag (`->` is allowed).
  - `check:provenance` enforces this with its `skill-frontmatter` rule, which skips blank and `#` comment lines inside the block. A preset declaration extends that rule.
- **Conventions, "Pack names".** Hand-authored pack content carries the suite prefix (`iris-mcp-<name>`, `IRIS-MCP-THIRD-PARTY-NOTICES.md`). Generated workflow skills keep their prompt names (AD-15).
- **AD-28, one pack.** The pack is the committed, generated, DO-NOT-EDIT `packages/client-config/skills-pack/`.
  - Only `pnpm gen:pack` writes it. `gen:pack:check` fails on any MISSING, DRIFT or STRAY file. `scripts/gen-pack.mjs` "renders nothing from the prompt catalog, so it needs no build".
  - **Sources** live in `skills-pack-src/`:
    - `knowledge/<name>/SKILL.md` (six skills);
    - `rules/iris-mcp-objectscript-pre-write.md`: 2,120 bytes, 16 bullets, no frontmatter and no `iris_*` token, headed `## ObjectScript pre-write checklist`;
    - the notice;
    - the contributor `README.md`, which is not copied. It names the six skills, the one adapted skill and the knowledge test's header exemption.
  - **Shape.**
    - `skills/<name>/…` holds the 12 workflow and 6 knowledge skills;
    - `rules/claude-code/<name>.md` holds the source bytes;
    - `rules/agents-md/<name>.md` holds the bytes between `<!-- IRIS-MCP-RULE:<name>:BEGIN -->` and `…:END -->`;
    - the notice and a generated `README.md` sit at the root.

    That makes 22 files.
  - **`gen:pack` refuses** (exit 1, nothing written):
    - an unknown top-level entry (dotfiles included: DW-619's `.DS_Store`);
    - a `knowledge/<n>/` without `SKILL.md`;
    - a non-directory entry in `knowledge/`;
    - a name that is both a knowledge and a workflow skill;
    - a non-flat or misnamed `rules/` entry;
    - a rule with frontmatter;
    - a rule line starting `<!-- IRIS-MCP-RULE:`.
  - **Consumers.** The pack ships through client-config's `files` (`["dist", "!dist/**/__tests__", "skills-pack"]`) with no lifecycle hook. The installer reads it from its own package, and the plugin roots at it; a plugin at the repository root would load the skills twice. The installer's Claude Code route installs rules only when it detects the plugin.
- **`scripts/lib/skills-pack.mjs`.**
  - **Constants:** `PACK_SOURCE_DIR`, `KNOWLEDGE_SOURCE_DIR`, `RULES_SOURCE_DIR`, `PACK_DIR`, `WORKFLOW_SKILLS_DIR`, `NOTICE_FILENAME`, `PACK_README_FILENAME`, `RULE_FORM_DIRS`, `ALWAYS_ON_RULE_FILENAME`, `SKILL_FILENAME`, `SKILL_NAME`, `SKILL_NAME_MAX_LENGTH`, `SKILL_DESCRIPTION_MAX_LENGTH` and `SKILL_FRONTMATTER_FIELDS` (`['name','description']`; it is both the allowed and the required list, so an optional field needs the grammar to allow it without requiring it).
  - `renderPackReadme()` (`:134-151`) takes no argument and names no skill. It renders the DO-NOT-EDIT banner (naming `pnpm gen:pack`), a Layout section and a Third-party section. It is the function the 41.5 catalog replaces or extends.
  - `skillFrontmatterProblems(text, dirName)` (`:204-283`) returns only problem strings. It parses the values internally but exports no reader for them, and `assemblePack` (`:318-425`) never reads frontmatter.
  - `listAgentContentFiles` (`:439-472`) is the one agent-content enumeration (`.md` only). Its labels are `workflow:<n>/<f>`, `pack:skills/…` and `pack:rules/…`, `knowledge:<n>/<f>` and `rule:<f>`. The pack README and `skills/README.md` are NOT agent files. The `rule:` packRel `rules/<f>` is stale (DW-614, accepted).
- **Validator.**
  - `scripts/lib/validate-prompts-core.mjs` holds the pure functions `extractIrisTokens` (`\biris_[a-z0-9_]+\b`), `renderPromptText` (title + description + `build({})`, `:45-47`) and `validateSources`.
  - `scripts/validate-prompts.mjs` scans every prompt (`prompt:<pkg>/<name>`) and every agent file against `loadAllToolNames` (110 package tools + `iris_server_profiles`). Its OK line is at `:68-74`.
  - A skill-only description field is outside `renderPromptText` today.
- **Presets** (AD-7).
  - `TOOL_PRESET_NAMES` (`packages/shared/src/tool-visibility.ts:48`) = `full` (reserved: every tool visible), `core` and `developer`.
  - Each `packages/<pkg>/src/tools/presets.ts` exports `toolPresets: { core, developer }`, each `{ include, exclude }` (`assertPresetCoverage`). Include counts, core / developer: dev 14 / 32, admin 12 / 10, interop 11 / 24, ops 9 / 9, data 7 / 7.
  - `iris_server_profiles` is always visible (`server-base.ts:617`).
  - **Precedents for reading rosters:**
    - `scripts/lib/tools-list-snapshot-core.mjs:186` imports `dist/tools/presets.js`;
    - `prompt-safety-invariants.test.ts:398` checks edit-/deploy-and-test-class tokens against dev `core` (plus `iris_test_status`/`iris_test_coverage`);
    - `prompt-safety-invariants.test.ts:553` checks trace-message-flow and find-patient-messages tokens against interop `core` plus `iris_server_profiles`.
  - Hiding is ergonomics, never write-gating.
- **Adapted content (live since 41.4).**
  - **Trigger:** any agent file matching `/iris-agentic-dev/i` needs the header and a row.
  - **Header:** exactly `ADAPTATION_HEADER` (`scripts/lib/provenance-core.mjs:38`), as the first non-blank line after the frontmatter (`hasValidAdaptationHeader`, `:176`).
  - **Row:** under `PROVENANCE_HEADER_ROW`, ``| `skills/<name>/SKILL.md` | `skills/skills/<upstream>/SKILL.md` | <what changed> |`` (`parseProvenanceRows`, `:138`).
  - **Excluded sources:** `EXCLUDED_SOURCES`.
  - **`checkProvenance` rules:** `notice`, `mit-block`, `provenance-table`, `notice-sync`, `excluded-source`, `row-file`, `skill-frontmatter`, `header`, `claim-row` and `distribution`. `provenance-inputs.mjs` packs the 8 non-private packages.
  - **The knowledge test's exemption** (`skills-pack-knowledge.test.ts`):
    - `checkedText` (`:399-406`) drops exactly the first line equal to `ADAPTATION_HEADER`, only when `hasValidAdaptationHeader` holds and only for an oracle with `adaptedFrom` (`:60`, `:172`). It tolerates CRLF.
    - Controls: header last, a second copy, the header in a non-adapted skill, `(c)` in place of the copyright sign, and CRLF.
    - Its hygiene override `skillForbidden` (`:339-354`) adds `repositoryPathPattern` (`:325`, the top-level repository entries followed by `/`), "an absolute path", "an internal rule number" and "a class or helper of this project".
    - DW-623 asks 41.5's pack-wide check for the same narrowness, keyed on the provenance table.
- **Checks today** (derive any new number from the CLI, #51):
  - `gen:pack:check`: `22 pack file(s)`.
  - `gen:skills:check`: `13 generated file(s)`.
  - `validate:prompts`: `51 source(s) checked (12 prompt(s) + 39 content file(s): 12 workflow, 20 pack, 6 knowledge, 1 rule), 111 known tool name(s)`.
  - `check:provenance`: `1 provenance row(s), 39 agent file(s), 8 distribution(s)`.
- **Pins that move in 41.5.**
  - **Skill description:**
    - `story-39-6-qa-forensics-prompts-sdk-wire.test.ts:456-465` requires each skill's frontmatter to hold `description: JSON.stringify(<the prompts/list description>)` for trace-message-flow and find-patient-messages;
    - `skills-pack-frontmatter.test.ts:448-453` requires the generated `promote-environment-change` description to contain `->`.
  - **Header:**
    - `skills-generated-frontmatter.test.ts:98-100` requires a `# DO NOT EDIT` frontmatter comment containing `gen-skills.mjs` and `pnpm gen:skills`, which AC 41.5.4 removes from agent text (Rule #18 still wants a DO-NOT-EDIT marker);
    - its `:120-130` requires `skills/README.md` with a DO-NOT-EDIT banner, `gen-skills.mjs` and all 12 names.
  - **Pack README:** `skills-pack.test.ts:77-81` requires it to start `<!-- DO NOT EDIT`, contain `pnpm gen:pack` and the notice name, and not copy the contributor doc. Its fixtures write frontmatter-less `SKILL.md` files (`:53-56`), which a frontmatter-reading catalog would refuse.
  - **Counts:**
    - `13 generated file(s)` at `story-41-1-qa-pack-scratch-cli.test.ts:354,379`, if `skills/README.md` goes;
    - `22 pack file(s)` at `skills-pack-rule.test.ts:392` and `story-41-1-qa-pack-scratch-cli.test.ts:151` (`37` at `:319`);
    - the validator lines at `story-41-1-qa-validate-prompts-pack.test.ts:49,52,60,146` and `story-41-3-qa-knowledge-gate-process.test.ts:96`;
    - the provenance lines at `story-41-1-qa-provenance-cli.test.ts:99,105,111`, `skills-pack-frontmatter.test.ts:353,374` and `story-41-4-qa-first-row-process.test.ts:93,170`.
  - **Stay:**
    - the prompt-side pins: `prompt-safety-invariants.test.ts:589-599`, interop `prompts.test.ts:210-220`, and `story-41-2-qa-prompts-stdio-wire.test.ts`, whose `rowOf` (`:130-132`) reads only name, title and arguments, so it cannot see a leaked field;
    - the 12-prompt / 12-workflow pins (`validate-prompts.test.ts:113,203-204`, `skills-generated-frontmatter.test.ts:44-57`, `story-41-1-qa-pack-tarball.test.ts:123`, `skills-pack-frontmatter.test.ts:426`, `docs-prompt-sync.test.ts`).
- **Test helpers.**
  - `pack-fixture.ts`: `REPO_ROOT`, `makeTempRoot`, `put`, `runNode`, `committedRowFiles`.
  - `story-41-1-qa-fixture.ts`: `makeScratchRepo`, `runScript`, `problemRules`, `problemPairs`, `toCrlf`, `BOM`. CLI cases run on a scratch copy, never the real tree.
  - `agent-text-hygiene.ts`: `FORBIDDEN` (13 classes, each with a sample), `problemsOf` and `wordCount`. Its doc says a caller swaps a class for its own and says why.
  - Wire harnesses:
    - `process-gate-helpers.js` (`openWireSession`, stdio against the built `dist/index.js`);
    - `prompt-gate-helpers.js`;
    - in-memory SDK clients in `story-38-6-…` and `story-39-6-…-sdk-wire.test.ts`.
  - `skills-pack.test.ts` writes a temporary `zz-probe-skill` into the real `knowledge/`. This is safe only because `packages/iris-mcp-all/vitest.config.ts` sets `fileParallelism: false`.
- **Seams (#52).** Later stories:
  - extend `assemblePack` with new source kinds;
  - extend `gatherProvenanceInputs` with new distributions;
  - extend `SKILL_FRONTMATTER_FIELDS` and the grammar with new fields.

  They never re-touch the tree-sync helper (`lib/generated-tree.mjs`) or the pinned oracles.
- **AD-15.** An additive field on `PromptDefinition` is non-breaking. A change to an existing prompt's name, arguments, description or output needs a recorded decision. The `objectscript-review` retirement is done (decision #4).
- **AD-14.** A generated file changes only through its generator: `skills/`, `skills/README.md` and the pack. Never touch the installer-managed `.claude/skills/bmad-*` files. Write file content with the file tools, never a heredoc (#55).
- **AD-29.** Changesets stay `patch` or `minor`; 41.1–41.4 used `minor` for `@iris-mcp/client-config`. No story runs `changeset version` or publishes. Each story adds a top `CHANGELOG.md` section, `## [Pre-release — YYYY-MM-DD] — Story 41.N: <title>`, with Added, Changed, Tests and Known limits, and a paragraph on the counts that did not move.
- **AD-2.** The pack build and its checks live in `scripts/lib/` (each CLI and its `iris-mcp-all` test share one core) and read the built dist. `client-config` never depends on a server package, and `iris-mcp-all` does not depend on `client-config`.
- **AD-30 (installer writes).**
  - **Write protocol:** validate → timestamped backup → edit → re-parse → auto-restore on failure, with the diff preview shown first.
  - **Ownership:** only owned files and marked blocks are written, and foreign bytes are preserved (CRLF, BOM, comment, no final newline, foreign block).
  - **Manifest:** a per-target manifest of paths and hashes. An update removes owned paths that are gone, and a file whose hash changed is never overwritten without confirmation.
  - **Re-install and uninstall:** re-install is idempotent, uninstall removes only owned content, and third-party content is never logged.
- **Prompts today (12).**
  - dev: `diagnose-slow-query`, `deploy-and-test-class`, `promote-environment-change` and `edit-and-test-class`;
  - admin: `provision-project-environment` and `audit-security-posture`;
  - interop: `trace-message-flow`, `recover-stuck-production`, `resend-failed-messages` and `find-patient-messages`;
  - ops: `check-system-health` and `run-external-backup`;
  - data: none.

  An omitted `arguments` gets -32602 on the all-optional prompts (DW-617, owned by 43.1).
- **Missing today:** an `AGENTS.md` and a plugin manifest. The root `LICENSE` is MIT, © 2026 jbrandtmse.
- **`client-config` as it stands** (for 41.6).
  - **CLI.** The bin is `iris-mcp-clients`, with commands `detect`, `status`, `diff`, `apply`, `enable`, `disable`, `remove`, `restore` and `doctor`.
    - Exit codes: 0 success, 1 operational failure, 2 usage error.
    - With `--json`, a command answers with one envelope, `{ok, command, data, error?}`.
    - `apply` needs `--yes` or a TTY confirmation.
  - **Adapters.** `adapters.ts` has 13 `CLIENT_ADAPTERS` and 3 `CLIENT_DISPOSITIONS`, which make AC 41.6.1's 16 rows. `ADAPTER_DATA_VERSION` is `2026-07-28.1`.
  - **Engine and writes.**
    - `engine.ts` owns an entry by its canonical name or by the `state.json` ledger.
    - `write.ts` `applyWrite` re-parses JSON, JSONC, TOML or YAML. Markdown and rule files need a variant of the protocol.
    - Backups go to `<stateDir>/backups/<client>/<scope>/<file>.<ts>`.
    - `readers.ts` strips a BOM, but the write path has no BOM handling.
  - **Marker precedent:** `render-certification-table.mjs`'s `<!-- ADAPTER-TABLE:BEGIN/END -->`.
- **Counts that must not move.**
  - Tools: 110 package, 115 advertised.

    | Server | Package tools | `core` (package / runtime) |
    | --- | --- | --- |
    | dev | 32 | 14 / 15 |
    | admin | 26 | 12 / 13 |
    | interop | 24 | 11 / 12 |
    | ops | 21 | 9 / 10 |
    | data | 7 | 7 / 8 |

  - The governance baseline is `1e62c5ad5bf7`/141, and `BOOTSTRAP_VERSION` is `5296a1c836f4`.
- **Running checks.**
  - `gen:skills`, `validate:prompts` and `check:provenance` need built dists of shared, the five servers and client-config. A `PromptDefinition` change needs shared and the servers rebuilt before `gen:skills`.
  - Run pack tests standalone: `pnpm --filter @iris-mcp/all exec vitest run <files>`.
  - The full `@iris-mcp/all` suite (about 115 files) runs in three foreground calls (`ls src/__tests__/*.test.ts | awk 'NR%3==k'`).
  - Turbo does not order those tests after client-config's build, and its cache omits the pack inputs (DW-611, owned by 41.7).

## UX & Interaction Patterns

- **Skill descriptions** say what the skill covers, then when to load it (`Use when …`), because the model picks skills by description. MCP prompt text keeps its user-facing role as a slash command.
- **Pack catalog.** The generated README lists every knowledge skill, every workflow skill and the rule, with what each is for.
- **Installer.** It previews a dry-run diff before any write and confirms like `apply` does. Re-install is idempotent, and update and uninstall touch only owned files.
- **Claude Code with a `CLAUDE.md`.** Use `.claude/rules/`, and tell the user to import `AGENTS.md` (`@AGENTS.md`) rather than assume it is read.
- **Client routes**, at minimum:
  - Claude Code → `.claude/skills/` and `.claude/rules/`, copying only the `claude-code` form;
  - VS Code / Copilot → `.github/instructions/*.instructions.md` with `applyTo:`;
  - Cursor → `.cursor/rules/`;
  - other agents → `.agents/skills/` and the `agents-md` block in `AGENTS.md`.

  Extra forms go in as `rules/<client>/`.

## Cross-Story Dependencies

- **41.1–41.4 (done)** delivered the pack and its sources:
  - the layout, `gen:pack`, the notice and the provenance check;
  - the extended validator;
  - the rule's two forms and markers, and the prompt retirement;
  - six knowledge skills;
  - the `skill-frontmatter` rule;
  - the first real provenance row, with the knowledge test's one-line header exemption.
- **41.5** works in this order:
  1. It adds the model-invocation description field to `PromptDefinition`, sets it on all 12 prompts, and has `gen:skills` write it. It pins that `prompts/list` never carries it.
  2. It regenerates `skills/`.
  3. It moves the generated header out of agent-visible text.
  4. It turns the pack README into the catalog.
  5. It builds the preset-visibility and no-internal-references checks over every agent file (DW-623 included).

  The preset declaration extends `SKILL_FRONTMATTER_FIELDS` and decides what a tool-free skill and the rule declare.
- **41.6** reads `skills-pack/`, installs `skills/<name>/` (all 18) owned by name, writes the notice beside the adapted skill, covers all 16 adapter rows, and appends the installer payload to `gatherProvenanceInputs`. It owns DW-616, the `AGENTS.md` marker-reading contract:
  - report, never guess, a missing, repeated or out-of-order own marker;
  - decide whether a BOM belongs to line 1;
  - end an unterminated last line before appending;
  - point the 41.2 consumer test at the real reader.
- **41.7** writes the root README pack section and the client-config README installer docs; the generated catalog supersedes `skills/README.md`.
  - Its capstone drives the CLI against a temporary project for every route, and runs the one-time live Claude Code check that lists the installed skills (41.2's procedure is reusable).
  - It owns DW-611: test ordering and turbo inputs covering the pack sources, `scripts/`, client-config's `package.json`, `skills-pack/**` and `dist/`.
- **Downstream:**
  - 42.6 owns the publish-path gate (DW-612);
  - 42.8 roots the plugin at the pack, ignores `rules/`, and adds the plugin distribution to `check:provenance`;
  - 43.1 owns DW-617;
  - DW-622 (`SanitizeError` strips only English and Arabic prefixes) goes to an Epic 41 burn-down if one is chartered.
