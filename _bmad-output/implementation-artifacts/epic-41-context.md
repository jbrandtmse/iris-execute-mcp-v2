# Epic 41 Context: Companion Skills & Rules Pack

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Agents that write ObjectScript get the project's hard-won rules in three forms: one short, always-on pre-write checklist; 6–10 knowledge skills that the model loads when it needs them; and the workflow skills generated from the suite's MCP prompts. All three ship as one generated pack, `packages/client-config/skills-pack/`, and an installer in `@iris-mcp/client-config` puts it into each MCP client's native location. The competitor's MIT notice ships wherever adapted content ships. The pack is our own equivalent of the competitor's kit (intersystems-community/iris-agentic-dev), not a copy. Agents choose skills by their description, and MCP prompts are slash commands only a user can invoke, so shipping the content as skills is what lets agents actually find it. This is the only epic on `feature/feature-wave-7-skills-pack`. Story 42.8's Claude Code plugin consumes the same pack later.

## Stories

- Story 41.1: Pack Layout, Licensing and Provenance (done)
- Story 41.2: Always-On ObjectScript Pre-Write Rule (done)
- Story 41.3: Core Knowledge Skills (done)
- Story 41.4: Platform Knowledge Skills
- Story 41.5: Workflow Skills Refresh
- Story 41.6: Skills and Rules Installer
- Story 41.7: Skills Pack Docs and Capstone

## Requirements & Constraints

- **Precedence.** The spine binds every story. Where a story and the spine disagree, the spine wins and the story text is amended in place.
  - The run is unattended. The orchestrator decides escalations and records them in `_bmad-output/implementation-artifacts/orchestrator-decisions-wave-7.md`, which holds #1–#11: pack layout, notice filename, routing the two pack-wide checks to 41.5, retiring `objectscript-review`, the rule's two forms and markers, running 41.2's live check (#1–#6); suite-prefixed knowledge-skill names (#7); knowledge skills name no `iris_*` tool (#8); nothing adapted in 41.3 (#9); a `SKILL.md` starting with a BOM is refused (#10); 41.3's skill text corrected in code review (#11).
  - The live session check of AC 41.2.5 passed. AC 41.7.3's is still open.
- **Content.**
  - The core is written from `.claude/rules/`, the epic retros, IRIS's own source and live behavior. Competitor content is adapted only where it is clearly the better start, for example the list and SQL pattern skills.
  - 41.3 shipped `iris-mcp-objectscript-gotchas`, `iris-mcp-objectscript-error-handling` and `iris-mcp-objectscript-unit-tests`: tool-free, nothing adapted, each directory holding only `SKILL.md`, cross-referencing each other in a "Related skills" section. 41.4 adds the platform skills; the 6–10 total is counted mechanically after it, so 41.4 adds 3 to 7.
  - **Description:** names what the skill covers in its first sentence, then a `Use when` sentence with the triggers; at most 1,024 characters; no XML-like tag (write `UNDEFINED`, not `<UNDEFINED>`). 41.3's are 515, 480 and 497 characters.
  - **Size and bytes** (41.3's budget): at most 500 lines and 1,200 words by the suite's `wordCount`; ASCII, LF, exactly one final LF. 41.3's skills are 56, 82 and 102 lines; 811, 946 and 963 words.
  - The pre-write checklist text lives only in the rule source. A test pins that no rule bullet (whitespace-normalized) appears in a knowledge skill, so skills go deeper instead of restating it.
  - **Agent content is the product (decision #11).** A false or over-broad claim in a skill is a defect. 41.3's review narrowed claims to exactly what ran, for example: "every Assert macro" became "the common Assert macros" (one macro is not covered); "`$$$QuitOnError` does not compile in a loop" holds for `While` and `Do`/`While`, while a `For` loop compiles and then raises `<COMMAND>`; a "removes one prefix in any language" claim run in 4 languages was re-run over all 15 message tables before it was kept. Every changed or added claim is probed first, and the golden text, its sha256 and anchors, and the spec's change log move in the same pass.
  - **Known-wrong source claims.** 41.2's probes found errors in the rule files the skills are written from. These are recorded as DW-615 (decision-pending; the user decides, and no story edits `.claude/rules/*`). Do not carry them into skills:
    - a typed MultiDimensional property compiles;
    - `%OnNew` `Private` is refused (`#5477`) only when the parent's `%OnNew` is public, as in `%UnitTest.TestCase`;
    - `$$$AssertNotTrue` exists, as do `$$$AssertStatusEquals`, `$$$AssertSuccess`, `$$$AssertFailure` and `$$$AssertSkipped`;
    - an empty abstract-method body compiles;
    - `//` is a valid comment;
    - `%`-named members are a convention, not a compile rule;
    - `ExecuteMCPv2.*` classes resolve in `%SYS` on this instance, so the basics rule's `New $NAMESPACE` example is environment-dependent;
    - `Use dev::("")` clears the mnemonic but leaves redirection on, so the next `Write` raises `<COMMAND>`.
- **Platform skills (Story 41.4, next).** Embedded SQL, IRIS system-class discipline and interoperability patterns.
  - **AC 41.4.1, system-class discipline:** `Config.*` (configuration), `SYS.*` (runtime) and `Security.*` (authorization), and when to join them; checking for deprecated properties; safe `%SYS` switching (no `New $NAMESPACE` in REST handlers); per-process versus instance-wide counters. Each claim probed live.
  - **AC 41.4.2, interoperability:** business service, process and operation signatures; `Ens.Request` and `Ens.Response`; adapters; production XData as the source of truth. Each claim probed live.
  - **AC 41.4.3:** the total knowledge-skill count is 6–10, derived mechanically (#51: count the `knowledge/` directories and cross-check every prose tally against that), and every adapted skill passes `check:provenance`.
  - Embedded SQL: 41.3's review left `%OpenId` and `SQLCODE` error paths to the platform SQL skill. The upstream kit ships `iris-*` names such as `iris-sql`; the suite prefix avoids collisions.
  - **The project's own source material:**
    - `.claude/rules/iris-objectscript-basics.md`, section "Namespace Switching in REST Handlers": save and restore `$NAMESPACE` in a local, restore it first in every `Catch`, validate input before switching, `Config.*` and `Security.*` exist only in `%SYS`, prefer named queries such as `Config.Namespaces:List` over non-existent methods. Section "Ensemble Architecture Guidance": exact `OnProcessInput` and `OnMessage` signatures, `Ens.Request`/`Ens.Response` subclasses, the adapter on each host, sync versus async.
    - `.claude/rules/project-rules.md`: #2 (read the class first; a `:List` query's ROWSPEC is narrower than the properties, e.g. `Security.Roles:List` has no Resources, `ListAll` does); #3 (`Config.*`/`SYS.*`/`Security.*`, joins such as `Config.Databases` with `SYS.Database`); #4 (check `[Deprecated]`; `Security.SSLConfigs.Protocols` → `TLSMinVersion`/`TLSMaxVersion`); #5 (`$ZU` counters are per-process; `SYS.Stats.Global.Sample()`, `SYS.Stats.Routine.Sample().RtnCommands`); #27 (`SaveToClass`/`RemoveItem` write the class XData, `LoadFromClass(prod)` re-syncs the `Ens.Config.Item` extent and goes before `%OpenId`, the `Name` index is composite `(Production, Name)`).
    - `irislib/` (`Ens.*`, `EnsLib.*`, `%Library`, `%SQL`) and `irissys/` (`Config.*`, `SYS.*`, `Security.*`), IRIS 2026.2 Build 221U. Spot-checked: `Security.Roles` `List` vs `ListAll` (`irissys/Security/Roles.cls:373,413`); `Protocols` `[ Deprecated ]` (`irissys/Security/SSLConfigs.cls:148`); `Ens.BusinessService.OnProcessInput` (`irislib/Ens/BusinessService.cls:132`), `Ens.BusinessOperation.OnMessage` typed `%Library.Persistent` (`:707`), `Ens.BusinessProcess.OnRequest` (`:839`); `Ens.Config.Production` `SaveToClass`, `LoadFromClass`, `RemoveItem` (`:123,173,195`). The snapshot declares `SYS.Stats.Routine.Sample()` as returning `SYS.Stats.Global` (`irissys/SYS/Stats/Routine.cls:45`), while `RtnCommands` is a `SYS.Stats.Routine` property, so probe rule #5's claim live.
    - **Overlap:** the gotchas skill already covers `New $NAMESPACE` scope and the `Catch` namespace, and `%ExistsId("Ens.Director")` (0 in `%SYS`). The always-on rule holds the `%SYS` `<CLASS DOES NOT EXIST>` bullet, which must not be copied.
- **User-facing wording.** No internal rule numbers, repository paths, project classes or helpers (`ExecuteMCPv2`, `SanitizeError`), snapshot folders (`irislib`, `irissys`), repository tooling, DW/AD/AC ids, Story/Epic numbers, or the word "probe" in agent content. 41.3 enforces this per skill; 41.5 makes it pack-wide (AC 41.5.4). IRIS codes in both forms (`ERROR #5001`, `#1043:`), IRIS syntax such as `/noload/nodelete/norecursive`, and the pack's own skill names are allowed.
  - Every `iris_*` token names a real tool. Each skill declares the preset it needs, and validation checks the tool's visibility under that preset. How a skill declares it is not yet defined; 41.5 builds the check. A tool-free skill declares none.
- **Probing** (41.2 and 41.3 are the precedent).
  - Check `irislib/` and `irissys/` first. They are gitignored, so pass the path explicitly.
  - Disposable `ExecuteMCPv2.Temp.<prefix>*` classes (41.3: `Probe413*`, QA `QA413*`, review `Probe413CR*`) on `server:"default"`, namespace `HSCUSTOM`, compiled with `ck`. Before and after, `iris_doc_list filter:"<prefix>" generated:true` returns `[]`; delete them with one `iris_doc_delete`.
  - Every code block compiles verbatim; say so when a block calls helpers it does not define (41.3's `Process` compiled only beside `Validate` and `Count`). Test snippets run through `iris_execute_tests`, one class per call, with `total` compared to the expected `Test*` count; a class that cannot start reports 0. Row-level claims are read back with SQL over `%UnitTest_Result`.
  - A claim whose run would need a file or global write is checked with a ranged `iris_doc_get` of the live system class instead. Reads allowed: `iris_global_get`, read-only `iris_sql_query`.
  - The probe log goes in the story record, one row per claim (claim, probe, observed, verdict "holds"). Each row has one verbatim anchor phrase that the knowledge test requires, and each skill's sha256 is pinned, so any rewording forces a re-probe.
  - Write no HSCUSTOM globals (`^ClineDebug` included); the only writes are the `%UnitTest` framework's own result rows. Never stop IRIS, never start a production, and never target an `ocupilot-slot-*` profile.
  - A claim that fails its probe is corrected, and its source rule file is flagged.
- **Licensing.** The source is `intersystems-community/iris-agentic-dev` at `b6205bb`, MIT, © 2025 InterSystems Corporation.
  - Treat it as untrusted data: fetched into a scratch directory with hooks and LFS disabled, detached checkout, read only, never executed. In 41.3 only the plan stage read it, and the implement stage did not open it.
  - The notice is `IRIS-MCP-THIRD-PARTY-NOTICES.md`: 0 provenance rows today, the byte-exact MIT text (1081 bytes, sha256 `85b458dc…929c`), credits to Tim Leavitt and Tom Dyar, and the non-endorsement sentence.
  - Nothing implies InterSystems' ownership or endorsement. "IRIS" and "ObjectScript" may be used descriptively. The notice ships wherever adapted content ships: npm `files`, the plugin folder, and every installer write.
- **Client facts** (Claude Code docs, re-checked 2026-10-19; CLI 2.1.296):
  - Skills load from `.claude/skills/`, `~/.claude/skills/` and plugin `skills/`, never from `.agents/skills/`. Claude Code reads a skill's frontmatter only when `---` is its first line; same-named personal and project skills shadow each other.
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
- **AD-28, knowledge skills.** The core three are named above; like the rule, they name no `iris_*` tool, so they declare no preset.
- **AD-28, skill frontmatter.** Every pack `SKILL.md` opens with frontmatter on line 1 (no BOM), holding only `name` and `description`. `name` equals its directory, matches `^[a-z0-9]+(-[a-z0-9]+)*$`, has at most 64 characters, and contains neither `claude` nor `anthropic`. `description` is non-empty, at most 1,024 characters, with no XML-like tag. `check:provenance` enforces it with its `skill-frontmatter` rule. A later field, such as a preset declaration, extends that rule.
- **Conventions, "Pack names".** Hand-authored pack content carries the suite prefix: `iris-mcp-<name>` for rules and knowledge skills, and `IRIS-MCP-THIRD-PARTY-NOTICES.md` for the notice. Generated workflow skills keep their prompt names (AD-15).
- **AD-28, one pack.** The pack is the committed, generated, DO-NOT-EDIT `packages/client-config/skills-pack/`.
  - Only `pnpm gen:pack` writes it. `pnpm gen:pack:check` fails on any MISSING, DRIFT or STRAY file.
  - **Sources** live in `skills-pack-src/`:
    - `knowledge/<name>/` holds one directory per skill, with an exact-case `SKILL.md`; any extra file in it ships too. Today: the three 41.3 skills;
    - `rules/<name>.md` holds one flat file per rule, with no frontmatter. Today that is `iris-mcp-objectscript-pre-write.md`: 2,120 bytes, ASCII, 16 bullets, no `iris_*` token, so no preset;
    - the notice sits at the root;
    - the root `README.md` is a contributor doc and is not copied. It documents the knowledge-skill format, the adaptation header and row, the excluded sources and the checks.

    `gen:pack` copies sources byte for byte, needs no build, does not read frontmatter, and renders only the pack README and each rule's `AGENTS.md` form. The workflow skills stay `gen:skills` output in `skills/`.
  - **Shape** (a standard plugin root):
    - `skills/<name>/…` for workflow and knowledge skills alike;
    - `rules/claude-code/<name>.md` holds the source bytes;
    - `rules/agents-md/<name>.md` holds `<!-- IRIS-MCP-RULE:<name>:BEGIN -->\n`, then the source bytes, then a `\n` if the source lacks a final LF, then `<!-- IRIS-MCP-RULE:<name>:END -->\n`;
    - the notice and a generated `README.md` sit at the root.
  - **`gen:pack` refuses** (exit 1, nothing written): an unknown top-level entry; a `knowledge/<n>/` without `SKILL.md`; a non-directory entry in `knowledge/`; a knowledge name that is also a workflow skill; a `rules/` entry that is not a flat `^[a-z0-9]+(-[a-z0-9]+)*\.md$` file; a rule that opens with frontmatter; a rule with a line starting `<!-- IRIS-MCP-RULE:`.

    Dotfiles are not skipped. On macOS, a Finder `.DS_Store` fails the build (DW-619, by design: delete it), and one inside a skill directory would ship (and fails the knowledge test's one-file check).
  - **Marked blocks** (a conventions row): an owned block in a user file sits between the exact whole-line markers. It is replaced whole, and everything outside it is preserved byte for byte.
  - **Consumers.** The pack ships through client-config's `files` (`["dist", "!dist/**/__tests__", "skills-pack"]`) with no lifecycle hook. The installer reads it from its own package, and the plugin roots at it. A repo-root plugin would load the skills twice. The rule is unscoped, and the installer's Claude Code route installs rules only when it detects the plugin.
- **Pack scripts** (`scripts/`; each CLI and its `iris-mcp-all` test share one core, AD-2):
  - `lib/generated-tree.mjs`: `listFilesRecursive`, `diffTree` and `writeTree`.
  - `lib/skills-pack.mjs`: the path constants (`PACK_SOURCE_DIR`, `KNOWLEDGE_SOURCE_DIR`, `RULES_SOURCE_DIR`, `PACK_DIR`, `WORKFLOW_SKILLS_DIR`, `NOTICE_FILENAME`), plus `RULE_FORM_DIRS`, `RULE_SOURCE_NAME`, `ALWAYS_ON_RULE_FILENAME`, `agentsMdMarkers`, `renderAgentsMdSection`, `renderPackReadme`, `assemblePack` and `listAgentContentFiles`.
    - The frontmatter reader: `SKILL_FILENAME`, `SKILL_NAME`, `SKILL_NAME_MAX_LENGTH` (64), `SKILL_DESCRIPTION_MAX_LENGTH` (1024), `SKILL_FRONTMATTER_FIELDS` (`name`, `description`) and the pure `skillFrontmatterProblems(text, dirName) -> string[]`. Its grammar is a fail-safe YAML subset: LF split with one trailing CR dropped; `key: value` at column 1, blank and `#` comment lines allowed; a value is a JSON double-quoted string, a single-quoted string, or a plain scalar without `: `/` #`, not ending in `:` and not starting with a YAML indicator; only spaces and tabs are trimmed (a no-break space is kept, as YAML does). Each message names the problem and the fix.
    - `SKILL_FRONTMATTER_FIELDS` is both the allowed and the required list, so an optional later field also needs the grammar to allow it without requiring it.
    - `listAgentContentFiles` is the one agent-content enumeration (`.md` only). Its labels are `workflow:`, `pack:`, `knowledge:<n>/<f>` (packRel `skills/<n>/<f>`) and `rule:`. The `rule:` packRel is still `rules/<f>`, which is stale. DW-614 accepts this, to reopen if a rule is ever adapted.
  - `lib/provenance-core.mjs` is pure. It holds the pinned oracles and `checkProvenance()`. Rules: `notice`, `mit-block`, `provenance-table`, `notice-sync`, `excluded-source`, `row-file`, `skill-frontmatter`, `header`, `claim-row`, `distribution`. `skill-frontmatter` runs on every agent file whose packRel matches `^skills/([^/]+)/SKILL\.md$` (workflow source, knowledge source and pack copy alike). `hasValidAdaptationHeader` still skips a leading `---` block, so a header above the frontmatter passes it alone; `skill-frontmatter` now refuses that file (DW-613, resolved by 41.3).
  - `lib/provenance-inputs.mjs` runs `npm pack --dry-run --json --ignore-scripts --offline` on the 8 non-private packages and fails closed. Any tarball holding pack or adapted content must carry a byte-equal notice.
- **Adapting a skill (what 41.4 needs if it adapts).**
  - **Trigger:** any agent file whose text matches `/iris-agentic-dev/i` needs the header and a row, so even a mention counts.
  - **Header:** exactly `ADAPTATION_HEADER`, `Adapted from intersystems-community/iris-agentic-dev (MIT, © 2025 InterSystems Corporation); see IRIS-MCP-THIRD-PARTY-NOTICES.md`, as the first non-blank line after the frontmatter, never above it.
  - **Row:** in the notice table under `| Pack file | Source file at b6205bb | Adaptation |`, three non-empty cells with no `|`: ``| `skills/<name>/SKILL.md` | `skills/skills/<upstream-name>/SKILL.md` | <what changed> |``. The pack file is pack-relative, must exist in the pack and carry the header. The source is a plain relative path: letters, digits, `.`, `_`, `-` and `/` only, not absolute, no `..`, fragment or line suffix.
  - **Excluded sources** (`EXCLUDED_SOURCES`): a path ending `kb/ipm-module-authoring.md`, or with a segment `iris-objectscript-eval` (case-insensitive).
  - **Pins:** `UPSTREAM_COMMIT` is `b6205bbbad2f431ae14c34401fd55d85cb5d2305`, which the notice must contain; the MIT block is compared to `UPSTREAM_LICENSE_SHA256`/`UPSTREAM_LICENSE_BYTES`; `DISTRIBUTION_MARKER` (the ASCII header prefix) flags adapted content inside any tarball.
  - **Tests that react:** the header holds `©` and names `iris-agentic-dev` and a `.md` file, so the knowledge test's ASCII check and its hygiene classes ("a tool or server name", "a repository file") would flag that line; an adapted skill needs a documented exception for exactly that line, with a negative control. The knowledge test's "the notice still has no provenance row" goes red on the first row.
- **Checks today:**
  - `gen:pack:check`: `19 pack file(s)`.
  - `gen:skills:check`: `13 generated file(s)`.
  - `validate:prompts`: `45 source(s) checked (12 prompt(s) + 33 content file(s): 12 workflow, 17 pack, 3 knowledge, 1 rule), 111 known tool name(s)`.
  - `check:provenance`: `0 provenance row(s), 33 agent file(s), 8 distribution(s)`.
- **Pins that move as the pack grows.** Each knowledge `SKILL.md` adds one pack file, two agent files and two validator sources (one `knowledge:`, one `pack:`). Derive every new number from the CLI output (#51):
  - `19 pack file(s)`: `skills-pack-rule.test.ts:392`, `story-41-1-qa-pack-scratch-cli.test.ts:151` (and its `34` at `:319`);
  - validator lines: `story-41-1-qa-validate-prompts-pack.test.ts:49-52,60,146`; `3 knowledge` in `story-41-3-qa-knowledge-gate-process.test.ts:87`;
  - agent files: `story-41-1-qa-provenance-cli.test.ts:99` (33) and `:105,111` (35); `skills-pack-frontmatter.test.ts:352,373` (35);
  - `skills-pack-knowledge.test.ts`: its `SKILLS` table of typed oracles (sha256, name, description, code-block count, anchors), "are exactly the three planned skills", and "the probe anchors total 75: 22, 27 and 26".

  The workflow-count pins (12) read root `skills/` only. The prompt-count pins are 12, with dev at 4: `validate-prompts.test.ts`, `docs-prompt-sync.test.ts` (which also checks the README's "110 tools"), `skills-generated-frontmatter.test.ts` and `story-41-2-qa-prompts-stdio-wire.test.ts`.
- **Test helpers.** Pack fixtures use `pack-fixture.ts` (`makeTempRoot`, `put`, `runNode`, `REPO_ROOT`). CLI cases use `story-41-1-qa-fixture.ts` (`makeScratchRepo`, `runScript`, `toCrlf`, `BOM`) on a scratch copy, so the real tree is never written.
  - `agent-text-hygiene.ts` is the shared `FORBIDDEN` list (13 classes, each with a sample), `problemsOf` and `wordCount`, used by the rule tests and the knowledge test.
  - The knowledge test swaps two classes for skill text: "a path" becomes "a repository path" (a top-level repository entry plus `/`) and "an absolute path"; the number sign also accepts `#<n>:`. It adds "an internal rule number" and "a class or helper of this project". It scans after removing frontmatter line 2 and every pack skill name.
  - 41.3's files: `skills-pack-frontmatter.test.ts`, `skills-pack-knowledge.test.ts`, and QA's `story-41-3-qa-frontmatter-process.test.ts` and `story-41-3-qa-knowledge-gate-process.test.ts` (which runs the committed knowledge test in a child vitest with `cacheDir` kept in the scratch copy).
  - `skills-pack.test.ts` writes a temporary `zz-probe-skill` into the real `knowledge/`; this is safe only because `packages/iris-mcp-all/vitest.config.ts` sets `fileParallelism: false`.
- **Seams (#52).** Later stories extend `assemblePack` with new source kinds, `gatherProvenanceInputs` with new distributions, and `SKILL_FRONTMATTER_FIELDS` plus the grammar with new fields. They never re-touch the tree-sync helper or the pinned oracles.
- **AD-15.** The `objectscript-review` retirement is done (Story 41.2, decision #4). Any other change to an existing prompt's name, arguments or output needs a recorded decision.
- **AD-14.** A generated file changes only through its generator: `skills/`, the pack, and `skills/README.md` (a 12-row table). The installer-managed `.claude/skills/bmad-*` files are never touched. Write file content with the file tools, never a heredoc (#55).
- **AD-29.** Changesets stay `patch` or `minor`; 41.1, 41.2 and 41.3 used `minor` for `@iris-mcp/client-config`. No story runs `changeset version` or publishes. Each story adds a top `CHANGELOG.md` section, `## [Pre-release — YYYY-MM-DD] — Story 41.N: <title>`.
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
- **`gen:skills`** writes each `SKILL.md` with frontmatter: a `# DO NOT EDIT` comment naming `packages/<pkg>/src/prompts/*.ts`, then `name`, `description` (`JSON.stringify` output) and the `build({})` body. All 12 pass `skill-frontmatter`; `promote-environment-change`'s description holds `->`, which is why the tag rule is a tag pattern, not "no `<` or `>`". AC 41.5.4 must move that comment out of agent-visible text.
- **Missing today:** an `AGENTS.md` and a plugin manifest. The root `LICENSE` is MIT, © 2026 jbrandtmse.
- **`client-config` as it stands.**
  - **CLI.** The bin is `iris-mcp-clients`, with commands `detect`, `status`, `diff`, `apply`, `enable`, `disable`, `remove`, `restore` and `doctor`. Exit codes: 0 success, 1 operational failure, 2 usage error. With `--json` a command answers with one envelope, `{ok, command, data, error?}`. `apply` needs `--yes` or a TTY confirmation, else it exits 2.
  - **Adapters.** `adapters.ts` has 13 `CLIENT_ADAPTERS` and 3 `CLIENT_DISPOSITIONS` (`pi` excluded; `jetbrains-junie` and `kilo-code` on the roadmap): AC 41.6.1's "16 adapters". The data stamp is `ADAPTER_DATA_VERSION` `2026-07-28.1`.
  - **Engine.** `engine.ts` owns an entry by canonical name or by the `state.json` ledger.
  - **Writes.** `write.ts` `applyWrite` takes a `ClientAdapter` and re-parses as JSON, JSONC, TOML or YAML. Markdown and rule files need a variant of the protocol, not a reimplementation. Backups go to `<stateDir>/backups/<client>/<scope>/<file>.<ts>`. `readers.ts` strips a BOM before it parses, but the write path has no BOM handling.
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
  - The full `@iris-mcp/all` suite (about 115 files) runs in three foreground calls (`ls src/__tests__/*.test.ts | awk 'NR%3==k'`).
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
- **Skill descriptions** say what the skill covers, then when to load it. MCP prompt text keeps its user-facing role.

## Cross-Story Dependencies

- **41.1, 41.2 and 41.3 (done)** delivered the layout, `gen:pack`, the notice, the provenance check, the extended validator, the rule's two forms and markers, the prompt retirement, the three core knowledge skills, and the `skill-frontmatter` rule (DW-613 resolved). Every later story builds on these.
- **41.4** adds `skills-pack-src/knowledge/<name>/SKILL.md` under the same frontmatter rule and the same content-test pattern (typed oracles, anchors, sha256, hygiene), plus provenance rows for any adapted skill. It must pass `gen:pack:check`, `check:provenance` and `validate:prompts`, move the pins above, and count the 6–10 total.
- **41.5** does three things:
  - it adds the description field and regenerates the 12 workflow skills;
  - it replaces the pack `README.md` (superseding `skills/README.md`) with a generated catalog of the knowledge skills, workflow skills and rule;
  - it adds AC 41.5.4's preset-visibility and no-internal-references checks over all agent content. The preset declaration extends `SKILL_FRONTMATTER_FIELDS` and decides what "declares the preset it needs" means for a tool-free skill; the pack-wide check must accept `#<n>:`, `/noload/nodelete/norecursive` and the pack's own skill names.
- **41.6** reads `skills-pack/`, installs `skills/<name>/` owned by name, covers all 16 adapter rows, and appends the installer payload to `gatherProvenanceInputs`. It owns DW-616, the `AGENTS.md` marker-reading contract:
  - report, never guess, a missing, repeated or out-of-order own marker;
  - decide whether a BOM belongs to line 1;
  - end an unterminated last line before appending;
  - point the 41.2 consumer test at the real reader.
- **41.7** writes the root README section and the client-config README docs. Its capstone drives the CLI against a temporary project for every route, plus a one-time live Claude Code check that lists the installed skills, for which 41.2's procedure is reusable. It owns DW-611: test ordering and turbo inputs covering the pack sources, `scripts/`, client-config's `package.json`, `skills-pack/**` and `dist/`.
- **Downstream:**
  - 42.6 owns the publish-path gate (DW-612: `prepublishOnly` runs neither `gen:pack:check` nor `check:provenance`);
  - 42.8 roots the plugin at the pack, ignores `rules/`, and adds the plugin distribution;
  - 43.1 owns DW-617;
  - DW-622 (`SanitizeError` strips only English and Arabic prefixes; `src/ExecuteMCPv2/Utils.cls`) is routed to an Epic 41 burn-down if one is chartered.
