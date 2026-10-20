# Epic 41 Context: Companion Skills & Rules Pack

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Agents that write ObjectScript get the project's hard-won rules in three forms: one short, always-on pre-write checklist; 6–10 knowledge skills that the model loads when it needs them; and the workflow skills generated from the suite's MCP prompts. All three ship as one generated pack, `packages/client-config/skills-pack/`, and the `iris-mcp-clients skills install|uninstall` CLI of `@iris-mcp/client-config` puts it into each MCP client's native location. The competitor's MIT notice ships wherever adapted content ships. The pack is our own equivalent of the competitor's kit (intersystems-community/iris-agentic-dev), not a copy. Agents choose skills by their description, and MCP prompts are slash commands only a user can invoke, so shipping the content as skills is what lets agents actually find it. Stories 41.1–41.7 delivered the pack, the installer, the docs and the epic-done gate. The last story, 41.8, is the burn-down: one ObjectScript error-text fix (DW-622). Work happens on branch `epic41`; the wave branch is `feature/feature-wave-7-skills-pack`. Story 42.8's Claude Code plugin consumes the same pack later.

## Stories

- Story 41.1: Pack Layout, Licensing and Provenance (done)
- Story 41.2: Always-On ObjectScript Pre-Write Rule (done)
- Story 41.3: Core Knowledge Skills (done)
- Story 41.4: Platform Knowledge Skills (done)
- Story 41.5: Workflow Skills Refresh (done)
- Story 41.6: Skills and Rules Installer (done)
- Story 41.7: Skills Pack Docs and Capstone (done)
- Story 41.8: Epic 41 Burn-down (next)

## Requirements & Constraints

- **Precedence.** The spine binds every story. Where a story and the spine disagree, the spine wins and the story text is amended in place.
  - The run is unattended. The orchestrator decides escalations and records them in `_bmad-output/implementation-artifacts/orchestrator-decisions-wave-7.md`, which holds #1–#43:
    - #1–#34 (41.1–41.6): pack layout and notice; the rule's forms and markers; suite-prefixed, tool-free knowledge skills; the `skill` field and preset metadata; the installer's 17-row disposition table, four routes, project scope, manifest, preview, CLI shape and link refusal (#34);
    - **#15 (standing for the rest of Epic 41):** code review corrects any false or over-broad claim in agent content once a live probe or a read of the IRIS source confirms it, updating the source, the pack copy (via the generators), and the spec's golden text and sha256 values in the same pass;
    - #35–#42 (41.7 spec gate): `skills/README.md` becomes a generated pointer (#35); the per-client table is generated from `PACK_TARGETS` (#36); the root README section shape (#37) and retirement sentence (#38); the capstone in client-config (#39); turbo test tasks uncached (#40); the live-check procedure (#41); a `patch` changeset (#42);
    - **#43 (burn-down gate, 2026-10-20):** charter Story 41.8 with DW-622; DW-615 goes to the decision sheet as a user action item.
  - Both one-time live session checks have passed: AC 41.2.5 and AC 41.7.3 (2026-10-20).
- **Agent content is the product** (decisions #11, #15). A false or over-broad claim in a skill is a defect. Every changed or added IRIS claim is probed first. The golden text, its sha256 and the spec's change log move in the same pass.
- **What the pack holds (18 skills, 1 rule, 23 files).**
  - **Six knowledge skills,** all tool-free, so none declares a preset: `iris-mcp-objectscript-gotchas`, `iris-mcp-objectscript-error-handling`, `iris-mcp-objectscript-unit-tests`, `iris-mcp-objectscript-sql`, `iris-mcp-system-classes` and `iris-mcp-interoperability`. Each directory holds only `SKILL.md`.
  - **Twelve workflow skills,** generated from the prompts and keeping the prompt names. Presets: `core` for edit-and-test-class, find-patient-messages, provision-project-environment, recover-stuck-production, resend-failed-messages and trace-message-flow; `developer` for deploy-and-test-class, diagnose-slow-query and promote-environment-change; `full` for audit-security-posture, check-system-health and run-external-backup.
  - **One rule,** `iris-mcp-objectscript-pre-write` (16 bullets, no frontmatter, no tool), in three forms.
  - **Bytes.** The knowledge skills are ASCII and LF, except the SQL skill's adaptation header (a U+00A9). All 12 workflow skills hold non-ASCII. The installer copies bytes and never re-encodes them.
- **Known-wrong source claims (DW-615, decision-pending, `human=`).** The user decides; no story edits `.claude/rules/*`. Never carry these into agent content:
  - a typed MultiDimensional property compiles;
  - `%OnNew` `Private` is refused (`#5477`) only when the parent's `%OnNew` is public;
  - `$$$AssertNotTrue`, `$$$AssertStatusEquals`, `$$$AssertSuccess`, `$$$AssertFailure` and `$$$AssertSkipped` exist;
  - an empty abstract body compiles; `//` is a valid comment; `%` names are a convention, not a compile rule;
  - `ExecuteMCPv2.*` classes resolve in `%SYS` on this instance;
  - `Use dev::("")` leaves redirection on.
  - 41.4's probes add two facts for the user: embedded SQL compiles only when it first runs, and a `%SQL.Statement` result from a `%SYS` class query must be closed before switching back.
- **Story 41.5 delivered** (`ed18320`; DW-623 resolved): `PromptDefinition.skill?: { description, preset }` (`packages/shared/src/tool-types.ts`), read only by `gen:skills` and `validate:prompts` and never sent on the wire (16 golden stdio hashes); the generated `SKILL.md` shape; the first-of preset rule; the `[skill-field]`, `[preset]` and `[internal-reference]` checks; the exemption of the exact `ADAPTATION_HEADER` line.
- **Story 41.6 delivered** (committed `963b902`; DW-616 resolved).
  - **CLI.** `iris-mcp-clients skills install|uninstall --client <id> [--project <dir>] [--scope project] [--dry-run] [--yes] [--include-modified] [--json]` (`packages/client-config/src/cli/clients.ts`, `cmdSkills`). One `--client` from the 17 `PACK_TARGETS` ids; `claude-desktop` and `--scope user` exit 2. Exit codes: 0 success or nothing to change; 1 a conflict, an invalid manifest or pack, a rolled-back write, a declined confirmation, or a file changed since the preview; 2 a usage error. One confirmation helper, `confirmBeforeWrite`, shared with `apply`.
  - **Modules** (`packages/client-config/src/`): `pack-targets.ts` (`PACK_TARGETS`, `PACK_ROUTES`, `PACK_ROUTE_IDS`, `PACK_TARGETS_CHECKED_ON = "2026-10-19"`, `CLAUDE_DESKTOP_REFUSAL`), `rule-block.ts` (the DW-616 reader), `pack-plan.ts` (`loadPack`, `planPackChange`, `installerPayloads`, `MANIFEST_PATH`, `LINK_DETAILS`), `pack-apply.ts` (`executePackPlan`; backups under `<stateDir>/backups/skills-pack/<projectKey>/`). No installer module reads `process.*` or `os.homedir()`.
  - **Manifest** `.iris-mcp/skills-pack.json`: deterministic, allow-listed paths, refcounted clients; a pack-identical file is adopted, a user-edited one is `keep` unless `--include-modified`, a foreign file at an owned path is a conflict that refuses the run. A symbolic link at or above an owned path, or a second hard link, refuses the run (#34).
  - **Known limits** (CHANGELOG and client-config README): project scope only; no plugin detection; static duplicate-read notes; no parent-directory `CLAUDE.md`; linked paths refused; `--project ~` is not refused; backups never pruned; `core.autocrlf` makes committed installed files read as changed; an edit inside our block is replaced on the next install.
- **Story 41.7 delivered** (committed `fccc123`, code `4046924` and `0314a7c`; DW-611 and DW-624 resolved).
  - **Docs.** Root README `### The skills pack` inside `## Workflow Prompts & Agent Skills` (the four routes, the preview-then-install commands in the built-bin form `node packages/client-config/dist/cli/clients-cli.js skills …`, the presets-are-not-nested paragraph, five known limits); the retirement sentence, the prompts bullet, the manager-section pointer, the four server READMEs and `tool_support.md` link `#the-skills-pack`. The client-config README gains example commands, a Known limits bullet and a generated `## Skills pack targets (generated)` table (17 rows, `PACK-TARGETS-TABLE` markers, rendered by `render-certification-table.mjs`, roster guard exit 2, `--check`). `skills/README.md` is a generated pointer (still the 13th `gen:skills` file). The catalog says the presets are not nested.
  - **Capstone (the epic-done gate, #21).** `packages/client-config/src/__tests__/epic41-capstone-gate.test.ts`: 18 tests, one per `PACK_TARGETS` id (16 routed legs: install, aged re-install, uninstall to the byte; the claude-desktop refusal) plus completeness. Red on the built-bin path under MC-1 to MC-8 (#59). Companion: `qa-41-7-capstone-safety.test.ts` (backups, home holds only backups, plain host shapes).
  - **DW-611.** `turbo.json`: every `test` task has `cache: false`, and `@iris-mcp/all#test` depends on `build` and `@iris-mcp/client-config#build` (pinned by `story-41-7-turbo-test-graph.test.ts`). `scripts/lib/installer-payload-probe.mjs` runs `checkDistFresh` first, so `check:provenance` fails closed (`installer`) on a client-config dist older than its `src/`.
  - **Other pins.** `story-41-7-doc-claims.test.ts`, `skills-docs.test.ts`, `qa-41-7-doc-links.test.ts`, `qa-41-7-generated-table-gate.test.ts`.
  - **AC 41.7.3 live check: PASS** (lead, 2026-10-20; CLI `2.1.296`, haiku, USD 0.0132 total). The positive leg's init `skills` listed all 18 names, and `InstructionsLoaded` for the installed rule (`session_start`) came 10 s before the `.cls` `iris_doc_put` `PreToolUse`. The contrast leg (after uninstall) had neither, while the `PreToolUse` still fired. The iris-dev server pointed at a closed port and a hook denied the call, so there was no IRIS contact; `iris_doc_list` for `Probe417` was `[]`.
  - **Harvested to Epic 42:** DW-628 and DW-630 (42.1), DW-629, DW-631 and DW-632 (42.9).
- **Story 41.8 (next): Epic 41 Burn-down (DW-622).** The fix is ObjectScript, not pack content.
  - **The defect.** `ExecuteMCPv2.Utils:SanitizeError` (`src/ExecuteMCPv2/Utils.cls:124-195`) reads `$System.Status.GetErrorText(pStatus)` with no language (`:128`). It drops control characters, removes CR and turns LF into a space, strips caret references, and falls back to `An internal error occurred`. Then (`:179-193`) `For tPrefix = "ERROR #", "<Arabic word> #"` strips one prefix when the text starts with it and the chunk before the first `": "` is `1.N`. The Arabic word is a UTF-8 literal, U+062E U+0637 U+0623. Last comes `Quit $$$ERROR($$$GeneralError, tSafe)`. Text read as `ERREUR #5001: …` or `FEHLER #5001: …` keeps its prefix, so the result reads `ERROR #5001: ERREUR #5001: …`.
  - **The fix** (epics.md). Strip ONE leading localized prefix generically: a short word, then ` #`, digits and `: `. Never strip a `<TOKEN>`-style item. Pin one case per locale the instance has, taken from live `GetErrorText` output (#36), plus negative controls for text that only looks like a prefix. `ExecuteMCPv2.Utils` is bootstrapped, so the bootstrap moves in the same story (#24).
  - **Project rules.** #8: strip one leading `ERROR #N: ` (or localized) prefix before re-wrapping, and never strip `<UNDEFINED>`-style tokens. #9: propagate the real status text through `SanitizeError`. #13: don't infer locale from the prefix language, and strippers handle English and localized prefixes. #33: `SanitizeError` strips `^Name` caret tokens. The spine's "Error text" convention repeats #8, #9 and #33.
  - **What the instance has.** 15 system message tables: ar, de, en, en-us, es, es-cl, fr, it, ja, ko, nl, pt-br, ru, uk, zh-cn. The recorded probes are in `spec-41-3-core-knowledge-skills.md`:
    - probe-log row E7 (`Lang`, a disposable `ExecuteMCPv2.Temp.Probe413*` class): fr gives `ERREUR #5001: disk full`, de gives `FEHLER #5001: disk full`, and en and es give `ERROR`;
    - the QA stage's live run (CR2, disposable `ExecuteMCPv2.Temp.QA413*` classes) put the knowledge skill's `ErrorMessage` through all 15 tables, both with an explicit language and under each session language.
    - The prefix words of the other 10 tables were not recorded, and neither was whether any of them holds a space. Probe them before choosing the pattern.
  - **IRIS APIs** (read in `irislib/` by path; the folder is gitignored):
    - `%SYSTEM.Status` `GetErrorText(statuscode, language)`, `GetOneErrorText(statuscode, index, language)` and `GetOneStatusText(statuscode, index, language)` (the inner text, "without the error domain, id or source"), all in `irislib/%SYSTEM/Status.cls:77-94`;
    - `%Library.MessageDictionary` `GetLanguages(domain, flag)` (flag `"s"` lists the system languages), `GetSessionLanguage()` and `SetSessionLanguage(language)`, which returns the previous language (`irislib/%Library/MessageDictionary.cls:155,249,261`).
    - `SanitizeError` itself reads the session language. Message language is chosen per process: REST workers have rendered the Arabic prefix live (comments in `Diagram/Loader.cls` `CleanStatusText` and `analytics-cubes-wire-gate.test.ts:213-217`).
  - **Prior art.**
    - `ExecuteMCPv2.Diagram.Loader:CleanStatusText` (bootstrapped) strips up to three `<word> #<code>: ` prefixes for diagrams: `? .E1"#"1.AN` on the text before the first `": "`, length-gated at 44.
    - The error-handling knowledge skill cuts at the error's own code (`" #"_$Piece(GetErrorCodes(sc), ",")_": "`). It removes one prefix in any language and keeps `Order #12: ` and `see #5001: here`. Its draft shape-based strip had turned `see #12: here` into `here`.
  - **Existing tests.**
    - `src/ExecuteMCPv2/Tests/UtilsTest.cls` (30 `Test*`, 482 lines, close to the ~500-line cap, so new rows go in a new class): `TestSanitizeErrorOK`, `TestSanitizeErrorStripsDetails`, `TestSanitizeErrorStripsLeadingErrorPrefix` and `TestSanitizeErrorStripsArabicPrefix` (`$Char(1582,1591,1571)`). The last two assert only that the `#5001` count is stable across two passes, never the exact text.
    - Also: `CommandTest.cls:141,152` (caret strip, OK pass-through); `ClassMethodEdgeTest.cls:162-170` (`<DIVIDE>` survives, never `ERROR #5001: ERROR #`); `DiagramLoaderTest.cls` pins `CleanStatusText`.
    - No TS test pins `SanitizeError`'s output. `test-production-guard.test.ts:450-451` needs only that the method `ExecuteMCPv2.Utils.SanitizeError` exists.
  - **Bootstrap.**
    - `scripts/gen-bootstrap.mjs` `classes[]` lists 35 classes, with `ExecuteMCPv2.Utils.cls` first and `REST/Dispatch.cls` last. `pnpm gen:bootstrap` prints `BOOTSTRAP_VERSION: <hash>` (a 12-hex sha256 of the LF-normalized class texts) and writes only on a change; a second run prints `Unchanged … (not rewritten)`.
    - Today's version is `5296a1c836f4` (`packages/shared/src/bootstrap-classes.ts:25`). The drift tests in `packages/shared/src/__tests__/bootstrap.test.ts` compare the embed and the hash with the disk; the 35-class count is at `:1095`. Rebuild shared afterwards.
    - `changelog-bootstrap-move.test.ts` requires the newest CHANGELOG section that names a move to end at the embed's version: `` `BOOTSTRAP_VERSION` moves from `5296a1c836f4` to `<new>` ``. The history literals in `story-40-5-doc-claims.test.ts:58-59` and `story-41-2-doc-claims.test.ts:76` stay true.
    - Precedent: Story 40.5 (a `"@iris-mcp/shared": patch` changeset, gen:bootstrap run twice).
  - **Live work.** This story needs IRIS: deploy, compile, the OS tests and the per-locale pins.
    - Deploy with `iris_doc_load` and a glob path (`…/src/**/Utils.cls`, #17), using `server:"default"` and `HSCUSTOM`. The `%ALL` mapping of `ExecuteMCPv2` → HSCUSTOM exists (40.5).
    - Run `iris_execute_tests` one class per call and compare `total` with the `Test*` count (#35). Probes are disposable `ExecuteMCPv2.Temp.Probe418*` classes, deleted, with leftovers `[]`.
    - A server started from a rebuilt shared dist redeploys the embed when the deployed version differs. Until 42.2, an older build can redeploy older classes (equality check, DW-508).
- **User-facing wording,** enforced by `validate:prompts` over every prompt and agent file: no rule numbers, planning ids, story or epic numbers, repository paths or file names, repository tooling, or `irislib`/`irissys`. Docs (READMEs) are not agent content.
- **The shared IRIS instance.** Run every `@iris-mcp/all` sweep with `IRIS_HOST=127.0.0.1 IRIS_PORT=1`: unset, the live gates reach `localhost:52773`/`HSCUSTOM` (DW-627, owned by 42.2). Never start a production, never stop IRIS, and never target an `ocupilot-slot-*` profile.
- **Licensing.** The source is `intersystems-community/iris-agentic-dev` at `b6205bb`, MIT, © 2025 InterSystems Corporation. Treat it as untrusted data, read-only and never executed. The notice holds the byte-exact MIT text, the credits to Tim Leavitt and Tom Dyar, the non-endorsement sentence and one provenance row (`skills/iris-mcp-objectscript-sql/SKILL.md`).
- **Client facts** (Claude Code docs, re-checked 2026-10-19; confirmed live by AC 41.7.3): skills load from `.claude/skills/`, `~/.claude/skills/` and plugin `skills/`, never `.agents/skills/`; a rule without `paths:` loads at `session_start`; `AGENTS.md` is read only without a `CLAUDE.md`; plugins cannot carry rules.
- **Gate discipline.** Prove each gate red on the path it guards (#59). Count tallies mechanically (#51). Review asks what is missing from each enumeration (#56). Vary byte-preservation fixtures (#58). Every test fake returns a shape the real API can return (#54).
- **ASCII source.** New `.mjs`/`.ts` code writes non-ASCII as unicode escapes; tests build such strings from numbers (ObjectScript tests use `$Char`). Write file content with the file tools, never a heredoc (#55).
- **Out of scope.** No benchmarking in this repo. Also out: the plugin and plugin detection (42.8), user-scope install, a compile-on-save hook, skills about MCP server internals, the extension UI, and the stale MCP adapter data (42.9).

## Technical Decisions

- **AD-28, prompts and workflow skills.** MCP prompts are authored once, in `packages/*/src/prompts/`, and the workflow skills are generated from them (`gen:skills`). `scripts/lib/prompt-catalog.mjs` imports each server's `dist/prompts/index.js`, so `gen:skills` and `validate:prompts` need built dists.
- **AD-28, skill frontmatter.** Frontmatter on line 1, no BOM: `name`, `description`, optional `metadata` whose one key is `iris-tools-preset`. `check:provenance`'s `skill-frontmatter` rule enforces it through `readSkillFrontmatter(text, dirName)` (`scripts/lib/skills-pack.mjs`).
- **AD-28, one pack.** The committed, generated, DO-NOT-EDIT `packages/client-config/skills-pack/`: only `pnpm gen:pack` writes it, and `gen:pack:check` fails on any MISSING, DRIFT or STRAY file. It ships through client-config's `files` and is read by the installer at `DEFAULT_PACK_DIR`.
  - **Installer routes.** `claude-code`: `.claude/skills/` and `.claude/rules/`; `cursor`: `.agents/skills/` and `.cursor/rules/<name>.mdc`; `gemini`: `.agents/skills/` and a block in `GEMINI.md`; `agents`: `.agents/skills/` and a block in `AGENTS.md` (every other client, VS Code / Copilot included). Claude Desktop has no route. Until the plugin exists (42.8, DW-625), the Claude Code route installs both skills and rule.
- **AD-30, installer writes.** Validate → timestamped backup → edit → read back → auto-restore on failure, with the preview before confirmation. Only owned files and marked blocks are written, and re-install is idempotent.
- **Conventions.** "Pack names" (`iris-mcp-<name>`; generated workflow skills keep their prompt names); "Marked blocks" (`<!-- IRIS-MCP-RULE:<name>:BEGIN|END -->`, owned whole, everything outside preserved byte for byte); "Turbo test tasks" (new in 41.7: `test` is never cached, and a cross-package build need is a `pkg#task` `dependsOn` edge, never a package dependency); "Error text" (strip one leading `ERROR #N:` prefix, English or localized, before re-wrapping; propagate the real status through `SanitizeError`; name a global without its caret).
- **AD-14, bootstrap and generated files.**
  - The IRIS-side classes ship embedded in `@iris-mcp/shared` (`bootstrap-classes.ts`, output-only).
  - A change to a bootstrapped class regenerates the embed in the same story and moves `BOOTSTRAP_VERSION`. A new class joins both rosters; `ExecuteMCPv2.Tests.*` never does.
  - A generated file changes only through its generator. Never touch the installer-managed `.claude/skills/bmad-*` files.
- **AD-15.** An additive field is non-breaking; a change to an existing prompt's name, arguments, description or output needs a recorded decision.
- **AD-29.** Changesets stay `patch` or `minor`. No story runs `changeset version` or publishes. Each story adds a top `CHANGELOG.md` section, `## [Pre-release — YYYY-MM-DD] — Story 41.N: <title>`, with Added, Changed, Tests and Known limits, plus a paragraph on which counts moved and which did not.
- **Counts.** Tools 110 package / 115 advertised; the 12 prompts are byte-identical on the wire (16 hashes); governance baseline `1e62c5ad5bf7`/141; 35 bootstrapped classes; `BOOTSTRAP_VERSION` `5296a1c836f4` until 41.8 moves it.
- **Checks today** (tool output, #51):
  - `gen:pack:check`: 23 pack files;
  - `gen:skills:check`: 13 generated files;
  - `validate:prompts`: 52 sources (12 prompts + 40 content files), 111 known tool names; 24 files declare a preset, 16 none; 2 adaptation header lines exempted;
  - `check:provenance`: 1 provenance row, 40 agent files, 12 distributions;
  - the catalog: 12210 bytes, 49 lines, sha256 `e4e2e800…`.
- **Running checks.**
  - `gen:skills`, `validate:prompts` and `check:provenance` need built dists of shared, the five servers and client-config.
  - Run pack tests standalone with `pnpm --filter @iris-mcp/all exec vitest run <files>`. The full `@iris-mcp/all` suite (126 files) runs in three foreground slices (`ls src/__tests__/*.test.ts | awk 'NR%3==k'`), each with `IRIS_HOST=127.0.0.1 IRIS_PORT=1`. The last full run: 2425 passed, 649 skipped, 0 failed; client-config 37 files, 1008 passed.
  - Never run the bare governance-baseline generator (#25).

## Cross-Story Dependencies

- **41.1–41.7 (done)** delivered the pack, `gen:pack`, the notice and the provenance check; the rule and the prompt retirement; six knowledge skills; the `skill` field, workflow skills, catalog and checks; the installer and its manifest; the docs, the generated targets table, the capstone and the turbo fix.
- **41.8** touches only `src/ExecuteMCPv2/Utils.cls`, its ObjectScript tests, the regenerated embed, the CHANGELOG and a changeset. It needs no pack, installer or docs change. It closes DW-622 and makes Epic 41 ready to close.
- **Downstream:**
  - 42.1: DW-628 (the npx form passes `iris-mcp-clients` as the command, with no `@1` pin) and DW-630 (client-config's stale `package.json` description);
  - 42.2: DW-627 (live-gate opt-in) and the bootstrap downgrade guard (DW-508);
  - 42.6: the publish-path gate (DW-612);
  - 42.8: the plugin rooted at the pack, and DW-625;
  - 42.9: DW-626 (stale adapter data), DW-629 (the cursor and vscode `why` text), DW-631 (the broken anchors in `docs/client-config/*`, plus a pointer to the installer) and DW-632 (widen the doc-links check repo-wide);
  - 43.1: DW-617.
- **Open ledger items:** DW-622 is routed to `41-8-epic-41-burn-down`. DW-615 (decision-pending, `human=`) goes to the user's decision sheet, and no story edits `.claude/rules/*`.
