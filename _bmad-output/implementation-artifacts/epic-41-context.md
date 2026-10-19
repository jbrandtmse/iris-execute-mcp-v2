# Epic 41 Context: Companion Skills & Rules Pack

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Agents that write ObjectScript get the project's hard-won rules in three forms: one short, always-on pre-write checklist; 6–10 knowledge skills that the model loads when it needs them; and the workflow skills generated from the suite's MCP prompts. All three ship as one generated pack, `packages/client-config/skills-pack/`, and an installer in `@iris-mcp/client-config` puts it into each MCP client's native location. The competitor's MIT notice ships wherever adapted content ships. The pack is our own equivalent of the competitor's kit (intersystems-community/iris-agentic-dev), not a copy. Agents choose skills by their description, and MCP prompts are slash commands only a user can invoke, so shipping the content as skills is what lets agents actually find it. This is the only epic on `feature/feature-wave-7-skills-pack`. Story 42.8's Claude Code plugin consumes the same pack later.

## Stories

- Story 41.1: Pack Layout, Licensing and Provenance (done)
- Story 41.2: Always-On ObjectScript Pre-Write Rule
- Story 41.3: Core Knowledge Skills
- Story 41.4: Platform Knowledge Skills
- Story 41.5: Workflow Skills Refresh
- Story 41.6: Skills and Rules Installer
- Story 41.7: Skills Pack Docs and Capstone

## Requirements & Constraints

- **Precedence.** The spine binds every story. Where a story and the spine disagree, the spine wins and the story text is amended in place.
  - The run is unattended. The orchestrator decides escalations and records them in `_bmad-output/implementation-artifacts/orchestrator-decisions-wave-7.md`. It holds decisions #1–#3 (the pack layout, the notice filename, and the routing of the two pack-wide checks to 41.5).
  - Sprint planning flagged the live Claude Code session checks (AC 41.2.5 and AC 41.7.3) as a warning for this run.
- **Content.**
  - The core is written from `.claude/rules/` and the epic retros. Competitor content is adapted only where it is clearly the better start, for example the list and SQL pattern skills.
  - 41.3 covers ObjectScript gotchas, `%Status` and error handling, and `%UnitTest`. 41.4 covers embedded SQL, IRIS system-class discipline and interoperability patterns.
  - The total number of knowledge skills is 6–10, counted mechanically.
  - Each knowledge `SKILL.md` has `name` and a model-invocation `description` that says when to load it. 41.3 also adds a default-suite check, proven red, that every pack `SKILL.md` opens with frontmatter holding both, and that an adapted skill's header comes after it (DW-613).
- **User-facing wording.** No internal rule numbers, repository paths, DW or AD ids appear anywhere in agent content, prompts included. This becomes a mechanical pack-wide check in 41.5 (AC 41.5.4).
  - Every `iris_*` token names a real tool.
  - Each skill declares the preset it needs, and validation checks the tool's visibility under that preset (also AC 41.5.4).
- **Probing.** Every factual claim is probed live, and the probe log goes in the story record.
  - Check `irislib/` and `irissys/` first.
  - Snippets compile in a disposable `ExecuteMCPv2.Temp.*` class. Test snippets run through `iris_execute_tests`, with the `total` compared against the expected count. Fixtures are deleted afterwards.
  - A claim that fails its probe is corrected, and its source rule file is flagged for the retro.
  - The shared instance is never stopped.
- **Licensing.** The source is `intersystems-community/iris-agentic-dev` at `b6205bb` (`b6205bbbad2f431ae14c34401fd55d85cb5d2305`), MIT, © 2025 InterSystems Corporation.
  - It is fetched into a scratch directory as untrusted data, read and never executed. Story 41.1 records the exact fetch procedure (hooks and LFS filters disabled, detached checkout).
  - The notice is `IRIS-MCP-THIRD-PARTY-NOTICES.md`. It already exists with zero provenance rows, the byte-exact MIT text (1081 bytes, sha256 `85b458dc…929c`), the credits to Tim Leavitt and Tom Dyar, and the non-endorsement sentence.
  - Each adapted file carries, as its first non-blank line after any frontmatter, exactly: `Adapted from intersystems-community/iris-agentic-dev (MIT, © 2025 InterSystems Corporation); see IRIS-MCP-THIRD-PARTY-NOTICES.md`. It also needs a provenance row in the notice.
  - A row is ``| `skills/<name>/SKILL.md` | `skills/skills/<upstream-name>/SKILL.md` | <what changed> |``. The pack path is pack-relative, and the source is a plain path in the upstream checkout. Only letters, digits, `.`, `_`, `-` and `/` are allowed, with no `..`, no fragment and no line suffix. All 1373 upstream paths pass this.
  - Nothing is derived from upstream `skills/kb/ipm-module-authoring.md` or `skills/skills/iris-objectscript-eval/`.
  - Nothing presents the pack as InterSystems' or implies endorsement. "IRIS" and "ObjectScript" may be used descriptively.
  - The notice ships wherever adapted content ships: npm `files`, the plugin folder, and every installer write.
- **Client facts** (from the Claude Code docs, 2026-10-14 and 2026-10-18):
  - Claude Code loads skills from `.claude/skills/`, `~/.claude/skills/` and plugin `skills/`, never from `.agents/skills/`.
  - It reads `AGENTS.md` natively only when the project has no `CLAUDE.md`. Otherwise the file is imported with `@AGENTS.md`.
  - `.claude/rules/*.md` loads automatically, and plugins cannot carry rules.
  - A plugin always scans its default `skills/`, and every component path must resolve inside the plugin root.
- **Gate discipline.**
  - Each gate is proven red on the path it guards (#59).
  - The capstone runs in the default suite (#21).
  - Tallies are counted mechanically (#51).
  - Review asks what is missing from each enumeration (#56).
  - Byte-preservation fixtures are deliberately varied (#58).
- **ASCII source.** Non-ASCII characters in `.mjs`/`.ts` files are written as escapes, for example `©` for the copyright sign. The edit tool decodes `\u` escapes into the literal character, so a test builds such strings with `String.fromCharCode`.
- **Out of scope.** No benchmarking in this repo. Also out of scope: the plugin (42.8), a compile-on-save hook, skills about MCP server internals, and the extension UI.

## Technical Decisions

- **AD-28, prompts.** MCP prompts are authored once, in `packages/*/src/prompts/`, and the workflow skills are generated from them.
  - A skill's model-invocation description is a separate field on the prompt definition. Only `gen:skills` reads it, and a pin proves it never reaches `prompts/list`.
  - `PromptDefinition` (`packages/shared/src/tool-types.ts`) has no such field today. It has `name`, `title`, `description`, `arguments` and `build`.
- **AD-28, one pack** (decided in 41.1). The pack is the committed, generated, DO-NOT-EDIT `packages/client-config/skills-pack/`.
  - Only `pnpm gen:pack` writes it. `pnpm gen:pack:check` fails on any MISSING, DRIFT or STRAY file. The generator renders nothing and needs no build.
  - **Sources.** Hand-authored sources live in `skills-pack-src/`:
    - `knowledge/<name>/` holds each knowledge skill, with an exact-case `SKILL.md`;
    - `rules/` holds the rule's forms;
    - the notice sits at the root;
    - the root `README.md` is a contributor doc that is not copied.

    Any other top-level entry fails the build. The workflow skills stay `gen:skills` output in `skills/`, which `gen:skills` alone owns.
  - **Shape.** The pack is a standard plugin root:
    - `skills/<name>/…` for workflow and knowledge skills alike;
    - `rules/…`;
    - the notice;
    - a generated `README.md`, from `renderPackReadme()` in `scripts/lib/skills-pack.mjs`.

    A skill name defined in both sources fails the build. Files are copied as `Buffer`s, byte for byte, and only regular files are copied, never symlinks. An extra file in a source skill directory ships too.
  - **Consumers.** The pack ships through client-config's `files` (`["dist", "!dist/**/__tests__", "skills-pack"]`) with no lifecycle hook. The installer reads it from its own package, and the plugin roots at the same directory. A repo-root plugin is ruled out, because it would load the skills twice.
  - **Rules.** The rule is unscoped (no `paths:`). A `paths:`-scoped rule never loads when an agent writes through `iris_doc_put` or `iris_doc_edit`. The installer's Claude Code route installs rules only when it detects the plugin, so skills are not installed twice.
- **What 41.1 shipped** (`scripts/`; each CLI and its `iris-mcp-all` test share one core, AD-2):
  - `lib/generated-tree.mjs` is the one tree-sync helper (`listFilesRecursive`, `diffTree`, `writeTree`) behind `gen-skills.mjs` and `gen-pack.mjs`. `writeTree` deletes strays before it writes, which is safe on case-insensitive file systems.
  - `lib/skills-pack.mjs` holds the path constants (`PACK_SOURCE_DIR`, `KNOWLEDGE_SOURCE_DIR`, `RULES_SOURCE_DIR`, `PACK_DIR`, `WORKFLOW_SKILLS_DIR`, `NOTICE_FILENAME`), plus:
    - `assemblePack(root)`;
    - `listAgentContentFiles(root)`, the one enumeration of agent content. It covers `.md` files only, with the labels `workflow:`, `pack:`, `knowledge:` and `rule:`.

    Tests place their probe files through these constants.
  - `lib/provenance-core.mjs` is pure. It holds the pinned oracles (`UPSTREAM_COMMIT`, `UPSTREAM_LICENSE_SHA256`/`_BYTES`, `ADAPTATION_HEADER`, `DISTRIBUTION_MARKER`, `EXCLUDED_SOURCES`, `REQUIRED_CREDITS`, `NON_ENDORSEMENT`, `PROVENANCE_HEADER_ROW`) and `checkProvenance()`, which reports `{rule, label, message}`.
  - `lib/provenance-inputs.mjs` provides `gatherProvenanceInputs()`. It runs `npm pack --dry-run --json --ignore-scripts --offline` on every non-private `packages/*` package (8 today) and fails closed. Any tarball that holds a pack file, or any file containing the ASCII marker `Adapted from intersystems-community/iris-agentic-dev`, must carry a byte-equal notice. A package README that quotes the header would therefore trip the check.
  - `pnpm check:provenance` runs `scripts/check-provenance.mjs`.
  - `validate:prompts` now scans the 13 prompts and every collected content file. Today that is 39 sources (13 prompts, 13 `workflow:` and 13 `pack:` files, 0 `knowledge:` and 0 `rule:`) against 111 tool names.
  - `scripts/lib/dist-freshness.mjs` exports `isDistShipping`.
  - `.prettierignore` covers `/skills/`, the pack and the notice source.
- **Pins that move as the pack grows.**
  - `story-41-1-qa-validate-prompts-pack.test.ts` pins the exact validator OK line (`39 source(s) … 13 workflow, 13 pack, 0 knowledge, 0 rule`). This is the shared-surface baseline that 41.2–41.4 update.
  - `validate-prompts.test.ts` asserts 13 prompts and 13 workflow files.
  - Prompt and workflow changes also move:
    - `skills-generated-frontmatter.test.ts`, which lists the 13 names;
    - `gen-skills-stray-file.test.ts`;
    - `docs-prompt-sync.test.ts`, with per-server prompt counts and the README's "110 tools";
    - `prompt-safety-invariants.test.ts`, where `objectscript-review` has no arguments and at most 300 words;
    - each package's `prompts.test.ts`.
- **Seams (#52).** Later stories extend `assemblePack` with new source kinds and `gatherProvenanceInputs` with new distributions. They never re-touch the tree-sync helper or the pinned oracles.
- **AD-29.** Changesets stay `patch` or `minor`. No story runs `changeset version` or publishes. 41.1's changeset is `minor` for client-config, which is still at version 0.0.1.
- **AD-14.** A generated file changes only through its generator. That covers `skills/`, the pack, and `skills/README.md`, which `gen:skills` renders with a 13-row table. The installer-managed `.claude/skills/bmad-*` files are never touched.
- **AD-15.** Retiring the `objectscript-review` prompt is pre-sanctioned and is named in `CHANGELOG.md` with its story. Any other change to an existing prompt's name, arguments or output needs a recorded decision.
- **AD-2.** The pack build and its checks live in `scripts/` or `packages/iris-mcp-all`, and enumerate the built dist.
  - `client-config` never depends on a server package.
  - `iris-mcp-all` depends on the five servers but not on `client-config`.
- **AD-30 (installer writes).**
  - **Protocol.** Every write runs validate → timestamped backup → edit → re-parse → auto-restore on failure. The diff preview is shown before confirmation.
  - **Ownership.** Only owned files and marked blocks are written. Foreign content is preserved byte for byte, proven on fixtures with CRLF, a BOM, comments, no trailing newline, and an existing foreign block.
  - **Manifest.** The installer writes a per-target manifest of the installed paths and their content hashes.
    - An update removes owned paths that are absent from the new pack.
    - A file whose hash no longer matches is never overwritten without confirmation.
  - **Re-install and uninstall.** Re-install is idempotent. Uninstall removes only owned content, and third-party content is never logged.
- **Prompts today** (13, from each package's `src/prompts/index.ts`):
  - dev has 5: `diagnose-slow-query`, `objectscript-review`, `deploy-and-test-class`, `promote-environment-change` and `edit-and-test-class`;
  - admin has 2: `provision-project-environment` and `audit-security-posture`;
  - interop has 4: `trace-message-flow`, `recover-stuck-production`, `resend-failed-messages` and `find-patient-messages`;
  - ops has 2: `check-system-health` and `run-external-backup`;
  - data has none.

  AC 41.5.1's "11 plus the prompts of 38.6, 39.6 and 40.4" works out to these 13.
- **`gen:skills`** (`scripts/gen-skills.mjs`) writes each `SKILL.md` with YAML frontmatter: a `# DO NOT EDIT` comment naming `packages/<pkg>/src/prompts/*.ts`, then `name`, then `description`, then the `build({})` body. The pack copies that comment as-is. AC 41.5.4 must move it out of agent-visible text, and 41.2 resolves the `SanitizeError` mention in `objectscript-review` first.
- **The 41.2 overlap.** `objectscript-review` (`packages/iris-dev-mcp/src/prompts/objectscriptReview.ts`) is already a no-argument pre-write checklist, distilled from the same rule files. Its claims were never probe-verified.
- **Missing today.** There is no `AGENTS.md`, no plugin manifest, and no `rules/` or `knowledge/` source. The root `LICENSE` is MIT, © 2026 jbrandtmse.
- **`client-config` as it stands.**
  - **CLI.** The bin is `iris-mcp-clients` (`src/cli/clients-cli.ts` → `src/cli/clients.ts`). Its commands are `detect`, `status`, `diff`, `apply`, `enable`, `disable`, `remove`, `restore` and `doctor`.
    - Exit codes are 0 (success), 1 (operational failure) and 2 (usage error).
    - With `--json`, a command answers with one envelope: `{ok, command, data, error?}`.
    - `apply` prints the diff, then needs `--yes` or a TTY confirmation. Without either, it exits 2.
  - **Adapters.** `adapters.ts` has 13 `CLIENT_ADAPTERS` (claude-code, claude-desktop, cursor, vscode, cline, roo-code, windsurf, codex, gemini, zed, goose, kimi, kimi-code). It also has 3 `CLIENT_DISPOSITIONS`: `pi` (excluded, not MCP-capable), and `jetbrains-junie` and `kilo-code` (roadmap). These are AC 41.6.1's "16 adapters". The data stamp is `ADAPTER_DATA_VERSION` `2026-07-28.1`.
  - **Engine.** `engine.ts` owns a config entry when it has a canonical server name or is listed in the `state.json` ledger (`state.ts`).
  - **Writes.** `write.ts` `applyWrite` runs the protocol, but it takes a `ClientAdapter` and re-parses in that adapter's format (JSON, JSONC, TOML or YAML). Markdown and rule files need a variant of the protocol, not a reimplementation.
    - Backups go to `<stateDir>/backups/<client>/<scope>/<file>.<ts>`.
    - JSONC edits keep the detected indent and line endings.
    - `readers.ts` strips a leading BOM before it parses, but the write path has no BOM handling.
  - **Marker precedent.** The client-config README carries a generated block between `<!-- ADAPTER-TABLE:BEGIN -->` and `<!-- ADAPTER-TABLE:END -->`, produced by `packages/client-config/scripts/render-certification-table.mjs`.
- **Counts that must not move unless a story says so** (read from the built dist):

  | Server | Package tools | `core` (package / runtime) |
  | --- | --- | --- |
  | dev | 32 | 14 / 15 |
  | admin | 26 | 12 / 13 |
  | interop | 24 | 11 / 12 |
  | ops | 21 | 9 / 10 |
  | data | 7 | 7 / 8 |
  | **Total** | **110** | |

  - Each server also advertises `iris_server_profiles`, which makes 115 advertised.
  - Every package has two presets, `core` and `developer`.
  - The governance baseline is `1e62c5ad5bf7`/141, and `BOOTSTRAP_VERSION` is `5296a1c836f4`.
- **Running checks.**
  - **Builds.** `gen:skills`, `validate:prompts` and `check:provenance` need built dists of shared, the five servers and client-config. Provenance fails closed when client-config has no `dist/`.
  - **Tests.** Pack tests run standalone with `pnpm --filter @iris-mcp/all exec vitest run <files>`. The full `@iris-mcp/all` suite takes about 600 s, so split it across foreground calls.
  - **Turbo.** Turbo does not order `@iris-mcp/all`'s tests after client-config's build, and its cache omits the pack inputs (DW-611, owned by 41.7).

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

- **41.1 (done)** delivered the layout, `gen:pack`, the notice, the provenance check and the extended validator, all with zero rows. Every later story builds on these, and `gen:skills:check` never sees hand-authored files.
- **41.2** adds the rule's forms under `skills-pack-src/rules/`, one Claude Code rule file and one `AGENTS.md` section. It also defines the `AGENTS.md` markers that 41.6 inserts.
  - It decides the single source for the rule and `objectscript-review`: one generates the other, or the prompt is retired with a recorded reason.
  - A retirement moves the prompt pins, the README tables and the CHANGELOG.
  - Then `gen:pack` runs and the validator OK-line pin is updated.
- **41.3 and 41.4** add `knowledge/<name>/` skills and provenance rows for adapted passages. 41.3 owns the skill-format check (DW-613). The 6–10 total is counted after 41.4, and every adapted skill passes `check:provenance`.
- **41.5** does three things:
  - It adds the description field and regenerates the 13 workflow skills.
  - It replaces the pack `README.md` (and supersedes `skills/README.md`) with a generated catalog of the knowledge skills, the workflow skills and the rule.
  - It adds AC 41.5.4's preset-visibility and no-internal-references checks.
- **41.6** reads the payload from client-config's own `skills-pack/`, covers all 16 rows in its disposition table, and appends the installer payload as a distribution in `gatherProvenanceInputs`.
- **41.7** writes the docs: a root README section and the client-config README. Its capstone drives the CLI against a temporary project for every route, and the one-time live check uses a real Claude Code session. It also fixes DW-611: test ordering and turbo cache inputs, which must cover the pack sources, `scripts/`, client-config's `package.json`, `skills-pack/**` and `dist/`.
- **Downstream.**
  - 42.6 owns the publish-path gate. Today client-config's `prepublishOnly` runs neither `gen:pack:check` nor `check:provenance` (DW-612).
  - 42.8 roots the plugin at the pack and adds the plugin distribution to the provenance check.
