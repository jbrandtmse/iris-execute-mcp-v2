# Epic 41 Context: Companion Skills & Rules Pack

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Agents that write ObjectScript get the project's hard-won rules in three forms: one short, always-on pre-write checklist; 6–10 knowledge skills that the model loads when it needs them; and the workflow skills generated from the suite's MCP prompts. All three ship as one generated pack, `packages/client-config/skills-pack/`, and an installer in `@iris-mcp/client-config` puts it into each MCP client's native location. The competitor's MIT notice ships wherever adapted content ships. The pack is our own equivalent of the competitor's kit (intersystems-community/iris-agentic-dev), not a copy. Agents choose skills by their description, and MCP prompts are slash commands only a user can invoke, so shipping the content as skills is what lets agents actually find it. This is the only epic on `feature/feature-wave-7-skills-pack`. Story 42.8's Claude Code plugin consumes the same pack later.

## Stories

- Story 41.1: Pack Layout, Licensing and Provenance (done)
- Story 41.2: Always-On ObjectScript Pre-Write Rule (done)
- Story 41.3: Core Knowledge Skills (done)
- Story 41.4: Platform Knowledge Skills (done)
- Story 41.5: Workflow Skills Refresh (done)
- Story 41.6: Skills and Rules Installer (next)
- Story 41.7: Skills Pack Docs and Capstone

## Requirements & Constraints

- **Precedence.** The spine binds every story. Where a story and the spine disagree, the spine wins and the story text is amended in place.
  - The run is unattended. The orchestrator decides escalations and records them in `_bmad-output/implementation-artifacts/orchestrator-decisions-wave-7.md`, which holds #1–#22:
    - #1–#6 (41.1, 41.2): pack layout, notice filename, routing the two pack-wide checks to 41.5, retiring `objectscript-review`, the rule's two forms and markers, running 41.2's live check;
    - #7–#14 (41.3, 41.4): suite-prefixed knowledge-skill names, knowledge skills name no `iris_*` tool, a `SKILL.md` starting with a BOM is refused, six knowledge skills, only upstream `objectscript-sql-patterns` adapted;
    - **#15 (standing for the rest of Epic 41):** code review corrects any false or over-broad claim in agent content once a live probe or a read of the IRIS source confirms it. In the same pass it updates the source, the pack copy (via the generators), and the spec's golden text and sha256 values, and records the change in the Spec Change Log. No new decision is needed. 41.5's review used it on three workflow-skill descriptions;
    - #16–#22 (41.5): the `metadata` `iris-tools-preset` declaration, the `PromptDefinition.skill` field, the 12 golden descriptions, the one-line generated header, the nine internal-reference classes, the catalog order, and keeping `skills/README.md` for now.
  - The live session check of AC 41.2.5 passed. AC 41.7.3's is still open.
- **Agent content is the product** (decisions #11, #15). A false or over-broad claim in a skill is a defect. Every changed or added IRIS claim is probed first. The golden text, its sha256 and the spec's change log move in the same pass.
- **What the pack holds (18 skills, 1 rule).**
  - **Six knowledge skills,** all tool-free, so none declares a preset: `iris-mcp-objectscript-gotchas`, `iris-mcp-objectscript-error-handling`, `iris-mcp-objectscript-unit-tests`, `iris-mcp-objectscript-sql`, `iris-mcp-system-classes` and `iris-mcp-interoperability`. Each directory holds only `SKILL.md`.
  - **Twelve workflow skills,** generated from the prompts and keeping the prompt names. Presets: `core` for edit-and-test-class, find-patient-messages, provision-project-environment, recover-stuck-production, resend-failed-messages and trace-message-flow; `developer` for deploy-and-test-class, diagnose-slow-query and promote-environment-change; `full` for audit-security-posture, check-system-health and run-external-backup.
  - **One rule,** `iris-mcp-objectscript-pre-write` (16 bullets, no frontmatter, no tool).
  - **Bytes.** The knowledge skills are ASCII and LF, except the SQL skill's adaptation header (a U+00A9). All 12 workflow skills hold non-ASCII (em dashes, arrows). An installer must copy bytes, never re-encode them.
- **Known-wrong source claims (DW-615).** These are decision-pending: the user decides, and no story edits `.claude/rules/*`. Never carry them into agent content:
  - a typed MultiDimensional property compiles;
  - `%OnNew` `Private` is refused (`#5477`) only when the parent's `%OnNew` is public;
  - `$$$AssertNotTrue`, `$$$AssertStatusEquals`, `$$$AssertSuccess`, `$$$AssertFailure` and `$$$AssertSkipped` exist;
  - an empty abstract body compiles;
  - `//` is a valid comment;
  - `%` names are a convention, not a compile rule;
  - `ExecuteMCPv2.*` classes resolve in `%SYS` on this instance;
  - `Use dev::("")` leaves redirection on.
- **Story 41.5 delivered** (committed `ed18320`; DW-623 resolved):
  - **The `skill` field.** `PromptDefinition.skill?: PromptSkillDefinition { description, preset }` (`packages/shared/src/tool-types.ts:195-243`). All 12 prompts set it. Only `gen:skills` and `validate:prompts` read it. `registerPrompt` never passes it, and a stdio pin over the built servers proves `prompts/list` and `prompts/get` are byte-identical to `26dc8b2` (16 golden hashes).
  - **The generated `SKILL.md`.** It holds `---`, then `# DO NOT EDIT: generated from the MCP prompt of the same name.` (`WORKFLOW_SKILL_COMMENT`), then `name`, then `description: <JSON>` (each description restates the body and ends with a `Use when` sentence; 411–601 ASCII characters, no `|`, no tag, no `iris_*`), then `metadata:` with `  iris-tools-preset: <p>`, then `---`, a blank line and the `build({})` body. `renderWorkflowSkill` and `promptSkillProblems` are in `scripts/lib/workflow-skills.mjs`.
  - **The preset rule.** The declared preset is the first of `core`, `developer` and `full` under which every real tool the skill names is visible on the server that owns it. The presets are not nested (admin `developer` hides `iris_user_manage`, which `core` shows). A skill or rule that names no tool declares none.
  - **The catalog.** The pack `README.md` is generated: the DO-NOT-EDIT banner, an intro, then sections for Knowledge skills, then Workflow skills, then Always-on rules. Each section is sorted by name, and each skill shows its description and any preset. It is followed by the old Layout and Third-party sections. Broken frontmatter renders a fallback text, never a refusal. Its sha256 is `bdd1b54f…`, 48 lines.
  - **`validate:prompts`.** It gained three checks, each with its own section: `[skill-field]`, `[preset]` and `[internal-reference]`. The text checked for a prompt is title, description, body, each argument's name and description, and the skill description.
  - **The DW-623 exemption.** The exact `ADAPTATION_HEADER` line is exempt only as the first body line of a file a provenance row names (`withoutAdaptationHeader`, `scripts/lib/provenance-core.mjs:198`). That is 2 lines today: the SQL source and its pack copy.
  - **`skills/README.md`** stays as the 13th generated file. It is contributor-facing, not agent content: it keeps the generator pointer and adds a `Tool preset` column. 41.7 supersedes it.
- **Story 41.6, Skills and Rules Installer (next).** `packages/client-config` installs the pack into each client's native location.
  - **AC 41.6.1.** A per-client disposition table covers **all 16 adapters** in `adapters.ts`: the 13 `CLIENT_ADAPTERS` (claude-code, claude-desktop, cursor, vscode, cline, roo-code, windsurf, codex, gemini, zed, goose, kimi, kimi-code) and the 3 `CLIENT_DISPOSITIONS` (pi, jetbrains-junie, kilo-code).
    - It is exhaustive as of a named date, with a documentation source for each row (Rule #56).
    - Each row gives the native skill location and the rule location and format, or "`AGENTS.md` fallback" with the reason.
    - The minimum: Claude Code → `.claude/skills/` and `.claude/rules/`; VS Code / Copilot → `.github/instructions/` (`*.instructions.md` with `applyTo:`); Cursor → `.cursor/rules/`; other agents → `.agents/skills/` and `AGENTS.md`.
    - Review asks what is missing. Each adapter's `docsUrl` is its MCP-configuration page, not a skills or rules page, so it is not that row's source.
  - **AC 41.6.2.** The installer is driven by the existing engine:
    - a dry-run diff before any write;
    - idempotent re-install;
    - update and uninstall of only the files it owns;
    - `IRIS-MCP-THIRD-PARTY-NOTICES.md` written alongside every installed copy of adapted content (today `iris-mcp-objectscript-sql`).

    An existing `AGENTS.md`, `CLAUDE.md` or instructions file is preserved byte for byte outside the marked block. The fixtures are varied (Rule #58): CRLF, a BOM, comments, no trailing newline, and an existing foreign block. 41.1 and 41.2 also used non-ASCII and invalid UTF-8 for pack bytes.
  - **AC 41.6.3.** When a project has a `CLAUDE.md`, the Claude Code route uses `.claude/rules/`, and the installer reports how to import `AGENTS.md` (`@AGENTS.md`) instead of assuming it is read.
  - **AC 41.6.4.** It is a CLI command on `iris-mcp-clients`. The extension UI is out of scope.
  - **DW-616 (owned by 41.6): the `AGENTS.md` marker-reading contract.**
    - Report, and never guess, when its own marker is missing, repeated or out of order. The cases are two sections, BEGIN without END, END without BEGIN, two BEGIN lines and one END, and END before BEGIN.
    - Decide whether a BOM before line 1 belongs to that line. Today's test-local reader splits on latin1 lines, so a BOM is part of line 1 and a BEGIN marker right after a BOM is not found. Every BOM fixture places the BOM before a heading.
    - End a last line that has no newline before appending, in the file's own style. Appending the form directly puts BEGIN inside the last line, so no marker line exists.
    - Replace the test-local `locateBlock`/`replaceBlock` reader in `packages/iris-mcp-all/src/__tests__/story-41-2-qa-agents-md-consumer.test.ts:48-96` with the installer's real one. 16 of its 60 rows exercise only the local reader.
- **User-facing wording,** now enforced by `validate:prompts` over every prompt and agent file in nine classes:
  - rule numbers;
  - a bare `#n` that is not an IRIS error code;
  - planning ids (DW/AD/AC/FR/NFR);
  - story, epic or sprint numbers;
  - repository paths (top-level entries followed by `/`);
  - absolute POSIX paths;
  - repository file names (`.md`, `.ts`, `.mjs`, `.json`, `.yml`/`.yaml`, `.toml`);
  - repository tooling (`pnpm`, `turbo`, `vitest`, `tsc`, `gen:`/`validate:`/`check:`);
  - `irislib`/`irissys`.

  Deliberately allowed: `npm`/`npx`, `ExecuteMCPv2`, IRIS error codes, and the pack's own skill names. Every `iris_*` token names a real tool.
- **Probing** is needed only for content that adds or changes an IRIS claim. Check `irislib/`/`irissys/` first (pass the path; both are gitignored). Probe classes are disposable `ExecuteMCPv2.Temp.<prefix>*` on `server:"default"`, `HSCUSTOM`, and are deleted. Write no HSCUSTOM global, never start a production, never stop IRIS, and never target an `ocupilot-slot-*` profile. An installer story needs no IRIS call.
- **Licensing.** The source is `intersystems-community/iris-agentic-dev` at `b6205bb`, MIT, © 2025 InterSystems Corporation. Treat it as untrusted data, read-only and never executed; implement stages never open it.
  - The notice `IRIS-MCP-THIRD-PARTY-NOTICES.md` holds:
    - the byte-exact MIT text (1081 bytes, `85b458dc…929c`);
    - credits to Tim Leavitt and Tom Dyar;
    - the non-endorsement sentence;
    - one provenance row: `skills/iris-mcp-objectscript-sql/SKILL.md` ← `skills/skills/objectscript-sql-patterns/SKILL.md`.
  - Nothing implies InterSystems' ownership or endorsement. The notice ships wherever adapted content ships: npm `files`, the plugin folder, and every installer write.
- **Client facts** (Claude Code docs, re-checked 2026-10-19):
  - Skills load from `.claude/skills/`, `~/.claude/skills/` and plugin `skills/`, never from `.agents/skills/`. Frontmatter is read only when `---` is line 1. A personal skill and a project skill with the same name shadow each other. `metadata` is a free-form map that Claude Code ignores.
  - A rule without `paths:` loads at launch, while a `paths:`-scoped copy never loaded. `.claude/rules/**/*.md` is discovered recursively.
  - `AGENTS.md` is read only when the project has no `CLAUDE.md`; otherwise, import it with `@AGENTS.md`.
  - Plugins cannot carry rules. A plugin always scans its default `skills/`.
- **Gate discipline.** Prove each gate red on the path it guards (#59). The capstone runs in the default suite (#21). Count tallies mechanically (#51). Review asks what is missing from each enumeration (#56). Vary byte-preservation fixtures (#58). Every test fake returns a shape the real API can return (#54).
- **ASCII source.** New `.mjs`/`.ts` code writes non-ASCII as unicode escapes. Tests build such strings with `String.fromCharCode`, because the edit tool decodes escapes. Write file content with the file tools, never a heredoc (#55).
- **Out of scope.** No benchmarking in this repo. Also out: the plugin (42.8), a compile-on-save hook, skills about MCP server internals, and the extension UI.

## Technical Decisions

- **AD-28, prompts and workflow skills.** MCP prompts are authored once, in `packages/*/src/prompts/`. The workflow skills are generated from them (`gen:skills`, which writes only `skills/`). A skill's description and preset come from the prompt's `skill` field, which never reaches the wire.
  - `scripts/lib/prompt-catalog.mjs` `loadAllPrompts` imports each `packages/<pkg>/dist/prompts/index.js` (ops, dev, interop, admin; data has no prompts). So `gen:skills` and `validate:prompts` need built dists.
  - An omitted `arguments` gets -32602 on the all-optional prompts (DW-617, owned by 43.1). 41.5's QA rows pin that refusal and cite DW-617.
- **AD-28, skill frontmatter.** Every pack `SKILL.md` opens with frontmatter on line 1, with no BOM.
  - It holds `name` and `description`, and optionally a `metadata` map whose one allowed key is `iris-tools-preset` (`core`, `developer` or `full`).
  - `name` equals its directory, matches `^[a-z0-9]+(-[a-z0-9]+)*$`, has at most 64 characters, and contains neither `claude` nor `anthropic`.
  - `description` is at most 1,024 characters, with no XML-like tag.
  - `check:provenance`'s `skill-frontmatter` rule enforces it through `readSkillFrontmatter(text, dirName)` (`scripts/lib/skills-pack.mjs:313`), which returns `{fields, metadata, problems}`. `skillFrontmatterProblems` (`:462`) is a view of it.
  - The grammar: a column-1 `metadata:` line, then two-space `key: value` lines. It refuses an unknown key, a bad value, `metadata: x`, an empty map, a tab or four-space indent, and a repeated key.
- **Conventions, "Pack names".** Hand-authored pack content carries the suite prefix (`iris-mcp-<name>`, `IRIS-MCP-THIRD-PARTY-NOTICES.md`), so an installed copy never collides with a user's own file. Generated workflow skills keep their unprefixed prompt names (AD-15). A same-named foreign skill directory is therefore possible on install.
- **Conventions, "Marked blocks" (41.2).** A block the suite owns inside a user file (an `AGENTS.md` section) sits between `<!-- IRIS-MCP-RULE:<name>:BEGIN -->` and `<!-- IRIS-MCP-RULE:<name>:END -->`, matched as exact whole lines. The block between them is owned and replaced whole; everything outside it is preserved byte for byte.
  - Lines that only look like a marker are not markers: another rule's name, an indent, trailing blanks, another case, or the text inside a sentence. Another rule's section is left alone.
  - `gen:pack` refuses a rule source line that starts `<!-- IRIS-MCP-RULE:`, so a generated section never holds a third marker line.
- **AD-28, one pack.** The pack is the committed, generated, DO-NOT-EDIT `packages/client-config/skills-pack/`. Only `pnpm gen:pack` writes it, and `gen:pack:check` fails on any MISSING, DRIFT or STRAY file. `gen:pack` needs no build. It reads the generated `skills/` and the sources in `skills-pack-src/` (`knowledge/<name>/SKILL.md`, `rules/<name>.md`, the notice, and a contributor `README.md` that is not copied).
  - **Shape** (22 files):
    - `skills/<name>/SKILL.md` for the 18 skills;
    - `rules/claude-code/iris-mcp-objectscript-pre-write.md`, the source bytes with no `paths:`;
    - `rules/agents-md/iris-mcp-objectscript-pre-write.md`, 36 lines: BEGIN on line 1, END on the last line, each LF-terminated (`renderAgentsMdSection`, `agentsMdMarkers` at `skills-pack.mjs:124-148`);
    - the notice and the catalog `README.md` at the root.

    Extra client forms would go in as `rules/<client>/`.
  - **Consumers.** The pack ships through client-config's `files` (`["dist", "!dist/**/__tests__", "skills-pack"]`), so it sits at the package root beside `dist/`, with no lifecycle hook. The installer reads it from its own package. The plugin (42.8) roots at it and ignores `rules/`; a plugin at the repository root would load the skills twice.
  - **Duplicates.** When the installer's Claude Code route detects the plugin, it installs the rules only, so the skills are not installed twice. No plugin manifest exists yet (42.8), and neither does a repository `AGENTS.md`.
- **`scripts/lib/skills-pack.mjs`.** It must keep exactly its three imports (`node:fs`, `node:path`, `./generated-tree.mjs`), because the gen-pack CLI fixture copies only three script files.
  - **Constants:** `PACK_DIR`, `WORKFLOW_SKILLS_DIR`, `NOTICE_FILENAME`, `PACK_README_FILENAME`, `RULE_FORM_DIRS`, `RULE_SOURCE_NAME`, `ALWAYS_ON_RULE_FILENAME`, `SKILL_FILENAME`, `SKILL_NAME`, `SKILL_FRONTMATTER_FIELDS` (still `['name','description']`), `SKILL_OPTIONAL_FRONTMATTER_FIELDS` (`['metadata']`), `SKILL_METADATA_KEYS`, `SKILL_PRESET_KEY` and `SKILL_PRESETS` (`['core','developer','full']`, cross-checked against shared's `TOOL_PRESET_NAMES`).
  - **Functions:** `renderPackReadme(contents)` (`:211`), `assemblePack(root)` (`:533`) and `listAgentContentFiles(root)` (`:661`), which is the one agent-content enumeration (`.md` only). The pack README and `skills/README.md` are not agent files. The `rule:` packRel `rules/<f>` is stale (DW-614, accepted).
- **Validator.** `scripts/lib/validate-prompts-core.mjs` holds `extractIrisTokens`, `renderPromptText`, `validateSources`, `promptSourceText`, `declaredToolPreset`, `INTERNAL_REFERENCE_CLASSES`, `internalReferenceProblems` and `presetProblems`. The preset catalog comes from `scripts/lib/tool-catalog.mjs` `loadToolPresetCatalog` (each server's `dist/tools/presets.js`).
- **Presets** (AD-7). Each `packages/<pkg>/src/tools/presets.ts` exports `toolPresets: { core, developer }`, each `{ include, exclude }`.
  - Include counts, core / developer: dev 14 / 32, admin 12 / 10, interop 11 / 24, ops 9 / 9, data 7 / 7.
  - `iris_server_profiles` is always visible, and `full` shows every tool.
  - Hiding is ergonomics, never write-gating.
- **Adapted content.** Any agent file matching `/iris-agentic-dev/i` needs `ADAPTATION_HEADER` (`provenance-core.mjs:38`) as its first non-blank line after the frontmatter (`hasValidAdaptationHeader`, `:176`), and a row under `PROVENANCE_HEADER_ROW` (`parseProvenanceRows`, `:138`).
  - The `checkProvenance` rules are `notice`, `mit-block`, `provenance-table`, `notice-sync`, `excluded-source`, `row-file`, `skill-frontmatter`, `header`, `claim-row` and `distribution`.
  - `gatherProvenanceInputs` (`scripts/lib/provenance-inputs.mjs:144`) packs the 8 non-private packages (`npm pack --dry-run`; `PACK_SHIPPING_PACKAGES = ['@iris-mcp/client-config']`). 41.6 appends its installer payload here.
- **Checks today** (derive any new number from the CLI, #51):
  - `gen:pack:check`: `22 pack file(s)`;
  - `gen:skills:check`: `13 generated file(s)`;
  - `validate:prompts` line 1: `51 source(s) checked (12 prompt(s) + 39 content file(s): 12 workflow, 20 pack, 6 knowledge, 1 rule), 111 known tool name(s)`;
  - `validate:prompts` line 2: `tool presets: 24 file(s) declare one (12 core, 6 developer, 6 full) and 15 tool-free file(s) declare none; no internal reference in 51 source(s), 2 adaptation header line(s) exempted`;
  - `check:provenance`: `1 provenance row(s), 39 agent file(s), 8 distribution(s)`.
- **AD-30 (installer writes).**
  - **Write protocol:** validate → timestamped backup → edit → re-parse → auto-restore on failure, with the diff preview shown before confirmation.
  - **Ownership:** only owned files and marked blocks are written, and foreign bytes are preserved, proven on varied fixtures.
  - **Manifest (41.6):** a per-target manifest of the installed paths and content hashes. An update removes owned paths that are gone from the new pack. A file whose hash no longer matches is never overwritten without confirmation.
  - **Re-install and uninstall:** re-install is idempotent, uninstall removes only owned content, and third-party content is never logged.
- **`client-config` as it stands** (`packages/client-config/src/`; 41.6 builds on it).
  - **CLI.** The bin `iris-mcp-clients` is `dist/cli/clients-cli.js`, a thin wrapper over `runCli(argv, deps)` in `src/cli/clients.ts`.
    - Commands: a `switch` at `:1787-1810` (`detect`, `status`, `diff`, `apply`, `enable`, `disable`, `remove`, `restore`, `doctor`), help text in `buildHelpText` (`:441`), and a `<CMD>_USAGE` constant per command.
    - Exit codes: 0 success, 1 operational failure, 2 usage error.
    - `--json` answers with one envelope, `{ok, command, data, error?}` (`emitJson`).
    - `apply` prints the diff first, then needs `--yes` or a TTY confirmation; non-TTY without `--yes` is exit 2 and writes nothing.
    - **Pins:**
      - `clients-cli.test.ts:119` and `clients-cli-process.test.ts:309` pin the valid-commands string `detect, status, diff, apply, enable, disable, remove, restore, doctor` with `toContain`;
      - `clients-cli.test.ts:158-205` pins `VALUED_OPTIONS` single-sourcing, and that the CLI files import no parser and hold no edit logic, so installer logic belongs in a package module.
  - **Adapters.** `src/adapters.ts` holds the 13 `CLIENT_ADAPTERS` and the 3 `CLIENT_DISPOSITIONS`.
    - A `ClientAdapter` (`types.ts:99`) has `id`, `displayName`, `format` (`json|jsonc|toml|yaml`), `rootKey`, `scopes` (user/project path templates per OS), `detection` and `docsUrl`, and nothing about skills or rules.
    - A `ClientDisposition` has `id`, `displayName`, `disposition` (`excluded-not-mcp-capable|roadmap`) and `reason`.
    - `ADAPTER_DATA_VERSION` is `2026-07-28.1`; bump its serial whenever an adapter record changes.
    - Precedent for a generated, exhaustive-by-construction table: `scripts/render-certification-table.mjs`, which joins `CLIENT_ADAPTERS` with `certification-results.json`, refuses a missing record, writes `<!-- ADAPTER-TABLE:BEGIN/END -->` sections, and has a `--check` mode.
  - **Engine.** `src/engine.ts` (`apply`/`enable`/`disable`/`remove`/`restore`) runs: resolve → read → ownership check before any backup → `diff()` renders a `NativeEdit` → `executeNativeEdit` → `applyWrite` → `state.json`.
    - An entry is owned when its name is canonical (exact match) or when the `state.json` ledger records it.
    - Results name paths and reasons, never content. Everything is injectable (`fs`, clock, `stateDir`), and nothing reads `process.*`.
  - **Writes.** `src/write.ts` `applyWrite(path, content|null, newContent, options)` is the six-point protocol.
    - Backups go to `<stateDir>/backups/<client>/<scope>/<basename>.<ts>`, with a `-N` disambiguator.
    - Its pre-parse and re-parse call `readConfigEntries(adapter, …)`, so it only understands JSON, JSONC, TOML and YAML. Markdown, rule and skill files need a variant of the protocol.
    - `WriteFs`/`REAL_WRITE_FS` read and write **utf8 strings**, so a byte-exact copy, or a user file with invalid UTF-8, needs a Buffer path.
    - `restoreBackup`/`listBackups` exist.
  - **State.** `src/state.ts` keeps `<stateDir>/state.json` = `{version: 1, entries, stashes}`. The default `stateDir` is `~/.iris-mcp/client-manager`. `readState` refuses a wrong shape and returns only `entries` and `stashes`, so a manifest added to `state.json` without changing `ManagerState`/`readState` would be dropped on the next engine write.
  - **Other modules.** `src/readers.ts` strips a leading BOM before parsing (`:460`, `:539`); the write path has no BOM handling. `src/paths.ts` resolves templates against an injected `{platform, env, homeDir, projectDir}`, through `path.win32`/`path.posix`.
  - **Tests to follow** (`packages/client-config/src/__tests__/`):
    - `byte-preservation.test.ts`: non-canonical fixtures (compact single-line, 4-space, CRLF) with byte-level oracles;
    - `golden.test.ts`: captured goldens per lifecycle stage, with a remove-equals-initial round-trip;
    - `qa-33-5-unit.test.ts`/`qa-33-5-process.test.ts`: comment-only documents, comments inside owned spans, multiline TOML strings;
    - `engine-e2e.test.ts`: the built dist on real temporary HOMEs, CRLF, unicode, EACCES, corrupted `state.json`;
    - `clients-cli-process.test.ts`: the built bin as a child process against a sandbox HOME, the exit-code matrix, the `--json` envelope;
    - `helpers.ts` (fixtures).
- **Test helpers in `iris-mcp-all`.**
  - `pack-fixture.ts`: `REPO_ROOT`, `makeTempRoot`, `put`, `runNode`, `committedRowFiles`.
  - `story-41-1-qa-fixture.ts`: `makeScratchRepo` (with `serverPackages`), `runScript`, `problemRules`, `problemPairs`, `toCrlf`, `BOM`, `treeLines`.
  - `story-41-5-qa-fixture.ts`: `declaredPreset`, `frontmatterLines`, `agentContentFiles`.
  - `agent-text-hygiene.ts`: `FORBIDDEN`, `problemsOf`, `wordCount`.
  - CLI cases run on a scratch copy, never the real tree. 41.5's scratch files fingerprint the real trees in `beforeAll`/`afterAll`.
  - `packages/iris-mcp-all/vitest.config.ts` sets `fileParallelism: false`.
- **Seams (#52).** Later stories extend `assemblePack`, `gatherProvenanceInputs` and the frontmatter grammar; they never re-touch `lib/generated-tree.mjs` or the pinned oracles.
- **AD-15.** An additive field is non-breaking. A change to an existing prompt's name, arguments, description or output needs a recorded decision.
- **AD-14.** A generated file changes only through its generator (`skills/`, `skills/README.md`, the pack). Never touch the installer-managed `.claude/skills/bmad-*` files.
- **AD-29.** Changesets stay `patch` or `minor`; 41.1–41.5 used `minor` for `@iris-mcp/client-config`. No story runs `changeset version` or publishes. Each story adds a top `CHANGELOG.md` section, `## [Pre-release — YYYY-MM-DD] — Story 41.N: <title>`, with Added, Changed, Tests and Known limits, plus a paragraph on the counts that did not move.
- **AD-2.** Pack checks live in `scripts/lib/`; each CLI and its `iris-mcp-all` test share one core. `client-config` never depends on a server package, and `iris-mcp-all` does not depend on `client-config`.
- **Counts that must not move.**
  - Tools: 110 package, 115 advertised.

    | Server | Package tools | `core` (package / runtime) |
    | --- | --- | --- |
    | dev | 32 | 14 / 15 |
    | admin | 26 | 12 / 13 |
    | interop | 24 | 11 / 12 |
    | ops | 21 | 9 / 10 |
    | data | 7 | 7 / 8 |

  - The 12 prompts are byte-identical on the wire.
  - The governance baseline is `1e62c5ad5bf7`/141, and `BOOTSTRAP_VERSION` is `5296a1c836f4`.
- **Running checks.**
  - `gen:skills`, `validate:prompts` and `check:provenance` need built dists of shared, the five servers and client-config. A client-config `src/` change needs `pnpm --filter @iris-mcp/client-config build` before its process tests.
  - Run pack tests standalone: `pnpm --filter @iris-mcp/all exec vitest run <files>`. The full `@iris-mcp/all` suite runs in three foreground calls (`ls src/__tests__/*.test.ts | awk 'NR%3==k'`).
  - Turbo does not order those tests after client-config's build, and its cache omits the pack inputs (DW-611, owned by 41.7).

## UX & Interaction Patterns

- **Installer flow.** Preview a dry-run diff before any write, then confirm the way `apply` does (`--yes` or a TTY prompt). Re-install is idempotent, and update and uninstall touch only owned files. A successful run reports what it installed and any follow-up the user must do.
- **Claude Code with a `CLAUDE.md`.** Use `.claude/rules/`, and tell the user to import `AGENTS.md` (`@AGENTS.md`) rather than assume it is read.
- **Client routes**, at minimum:
  - Claude Code → `.claude/skills/<name>/` and `.claude/rules/`, copying only the `claude-code` rule form;
  - VS Code / Copilot → `.github/instructions/*.instructions.md` with `applyTo:`;
  - Cursor → `.cursor/rules/`;
  - other agents → `.agents/skills/` and the `agents-md` block in `AGENTS.md`.
- **Catalog.** The pack README lists every knowledge skill, every workflow skill and the rule, each with what it is for and any declared preset.

## Cross-Story Dependencies

- **41.1–41.5 (done)** delivered:
  - the pack, `gen:pack`, the notice and the provenance check;
  - the rule's two forms and markers, and the prompt retirement;
  - six knowledge skills and the first provenance row;
  - the `skill` field, regenerated workflow skills with `metadata` presets, the catalog, and the preset and internal-reference checks.
- **41.6** reads `skills-pack/` from its own package and installs `skills/<name>/` (all 18, with the `metadata` block intact) as owned, hashed files. It writes the notice beside the adapted skill, covers all 16 adapter rows, and appends the installer payload to `gatherProvenanceInputs`.
  - It owns DW-616 and points the 41.2 consumer rows at the real reader.
  - It may move the `check:provenance` distribution count and CLI pins; re-derive them from CLI output.
- **41.7** writes the root README pack section and the client-config README installer docs. The generated catalog supersedes `skills/README.md`.
  - Its capstone drives the installer CLI against a temporary project for every route. It asserts the exact paths, valid frontmatter (`metadata` included), the notice, idempotent re-install, and an uninstall that leaves foreign content intact. It is proven red.
  - It runs the one-time live Claude Code check (41.2's procedure is reusable).
  - It owns DW-611: test ordering, and turbo inputs covering `skills-pack-src/`, `skills/`, `scripts/`, client-config's `package.json`, `skills-pack/**` and `dist/`.
  - It owns DW-624: the root README pack section and the catalog must say the presets are not nested. A declared preset is the first of core/developer/full that shows every named tool, and a later preset can hide one: `provision-project-environment` declares `core`, but admin's `developer` hides `iris_user_manage`.
- **Downstream:**
  - 42.6 owns the publish-path gate (DW-612);
  - 42.8 roots the plugin at the pack, ignores `rules/`, and adds the plugin distribution to `check:provenance`;
  - 43.1 owns DW-617 and inverts 41.5's omitted-`arguments` rows;
  - DW-622 (`SanitizeError` strips only English and Arabic prefixes) goes to an Epic 41 burn-down if one is chartered.
