# Epic 41 Context: Companion Skills & Rules Pack

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Agents that write ObjectScript get the project's hard-won rules in three forms: one short, always-on pre-write checklist; 6–10 knowledge skills that the model loads when it needs them; and the workflow skills generated from the suite's MCP prompts. All three ship as one generated pack, `packages/client-config/skills-pack/`, and an installer in `@iris-mcp/client-config` puts it into each MCP client's native location. The competitor's MIT notice ships wherever adapted content ships. The pack is our own equivalent of the competitor's kit (intersystems-community/iris-agentic-dev), not a copy. Agents choose skills by their description, and MCP prompts are slash commands only a user can invoke, so shipping the content as skills is what lets agents actually find it. This is the only epic on `feature/feature-wave-7-skills-pack`. Story 42.8's Claude Code plugin consumes the same pack later.

## Stories

- Story 41.1: Pack Layout, Licensing and Provenance (done)
- Story 41.2: Always-On ObjectScript Pre-Write Rule (done)
- Story 41.3: Core Knowledge Skills
- Story 41.4: Platform Knowledge Skills
- Story 41.5: Workflow Skills Refresh
- Story 41.6: Skills and Rules Installer
- Story 41.7: Skills Pack Docs and Capstone

## Requirements & Constraints

- **Precedence.** The spine binds every story. Where a story and the spine disagree, the spine wins and the story text is amended in place.
  - The run is unattended. The orchestrator decides escalations and records them in `_bmad-output/implementation-artifacts/orchestrator-decisions-wave-7.md`, which holds #1–#6: pack layout, notice filename, routing the two pack-wide checks to 41.5, retiring `objectscript-review`, the rule's two forms and markers, and running 41.2's live Claude Code check.
  - The live session check of AC 41.2.5 passed. AC 41.7.3's is still open (flagged by sprint planning).
- **Content.**
  - The core is written from `.claude/rules/` and the epic retros. Competitor content is adapted only where it is clearly the better start, for example the list and SQL pattern skills.
  - 41.3 covers ObjectScript gotchas, `%Status` and error handling, and `%UnitTest`. 41.4 covers embedded SQL, IRIS system-class discipline and interoperability patterns. The total is 6–10 knowledge skills, counted mechanically.
  - Each knowledge `SKILL.md` has `name` and a model-invocation `description` that says when to load it.
  - The pre-write checklist text lives only in the rule source. No skill, prompt or doc holds a second copy, so knowledge skills go deeper than the checklist instead of restating it.
  - **Known-wrong source claims.** 41.2's probes found errors in the rule files the skills are written from. These are recorded as DW-615 (decision-pending; the user decides, and no story edits `.claude/rules/*`). Do not carry them into skills:
    - a typed MultiDimensional property compiles;
    - `%OnNew` `Private` is refused (`#5477`) only when the parent's `%OnNew` is public, as in `%UnitTest.TestCase`;
    - `$$$AssertNotTrue` exists, as do `$$$AssertStatusEquals`, `$$$AssertSuccess`, `$$$AssertFailure` and `$$$AssertSkipped`;
    - an empty abstract-method body compiles;
    - `//` is a valid comment;
    - `%`-named members are a convention, not a compile rule;
    - `ExecuteMCPv2.*` classes resolve in `%SYS` on this instance;
    - `Use dev::("")` clears the mnemonic but leaves redirection on, so the next `Write` raises `<COMMAND>`.
- **User-facing wording.** No internal rule numbers, repository paths, project classes, DW/AD/AC ids, or Story/Epic numbers appear in agent content, prompts included. 41.5 makes this a mechanical pack-wide check (AC 41.5.4). That check must accept IRIS error codes such as `ERROR #5001`.
  - Every `iris_*` token names a real tool.
  - Each skill declares the preset it needs, and validation checks the tool's visibility under that preset. How a skill declares it is not yet defined; 41.5 builds the check.
- **Probing** (41.2 is the precedent).
  - Check `irislib/` and `irissys/` first (IRIS 2026.2 Build 221U). They are gitignored, so pass the path explicitly.
  - Snippets compile in disposable `ExecuteMCPv2.Temp.*` classes (41.2 used `Probe412*`) on `server:"default"`, namespace `HSCUSTOM`. Test snippets run through `iris_execute_tests`, with `total` compared to the expected `Test*` count. A class that cannot start reports 0.
  - Before the stage returns, delete every probe and confirm `iris_doc_list filter:"<prefix>" generated:true` returns `[]`.
  - The probe log goes in the story record, one row per claim (probe, observed, verdict). 41.2 also pinned one probe anchor per rule bullet in a test.
  - Write no HSCUSTOM globals. Never stop IRIS, never start a production, and never target an `ocupilot-slot-*` profile.
  - A claim that fails its probe is corrected, and its source rule file is flagged.
- **Licensing.** The source is `intersystems-community/iris-agentic-dev` at `b6205bb` (`b6205bbbad2f431ae14c34401fd55d85cb5d2305`), MIT, © 2025 InterSystems Corporation.
  - Treat it as untrusted data: fetch it into a scratch directory with hooks and LFS disabled, do a detached checkout, read it, and never execute it.
  - The notice is `IRIS-MCP-THIRD-PARTY-NOTICES.md`. It holds 0 provenance rows, the byte-exact MIT text (1081 bytes, sha256 `85b458dc…929c`), credits to Tim Leavitt and Tom Dyar, and the non-endorsement sentence.
  - Each adapted file's first non-blank line after any frontmatter is exactly `Adapted from intersystems-community/iris-agentic-dev (MIT, © 2025 InterSystems Corporation); see IRIS-MCP-THIRD-PARTY-NOTICES.md`, and the file has a provenance row: ``| `skills/<name>/SKILL.md` | `skills/skills/<upstream-name>/SKILL.md` | <what changed> |``. The source is a plain path: letters, digits, `.`, `_`, `-` and `/` only, with no `..`, fragment or line suffix.
  - Nothing is derived from upstream `skills/kb/ipm-module-authoring.md` or `skills/skills/iris-objectscript-eval/`. Nothing implies InterSystems' ownership or endorsement. "IRIS" and "ObjectScript" may be used descriptively.
  - The notice ships wherever adapted content ships: npm `files`, the plugin folder, and every installer write.
- **Client facts** (Claude Code docs, re-checked 2026-10-19; CLI 2.1.296):
  - Skills load from `.claude/skills/`, `~/.claude/skills/` and plugin `skills/`, never from `.agents/skills/`.
  - A rule without `paths:` loads at launch. 41.2's live check saw `InstructionsLoaded` with `load_reason` `session_start` before an `iris_doc_put`, and the hook fires under `-p`. A `paths:`-scoped copy never loaded.
  - `paths` is the only rule frontmatter field. `.claude/rules/**/*.md` is discovered recursively.
  - `AGENTS.md` is read only when the project has no `CLAUDE.md`, and then `InstructionsLoaded` does not fire for it. Otherwise it is imported with `@AGENTS.md`.
  - Plugins cannot carry rules. A plugin always scans its default `skills/`, and every component path resolves inside the plugin root.
- **Gate discipline.** Prove each gate red on the path it guards (#59). The capstone runs in the default suite (#21). Count tallies mechanically (#51). Review asks what is missing from each enumeration (#56). Vary byte-preservation fixtures: CRLF, BOM, invalid UTF-8, no final LF (#58).
- **ASCII source.** In `.mjs`/`.ts`, write each non-ASCII character as a unicode escape (hex `00a9` for the copyright sign). The edit tool decodes such escapes into the literal character, so tests build those strings with `String.fromCharCode`.
- **Out of scope.** No benchmarking in this repo. Also out: the plugin (42.8), a compile-on-save hook, skills about MCP server internals, and the extension UI.

## Technical Decisions

- **AD-28, prompts.** MCP prompts are authored once, in `packages/*/src/prompts/`, and the workflow skills are generated from them.
  - A skill's model-invocation description is a separate field on the prompt definition. Only `gen:skills` reads it, and a pin proves it never reaches `prompts/list`.
  - `PromptDefinition` (`packages/shared/src/tool-types.ts`) has no such field yet. It has `name`, `title`, `description`, `arguments` and `build`.
- **AD-28, one pack.** The pack is the committed, generated, DO-NOT-EDIT `packages/client-config/skills-pack/`.
  - Only `pnpm gen:pack` writes it. `pnpm gen:pack:check` fails on any MISSING, DRIFT or STRAY file.
  - **Sources** live in `skills-pack-src/`:
    - `knowledge/<name>/` holds one directory per skill, with an exact-case `SKILL.md`; any extra file in it ships too;
    - `rules/<name>.md` holds one flat file per rule, with no frontmatter. Today that is `iris-mcp-objectscript-pre-write.md`: 299 words by the suite's counter, 2,120 bytes, ASCII, 16 bullets, no `iris_*` token, so no preset;
    - the notice sits at the root;
    - the root `README.md` is a contributor doc and is not copied.

    `gen:pack` copies sources byte for byte, needs no build, and renders only the pack README and each rule's `AGENTS.md` form. The workflow skills stay `gen:skills` output in `skills/`.
  - **Shape** (a standard plugin root):
    - `skills/<name>/…` for workflow and knowledge skills alike;
    - `rules/claude-code/<name>.md` holds the source bytes;
    - `rules/agents-md/<name>.md` holds `<!-- IRIS-MCP-RULE:<name>:BEGIN -->\n`, then the source bytes, then a `\n` if the source lacks a final LF, then `<!-- IRIS-MCP-RULE:<name>:END -->\n`;
    - the notice and a generated `README.md` sit at the root.
  - **`gen:pack` refuses** (exit 1, nothing written):
    - an unknown top-level entry;
    - a `knowledge/<n>/` without `SKILL.md`;
    - a non-directory entry in `knowledge/`;
    - a knowledge name that is also a workflow skill;
    - a `rules/` entry that is not a flat `^[a-z0-9]+(-[a-z0-9]+)*\.md$` file;
    - a rule that opens with frontmatter;
    - a rule with a line starting `<!-- IRIS-MCP-RULE:`.

    Dotfiles are not skipped. On macOS, a Finder `.DS_Store` fails the build (DW-619, by design: delete it), and one inside a skill directory would ship.
  - **Marked blocks** (a conventions row): an owned block in a user file sits between the exact whole-line markers. It is replaced whole, and everything outside it is preserved byte for byte.
  - **Consumers.** The pack ships through client-config's `files` (`["dist", "!dist/**/__tests__", "skills-pack"]`) with no lifecycle hook. The installer reads it from its own package, and the plugin roots at it. A repo-root plugin would load the skills twice. The rule is unscoped, and the installer's Claude Code route installs rules only when it detects the plugin.
- **Pack scripts** (`scripts/`; each CLI and its `iris-mcp-all` test share one core, AD-2):
  - `lib/generated-tree.mjs`: `listFilesRecursive`, `diffTree` and `writeTree`.
  - `lib/skills-pack.mjs`: the path constants (`KNOWLEDGE_SOURCE_DIR`, `RULES_SOURCE_DIR`, `PACK_DIR`, `WORKFLOW_SKILLS_DIR`, `NOTICE_FILENAME`), plus `RULE_FORM_DIRS`, `RULE_SOURCE_NAME`, `ALWAYS_ON_RULE_FILENAME`, `agentsMdMarkers`, `renderAgentsMdSection`, `renderPackReadme`, `assemblePack` and `listAgentContentFiles`.
    - `listAgentContentFiles` is the one agent-content enumeration (`.md` only). Its labels are `workflow:`, `pack:`, `knowledge:<n>/<f>` (packRel `skills/<n>/<f>`) and `rule:`.
    - The `rule:` packRel is still `rules/<f>`, which is stale. DW-614 accepts this, to reopen if a rule is ever adapted.
  - `lib/provenance-core.mjs` is pure. It holds the pinned oracles and `checkProvenance()`.
    - `hasValidAdaptationHeader` skips a leading `---…---` block, then wants the header as the first non-blank line. A header placed above the frontmatter therefore also passes, and the skill loses `name` and `description`. DW-613 (owned by 41.3) adds a default-suite check, proven red, that every pack `SKILL.md` opens with frontmatter holding both, with any header after it.
  - `lib/provenance-inputs.mjs` runs `npm pack --dry-run --json --ignore-scripts --offline` on the 8 non-private packages and fails closed. Any tarball holding pack or adapted content must carry a byte-equal notice.
  - **Checks today:**
    - `gen:pack:check`: `16 pack file(s)`.
    - `gen:skills:check`: `13 generated file(s)`.
    - `validate:prompts`: `39 source(s) checked (12 prompt(s) + 27 content file(s): 12 workflow, 14 pack, 0 knowledge, 1 rule), 111 known tool name(s)`.
    - `check:provenance`: `0 provenance row(s), 27 agent file(s), 8 distribution(s)`.
- **Pins that move as the pack grows.** Each knowledge `SKILL.md` adds one `knowledge:` and one `pack:` source, and one pack file:
  - the validator line in `story-41-1-qa-validate-prompts-pack.test.ts:52`;
  - `16 pack file(s)` in `story-41-1-qa-pack-scratch-cli.test.ts:151`;
  - `27 agent file(s)` in `story-41-1-qa-provenance-cli.test.ts:99`.

  The workflow-count pins (12) read root `skills/` only. The prompt-count pins are 12, with dev at 4: `validate-prompts.test.ts`, `docs-prompt-sync.test.ts` (which also checks the README's "110 tools"), `skills-generated-frontmatter.test.ts` and `story-41-2-qa-prompts-stdio-wire.test.ts`.
- **Test helpers.** Pack fixtures use `pack-fixture.ts` (`makeTempRoot`, `put`, `runNode`). CLI cases use `story-41-1-qa-fixture.ts` (`makeScratchRepo`, `runScript`, `toCrlf`, `BOM`) on a scratch copy, so the real tree is never written.
  - 41.2's rule tests are `skills-pack-rule.test.ts`, `story-41-2-qa-rule-text-hygiene.test.ts` (13 forbidden-wording classes, the rule only) and `story-41-2-qa-agents-md-consumer.test.ts` (a test-local marker reader).
- **Seams (#52).** Later stories extend `assemblePack` with new source kinds and `gatherProvenanceInputs` with new distributions. They never re-touch the tree-sync helper or the pinned oracles.
- **AD-15.** The `objectscript-review` retirement is done (Story 41.2, decision #4, in `CHANGELOG.md` `### Removed`). Any other change to an existing prompt's name, arguments or output needs a recorded decision.
- **AD-14.** A generated file changes only through its generator: `skills/`, the pack, and `skills/README.md` (a 12-row table). The installer-managed `.claude/skills/bmad-*` files are never touched.
- **AD-29.** Changesets stay `patch` or `minor`; 41.1 and 41.2 used `minor`. No story runs `changeset version` or publishes.
- **AD-2.** The pack build and its checks live in `scripts/` or `packages/iris-mcp-all`, and read the built dist. `client-config` never depends on a server package, and `iris-mcp-all` does not depend on `client-config`.
- **AD-30 (installer writes).**
  - **Protocol:** validate → timestamped backup → edit → re-parse → auto-restore on failure, with the diff preview shown before confirmation.
  - **Ownership:** only owned files and marked blocks are written. Foreign bytes are preserved, proven on CRLF, BOM, comment, no-final-newline and foreign-block fixtures.
  - **Manifest:** a per-target manifest of paths and hashes. An update removes owned paths absent from the new pack, and a file whose hash changed is never overwritten without confirmation.
  - **Re-install and uninstall:** re-install is idempotent, uninstall removes only owned content, and third-party content is never logged.
- **Prompts today** (12):
  - dev: `diagnose-slow-query`, `deploy-and-test-class`, `promote-environment-change` and `edit-and-test-class`;
  - admin: `provision-project-environment` and `audit-security-posture`;
  - interop: `trace-message-flow`, `recover-stuck-production`, `resend-failed-messages` and `find-patient-messages`;
  - ops: `check-system-health` and `run-external-backup`;
  - data: none.

  No shipped prompt declares zero arguments. An omitted `arguments` gets -32602 on the all-optional prompts (DW-617, owned by 43.1).
- **`gen:skills`** writes each `SKILL.md` with frontmatter: a `# DO NOT EDIT` comment naming `packages/<pkg>/src/prompts/*.ts`, then `name`, `description` and the `build({})` body. AC 41.5.4 must move that comment out of agent-visible text.
- **Missing today:** an `AGENTS.md`, a plugin manifest, and `skills-pack-src/knowledge/`. The root `LICENSE` is MIT, © 2026 jbrandtmse.
- **`client-config` as it stands.**
  - **CLI.** The bin is `iris-mcp-clients`, with commands `detect`, `status`, `diff`, `apply`, `enable`, `disable`, `remove`, `restore` and `doctor`.
    - Exit codes: 0 success, 1 operational failure, 2 usage error.
    - With `--json` a command answers with one envelope, `{ok, command, data, error?}`.
    - `apply` needs `--yes` or a TTY confirmation, else it exits 2.
  - **Adapters.** `adapters.ts` has 13 `CLIENT_ADAPTERS` and 3 `CLIENT_DISPOSITIONS` (`pi` excluded; `jetbrains-junie` and `kilo-code` on the roadmap): AC 41.6.1's "16 adapters". The data stamp is `ADAPTER_DATA_VERSION` `2026-07-28.1`.
  - **Engine.** `engine.ts` owns an entry by canonical name or by the `state.json` ledger.
  - **Writes.** `write.ts` `applyWrite` takes a `ClientAdapter` and re-parses as JSON, JSONC, TOML or YAML. Markdown and rule files need a variant of the protocol, not a reimplementation.
    - Backups go to `<stateDir>/backups/<client>/<scope>/<file>.<ts>`.
    - `readers.ts` strips a BOM before it parses, but the write path has no BOM handling.
  - **Marker precedent.** `render-certification-table.mjs` writes the `<!-- ADAPTER-TABLE:BEGIN/END -->` block.
- **Counts that must not move** (built dist): tools 110 package / 115 advertised (each server adds `iris_server_profiles`). Every package has the `core` and `developer` presets.

  | Server | Package tools | `core` (package / runtime) |
  | --- | --- | --- |
  | dev | 32 | 14 / 15 |
  | admin | 26 | 12 / 13 |
  | interop | 24 | 11 / 12 |
  | ops | 21 | 9 / 10 |
  | data | 7 | 7 / 8 |

  The governance baseline is `1e62c5ad5bf7`/141, and `BOOTSTRAP_VERSION` is `5296a1c836f4`.
- **Running checks.** `gen:skills`, `validate:prompts` and `check:provenance` need built dists of shared, the five servers and client-config. Provenance fails closed without client-config's `dist/`.
  - Run pack tests standalone: `pnpm --filter @iris-mcp/all exec vitest run <files>`.
  - The full `@iris-mcp/all` suite (about 111 files) runs in three foreground calls (`ls src/__tests__/*.test.ts | awk 'NR%3==k'`).
  - Turbo does not order those tests after client-config's build, and its cache omits the pack inputs (DW-611, owned by 41.7).

## UX & Interaction Patterns

- **Installer.** It previews a dry-run diff before any write and confirms like `apply` does. Re-install is idempotent, and update and uninstall touch only owned files.
- **Claude Code with a `CLAUDE.md`.** Use `.claude/rules/`, and tell the user to import `AGENTS.md` (`@AGENTS.md`) rather than assume it is read.
- **Client routes**, at minimum:
  - Claude Code → `.claude/skills/` and `.claude/rules/`, copying only the `claude-code` form;
  - VS Code / Copilot → `.github/instructions/*.instructions.md` with `applyTo:`;
  - Cursor → `.cursor/rules/`;
  - other agents → `.agents/skills/` and the `agents-md` block in `AGENTS.md`.

  Extra forms go in as `rules/<client>/`.
- **Skill descriptions** say when to load the skill. MCP prompt text keeps its user-facing role.

## Cross-Story Dependencies

- **41.1 and 41.2 (done)** delivered the layout, `gen:pack`, the notice, the provenance check, the extended validator, the rule's two forms and markers, and the prompt retirement. Every later story builds on these.
- **41.3 and 41.4** add `skills-pack-src/knowledge/<name>/SKILL.md` and provenance rows for adapted passages. Each must pass `gen:pack:check`, `check:provenance` (header after the frontmatter) and `validate:prompts`. 41.3 owns DW-613. The 6–10 total is counted after 41.4.
- **41.5** does three things:
  - it adds the description field and regenerates the 12 workflow skills;
  - it replaces the pack `README.md` (superseding `skills/README.md`) with a generated catalog of the knowledge skills, workflow skills and rule;
  - it adds AC 41.5.4's preset-visibility and no-internal-references checks over all agent content.
- **41.6** reads `skills-pack/`, covers all 16 adapter rows, and appends the installer payload to `gatherProvenanceInputs`. It owns DW-616, the `AGENTS.md` marker-reading contract:
  - report, never guess, a missing, repeated or out-of-order own marker;
  - decide whether a BOM belongs to line 1;
  - end an unterminated last line before appending;
  - point the 41.2 consumer test at the real reader.
- **41.7** writes the root README section and the client-config README docs. Its capstone drives the CLI against a temporary project for every route, plus a one-time live Claude Code check, for which 41.2's procedure is reusable. It owns DW-611: test ordering and turbo inputs covering the pack sources, `scripts/`, client-config's `package.json`, `skills-pack/**` and `dist/`.
- **Downstream:**
  - 42.6 owns the publish-path gate (DW-612: `prepublishOnly` runs neither `gen:pack:check` nor `check:provenance`);
  - 42.8 roots the plugin at the pack, ignores `rules/`, and adds the plugin distribution;
  - 43.1 owns DW-617.
