# Epic 41 Context: Companion Skills & Rules Pack

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Agents that write ObjectScript get the project's hard-won rules in three forms: one short, always-on pre-write checklist; 6–10 knowledge skills that the model loads when it needs them; and the workflow skills generated from the suite's MCP prompts. An installer in `@iris-mcp/client-config` puts the pack into each MCP client's native location. The competitor's MIT notice ships wherever adapted content ships. The pack is our own equivalent of the competitor's kit (intersystems-community/iris-agentic-dev), not a copy. Agents choose skills by their description, and MCP prompts are slash commands only a user can invoke, so shipping the content as skills is what lets agents actually find it. This is the only epic on `feature/feature-wave-7-skills-pack`. Story 42.8's Claude Code plugin consumes the pack later.

## Stories

- Story 41.1: Pack Layout, Licensing and Provenance
- Story 41.2: Always-On ObjectScript Pre-Write Rule
- Story 41.3: Core Knowledge Skills
- Story 41.4: Platform Knowledge Skills
- Story 41.5: Workflow Skills Refresh
- Story 41.6: Skills and Rules Installer
- Story 41.7: Skills Pack Docs and Capstone

## Requirements & Constraints

- **Precedence.** The spine binds every story. Where a story and the spine disagree, the spine wins and the story text is amended in place.
  - The run is unattended. The orchestrator decides escalations and records them in `_bmad-output/implementation-artifacts/orchestrator-decisions-wave-7.md`, which has no entries yet.
  - Sprint planning flagged the live Claude Code session checks (AC 41.2.5 and AC 41.7.3) as a warning for this run.
- **Content.**
  - The core is written from `.claude/rules/` and the epic retros. Competitor content is adapted only where it is clearly the better start, for example the list and SQL pattern skills.
  - 41.3 covers ObjectScript gotchas, `%Status` and error handling, and `%UnitTest`. 41.4 covers embedded SQL, IRIS system-class discipline and interoperability patterns.
  - The total number of knowledge skills is 6–10, counted mechanically.
- **User-facing wording.** No internal rule numbers, repository paths, DW or AD ids appear anywhere in agent content, prompts included, and this is checked mechanically across the whole pack.
  - Every `iris_*` token names a real tool.
  - Each skill declares the preset it needs, and validation checks the tool's visibility under that preset.
- **Probing.** Every factual claim is probed live, and the probe log goes in the story record.
  - Check `irislib/` and `irissys/` first.
  - Snippets compile in a disposable `ExecuteMCPv2.Temp.*` class. Test snippets run through `iris_execute_tests`, with the `total` compared against the expected count. Fixtures are deleted afterwards.
  - A claim that fails its probe is corrected, and its source rule file is flagged for the retro.
  - The shared instance is never stopped.
- **Licensing.** The source is `intersystems-community/iris-agentic-dev` at `b6205bb` (`b6205bbbad2f431ae14c34401fd55d85cb5d2305`), MIT, © 2025 InterSystems Corporation.
  - It is fetched into a scratch directory as untrusted data. It is read, never executed.
  - The notice holds four things: their full MIT text, byte-exact to their LICENSE; a provenance table mapping each derived file to its source file at that commit; credits to Tim Leavitt and Tom Dyar; and a statement that InterSystems does not endorse the pack.
  - Each derived `SKILL.md` carries the one-line adaptation header.
  - Nothing is derived from `kb/ipm-module-authoring.md` or `iris-objectscript-eval`.
  - Nothing presents the pack as InterSystems' or implies endorsement. "IRIS" and "ObjectScript" may be used descriptively.
  - The notice ships wherever adapted content ships: npm `files`, the plugin folder, and every installer write.
- **The notice filename conflicts between sources.** The epics and the decision record name `THIRD_PARTY_NOTICES.md`. The spine requires a suite-specific name (for example `IRIS-MCP-THIRD-PARTY-NOTICES.md`) at a location no client auto-loads. The spine wins: amend the story text, and make the header's "see …" text match the chosen name.
- **Client facts** (from the Claude Code docs, 2026-10-14):
  - Claude Code loads skills from `.claude/skills/`, `~/.claude/skills/` and plugin `skills/`, never from `.agents/skills/`.
  - It reads `AGENTS.md` natively only when the project has no `CLAUDE.md`. Otherwise the file is imported with `@AGENTS.md`.
  - `.claude/rules/*.md` loads automatically, and plugins cannot carry rules.
- **Gate discipline.**
  - Each gate is proven red on the path it guards (#59).
  - The capstone runs in the default suite (#21).
  - Tallies are counted mechanically (#51).
  - Review asks what is missing from each enumeration (#56).
  - Byte-preservation fixtures are deliberately varied (#58).
- **No benchmarking in this repo.** Also out of scope: the plugin (42.8), a compile-on-save hook, skills about MCP server internals, and the extension UI.

## Technical Decisions

- **AD-28 (agent content).**
  - **Prompts.** MCP prompts are authored once, in `packages/*/src/prompts/`, and the workflow skills are generated from them.
  - **Skill descriptions.** A skill's model-invocation description is a separate field on the prompt definition. Only `gen:skills` reads it, and a pin proves it never reaches `prompts/list`. `PromptDefinition` in `packages/shared/src/tool-types.ts` has no such field today: it has `name`, `title`, `description`, `arguments` and `build`.
  - **Single source.** Each knowledge skill and the rule have exactly one source.
  - **The rule is unscoped** (no `paths:`), per the 2026-10-15 amendment. A rule scoped by `paths:` never loads when an agent writes through `iris_doc_put` or `iris_doc_edit`.
  - **One pack.** 41.1 records one of two options:
    - a committed, generated, DO-NOT-EDIT directory with a `--check` drift test, at a path the plugin manifest names, which the client-config tarball copies;
    - a plugin sourced from the npm tarball.

    Either way, the installer and the plugin consume the same pack.
  - **Duplicates.** The Claude Code route installs rules only when it detects the plugin, so skills are not installed twice.
- **AD-29.** The pack ships inside `@iris-mcp/client-config` unless 41.1 records why not. Changesets stay `patch` or `minor`. No story runs `changeset version` or publishes.
- **AD-14.** A generated file changes only through its generator, so the workflow skills stay DO-NOT-EDIT. The installer-managed `.claude/skills/bmad-*` files are never touched.
- **AD-15.** Retiring the `objectscript-review` prompt is pre-sanctioned and is named in `CHANGELOG.md` with its story. Any other change to an existing prompt's name, arguments or output needs a recorded decision.
- **AD-2.** The pack build, the provenance check and the tool-name checks live in `packages/iris-mcp-all` or `scripts/`, and enumerate the built dist. A check's CLI script and its test share one implementation.
  - `client-config` never depends on a server package.
  - `iris-mcp-all` depends on the five servers but not on `client-config`.
- **AD-30 (installer writes).**
  - **Protocol.** Every write runs validate → timestamped backup → edit → re-parse → auto-restore on failure. The diff preview is shown before confirmation.
  - **Ownership.** Only owned files and marked blocks are written. Foreign content is preserved byte for byte, proven on fixtures with CRLF, a BOM, comments, no trailing newline, and an existing foreign block.
  - **Manifest.** The installer writes a per-target manifest of the paths and content hashes it installed.
    - An update removes owned paths that are absent from the new pack.
    - A file whose hash no longer matches is never overwritten without confirmation.
  - **Re-install and uninstall.** Re-install is idempotent. Uninstall removes only owned content, and third-party content is never logged.
- **Prompts today.** There are 13, read from each package's `src/prompts/index.ts`:
  - dev has 5: `diagnose-slow-query`, `objectscript-review`, `deploy-and-test-class`, `promote-environment-change` and `edit-and-test-class`;
  - admin has 2: `provision-project-environment` and `audit-security-posture`;
  - interop has 4: `trace-message-flow`, `recover-stuck-production`, `resend-failed-messages` and `find-patient-messages`;
  - ops has 2: `check-system-health` and `run-external-backup`;
  - data has none.

  AC 41.5.1's "11 plus the prompts of 38.6, 39.6 and 40.4" works out to these 13. Story 40.4 changed `deploy-and-test-class` and added no prompt.
- **The generator, `scripts/gen-skills.mjs`** (`pnpm gen:skills`; `--check` is `gen:skills:check`).
  - It renders `skills/<name>/SKILL.md`. The YAML frontmatter holds a `# DO NOT EDIT` comment that names `packages/<pkg>/src/prompts/*.ts`, then `name`, then `description` (taken from the prompt's description). The body is `build({})`.
  - It also renders `skills/README.md`, which has an HTML-comment DO-NOT-EDIT header and a 13-row table.
  - It owns all of `skills/`. `--check` fails on any non-generated file, and write mode deletes it. Hand-authored sources therefore cannot live under `skills/` without changing the generator.
  - Both `gen-skills.mjs` and `validate-prompts.mjs` need a prior build.
- **The validator, `scripts/validate-prompts.mjs`** (`pnpm validate:prompts`).
  - Its core is `scripts/lib/validate-prompts-core.mjs`, shared with `packages/iris-mcp-all/src/__tests__/validate-prompts.test.ts`.
  - It takes the `\biris_[a-z0-9_]+\b` tokens from each prompt's title, description and `build({})` body, and from `skills/*/SKILL.md`.
  - It checks only that each token names a tool. It does no preset check.
  - The tool catalog comes from `scripts/lib/tool-catalog.mjs`, which imports each server's built `dist/tools/index.js` and adds `iris_server_profiles`. That makes 111 names.
  - The prompt catalog comes from `scripts/lib/prompt-catalog.mjs`.
- **Pins that move when prompts or skills change.**
  - `skills-generated-frontmatter.test.ts` (it lists the 13 names);
  - `gen-skills-stray-file.test.ts`;
  - `docs-prompt-sync.test.ts` (per-server prompt counts, and the README's "110 tools" claim);
  - `prompt-safety-invariants.test.ts` (`objectscript-review` has no arguments and at most 300 words; some prompts are checked for internal references one by one);
  - each package's `prompts.test.ts`.

  No pack-wide internal-reference check exists yet. When one is added, it will hit two things: the repository path in the generated frontmatter comment, and the `SanitizeError` mention in `objectscript-review`.
- **The 41.2 overlap.** `objectscript-review` (`packages/iris-dev-mcp/src/prompts/objectscriptReview.ts`) is already a no-argument pre-write checklist, distilled from the same rule files. Its claims were never probe-verified.
- **Missing today.** There is no notice file anywhere in the repository, no `AGENTS.md`, and no plugin manifest. The root `LICENSE` is MIT, © 2026 jbrandtmse.
- **`client-config` as it stands.**
  - **Package.** It is `@iris-mcp/client-config` 0.0.1. Its npm `files` list contains only `dist`.
  - **CLI.** The bin is `iris-mcp-clients` (`src/cli/clients-cli.ts`, which runs `src/cli/clients.ts`). Its commands are `detect`, `status`, `diff`, `apply`, `enable`, `disable`, `remove`, `restore` and `doctor`.
    - Exit codes are 0 (success), 1 (operational failure) and 2 (usage error).
    - With `--json`, a command answers with one envelope: `{ok, command, data, error?}`.
    - `apply` prints the diff first, then needs `--yes` or a TTY confirmation. Without a TTY and without `--yes`, it exits 2.
  - **Adapters.** `adapters.ts` has 13 `CLIENT_ADAPTERS` and 3 `CLIENT_DISPOSITIONS`. The dispositions are `pi` (excluded: not MCP-capable) and `jetbrains-junie` and `kilo-code` (roadmap). Together these are the 16 rows that AC 41.6.1 calls "16 adapters". The data stamp is `ADAPTER_DATA_VERSION` `2026-07-28.1`.
  - **Ownership.** The engine (`engine.ts`) works on config entries. It owns an entry when the entry has a canonical server name or is listed in the `state.json` ledger (`state.ts`).
  - **Writes.** `write.ts` `applyWrite` runs the protocol, but it takes a `ClientAdapter` and re-parses in that adapter's config format (JSON, JSONC, TOML or YAML). Markdown and rule files need a variant of the protocol, not a reimplementation.
    - Backups go to `<stateDir>/backups/<client>/<scope>/<file>.<ts>`.
    - JSONC edits keep the file's detected indent and line endings (`byte-preservation.test.ts`). Nothing in the source handles a BOM.
  - **Marker precedent.** The client-config README carries a generated block between `<!-- ADAPTER-TABLE:BEGIN -->` and `<!-- ADAPTER-TABLE:END -->`, produced by `scripts/render-certification-table.mjs`.
- **Counts today** (read from source).

  | Server | Package tools | `core` (package / runtime) |
  | --- | --- | --- |
  | dev | 32 | 14 / 15 |
  | admin | 26 | 12 / 13 |
  | interop | 24 | 11 / 12 |
  | ops | 21 | 9 / 10 |
  | data | 7 | 7 / 8 |
  | **Total** | **110** | |

  Each server also advertises `iris_server_profiles`, which makes 115 advertised. Every package has two presets, `core` and `developer`.

## UX & Interaction Patterns

- **Installer.** It previews a dry-run diff before any write and confirms like `apply` does (`--yes` or a TTY prompt). Re-install is idempotent, and update and uninstall touch only owned files.
- **Claude Code projects with a `CLAUDE.md`.** The route uses `.claude/rules/`, and the installer tells the user how to import `AGENTS.md` (`@AGENTS.md`) instead of assuming Claude Code reads it.
- **Client routes.** At minimum:
  - Claude Code → `.claude/skills/` and `.claude/rules/`;
  - VS Code / Copilot → `.github/instructions/*.instructions.md` with `applyTo:`;
  - Cursor → `.cursor/rules/`;
  - other agents → `.agents/skills/` and an `AGENTS.md` block between stable markers.
- **Skill descriptions** say when to load the skill. The MCP prompt text keeps its user-facing role.

## Cross-Story Dependencies

- **41.1 comes first.** It sets the source-tree layout, the pack build, the notice and its provenance check, and the extension of `validate:prompts` to every pack `SKILL.md` and rule file. Every later story builds on it, and `gen:skills:check` must never flag hand-authored files.
- **41.2 decides the single source** for the rule and `objectscript-review`: one generates the other, or the prompt is retired with a recorded reason. A retirement moves the prompt pins, the README tables and the CHANGELOG. 41.2 also defines the `AGENTS.md` markers that 41.6 inserts.
- **41.3 and 41.4 add the knowledge skills.** The 6–10 total is counted after 41.4, and every adapted skill must pass 41.1's check.
- **41.5** adds the description field, regenerates the 13 workflow skills, and replaces the content of `skills/README.md` with a generated pack catalog covering the knowledge skills, the workflow skills and the rule.
- **41.6** consumes the pack and both rule forms. It extends 41.1's check to the installer payload and covers all 16 rows in its disposition table.
- **41.7** writes the docs: a root README section and the client-config README. Its capstone drives the CLI against a temporary project for every route, and the one-time live check uses a real Claude Code session.
- **Downstream.** Story 42.8's plugin consumes the same pack and extends the provenance check to the plugin folder.
