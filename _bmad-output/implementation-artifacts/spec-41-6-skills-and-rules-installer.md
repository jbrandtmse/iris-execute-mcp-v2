---
title: 'Story 41.6: Skills and Rules Installer'
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
deferred:
  - summary: 'The Claude Code route installs the skills even when the plugin is present (AD-28 Duplicates): there is no plugin yet to detect.'
    evidence: 'No `.claude-plugin/plugin.json` exists in the repository or the pack (Story 42.8 creates the plugin). A detection branch now could never be reached (project rule #54). Route to Story 42.8, which owns the plugin and must make the claude-code route of `iris-mcp-clients skills install` install the rule only when it detects the plugin.'
    location: 'packages/client-config/src/pack-plan.ts (claude-code route)'
    severity: 'med'
  - summary: 'The MCP adapter data in adapters.ts is stale against the clients'' docs read on 2026-10-19.'
    evidence: 'Pi has had MCP built in since 0.99.0 (2026-09-29; `~/.pi/agent/mcp.json`, `.pi/mcp.json`). Kilo Code configures MCP through the `mcp` key of `kilo.json[c]`. JetBrains Junie documents `.junie/mcp/mcp.json`. These three are still dispositioned excluded or roadmap. Kimi CLI is archived (Kimi Code replaces it), Roo Code shut down on 2026-05-15, and Windsurf was renamed Devin Desktop on 2026-06-02. Goose docs moved to goose-docs.ai, and the adapter docsUrl returns 404. All of this is outside this story: the MCP roster, ADAPTER_DATA_VERSION and certification.'
    location: 'packages/client-config/src/adapters.ts:579-601, :480'
    severity: 'med'
---

<intent-contract>

## Intent

**Problem:** The skills pack (18 skills and one always-on rule) ships inside `@iris-mcp/client-config`, but nothing puts it where a client loads it. Today a user has to copy the files by hand, so nothing tracks what was copied. Nobody can update the files safely, remove them, or keep a user's own `AGENTS.md` intact. The `AGENTS.md` marker-reading contract that Story 41.2 defined exists only as a test-local reader (DW-616).

**Approach:**

- **A data-driven disposition table.** It covers all 16 adapters and a generic `agents` row, each with a source. It maps every client that has a route (all but Claude Desktop) onto one of four routes:
  - `claude-code`: `.claude/skills/` and `.claude/rules/`;
  - `cursor`: `.agents/skills/` and `.cursor/rules/*.mdc`;
  - `gemini`: `.agents/skills/` and a block in `GEMINI.md`;
  - `agents`: `.agents/skills/` and a block in `AGENTS.md`.
- **A byte-exact installer** in `packages/client-config`:
  - it plans a change first and previews it as a dry-run diff, then writes only after the confirmation `apply` uses;
  - it writes under the AD-30 protocol (backup, write, re-read, restore on failure), keeps a per-project manifest of the paths and hashes it owns, and uses the real marker reader for the `AGENTS.md`/`GEMINI.md` block;
  - it puts the notice beside every installed copy of adapted content.
- **The CLI.** It is exposed as `iris-mcp-clients skills install|uninstall`.
- **Pack and provenance changes.** `gen:pack` gains a Cursor rule form, and `check:provenance` checks each route's installer payload.

## Boundaries & Constraints

**Always:**

- **Bytes, never text.** Every pack file is installed as a byte-exact copy, with `metadata` and frontmatter intact. A user's block host (`AGENTS.md`, `GEMINI.md`) is read and written as bytes. Its bytes outside the owned block stay byte-identical, including a UTF-8 BOM at byte 0, CRLF, invalid UTF-8, comments and foreign blocks. The one exception is the line ending the installer adds to an unterminated last line, which it records and removes again on uninstall.
- **Preview first.** A write happens only after a dry-run diff of the planned change and a confirmation: `--yes`, or a TTY prompt. A non-TTY run without `--yes` writes nothing and exits 2, exactly like `apply`. `--dry-run` writes nothing.
- **Ownership (AD-30).** The installer writes only these: files recorded in the project manifest, files adopted because they are byte-identical to the pack, the marked blocks, the manifest itself, and the directories it creates.
  - A file at an owned path that the installer did not install is a conflict, and nothing is written.
  - An owned file whose hash no longer matches the manifest is kept, unless `--include-modified` (the explicit confirmation). Then it is backed up first.
  - An own marker that is missing, repeated or out of order is reported with its line numbers, never guessed at, and nothing is written.
- **Idempotent.** Re-running an install that would change nothing writes no file, takes no backup and leaves the manifest bytes unchanged. Install followed by uninstall leaves every pre-existing host file byte-identical to before. Created files and created directories are removed.
- **The notice.** `IRIS-MCP-THIRD-PARTY-NOTICES.md` is written beside every installed file that carries adapted content: in its directory, byte-equal to the pack's notice.
- **The pack modules are portable.** `pack-targets.ts`, `rule-block.ts` and `pack-plan.ts` import only `node:*` built-ins, type-only imports and each other, plus `adapters.ts` for display names. They never import the JSON/TOML/YAML engine, so the provenance probe can import the built `pack-plan.js` from a scratch root that has no `node_modules`.
- **Injectable.** Every module takes `{platform, env, homeDir, projectDir, stateDir?}` and an fs. No installer module reads `process.*` or `os.homedir()`.
- **Source text.** ASCII source, with any non-ASCII byte written as a numeric escape (Rule 14). Files are written with the file tools, never a heredoc (#55). The pack changes only through `pnpm gen:pack` (AD-14).

**Never:**

- **Files the installer never writes.** It never writes or edits `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `.github/copilot-instructions.md`, `.github/instructions/`, any client settings file, or anything outside the owned paths and blocks. It never prints the bytes of a user file outside the owned block, or the content of a file the user modified.
- **Test boundary.** Tests and probes write ONLY under OS temp directories they create and delete, through the injected `homeDir`, `projectDir`, `stateDir` and fs. They never write to the real repository root (`.claude/rules/*`, `.claude/skills/*`, `CLAUDE.md`, `AGENTS.md`, `.agents/`, `.cursor/`, `GEMINI.md`, `.iris-mcp/`) or the real `$HOME` (`~/.claude`, `~/.cursor`, `~/.codex`, `~/.agents`, `~/.iris-mcp`). A test fails if any path the installer touches, defaults included, resolves outside the injected roots.
- **Other surfaces.** No change to any MCP tool, action, governance key, preset roster, refusal code, route or bootstrapped class. The CLI is not an MCP tool, so the tool counts stay at 110 package and 115 advertised.
  - Nothing changes in `adapters.ts` records, `ADAPTER_DATA_VERSION`, the certification table, any prompt, the knowledge skill or rule sources, or the notice.
  - The existing commands' behavior and messages are unchanged. The help text only gains the `skills` lines.
- **Other stories.** No user-scope install. No plugin detection (42.8). No root-README pack section, no README rendering of the disposition table, no every-client CLI capstone, no live Claude Code check, and no DW-611 turbo ordering (all 41.7).
- **Files not to edit:** `.claude/rules/*`, `CLAUDE.md`, the spine, `epics.md`, `irislib/`, `irissys/`, `src/` (ObjectScript), the installer-managed `.claude/skills/bmad-*`, generated `skills/`, the root `README.md`, and earlier `CHANGELOG.md` sections.
- **IRIS and git.** No IRIS call. No `git commit`, `git push`, `git reset` or `git rebase`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Install, claude-code (Integration: CLI) | Empty temp project; `skills install --client claude-code --yes` | Exit 0. 18 `.claude/skills/<name>/SKILL.md` byte-equal to the pack. `.claude/skills/iris-mcp-objectscript-sql/IRIS-MCP-THIRD-PARTY-NOTICES.md` byte-equal to the pack notice. `.claude/rules/iris-mcp-objectscript-pre-write.md` byte-equal to `rules/claude-code/…`. `.iris-mcp/skills-pack.json` exists. No other path is created | No error expected |
| Install, agents / cursor / gemini | Same, `--client codex` / `cursor` / `gemini` | Each run writes `.agents/skills/` (18 skills and the notice beside the SQL skill) and the manifest. Codex adds `AGENTS.md` = the `rules/agents-md/` form bytes (no BOM). Cursor adds `.cursor/rules/iris-mcp-objectscript-pre-write.mdc` = the `rules/cursor/` form bytes. Gemini adds `GEMINI.md` = the `rules/agents-md/` form bytes | No error expected |
| Dry run | `--dry-run` on any state | The plan is printed (one `<change> <path>[ (<detail>)]` line per path, the counts, the notes) and the tree is byte-identical afterwards. Exit 0, or 1 when the plan has a conflict | Nothing written |
| Idempotent | Install, then the same install again | Second run: every item `unchanged`, the line `Nothing to change for <client>: the skills pack is already installed.`, exit 0, no write, no new backup, manifest bytes unchanged | No error expected |
| Host fixtures (Rule #58) | An existing `AGENTS.md` (and `GEMINI.md`) that is: LF; CRLF; BOM+LF; BOM+CRLF; with no final newline (LF and CRLF); whitespace-only; empty; holding HTML comments and a look-alike marker; holding another rule's block and another tool's `<!-- BEGIN x -->` block; with non-ASCII and invalid UTF-8 bytes; with our block first after a BOM, in the middle, last, or the whole file | Install: bytes outside our block identical, and the block equals the form bytes. A missing final line ending is added in the file's own style (CRLF if the file holds `\r\n`) before the block. A BOM stays at byte 0. Uninstall: exactly the original bytes | No error expected |
| Ambiguous own markers (DW-616) | Two of our sections; BEGIN without END; END without BEGIN; two BEGIN lines and one END; one BEGIN and two END; END before BEGIN | `conflict  AGENTS.md (the <stem> markers are not one BEGIN line followed by one END line: BEGIN at line(s) <list or none>, END at line(s) <list or none>; fix them by hand, then re-run)`. Exit 1 on install, uninstall and dry-run | Nothing written |
| Look-alike lines | Indented, trailing blank, other case, other rule name, inline in a sentence, after a BOM on a line other than line 1 | Not markers: the reader reports `absent` (or our one real block) | No guess |
| Foreign file at an owned path | `.claude/skills/deploy-and-test-class/SKILL.md` holding the user's own bytes, with no manifest record | `conflict … (exists, and this installer did not install it; move or delete it, then re-run)`. Exit 1 | Nothing written |
| Adopt | A file byte-identical to the pack at its owned path, with no manifest record | `adopt` (no write). The manifest records it | No error expected |
| User-edited owned file | An installed `SKILL.md` edited by the user | Install and uninstall: `keep … (changed since it was installed; --include-modified replaces it / removes it)`. With `--include-modified`, it is replaced or removed after a backup under `<stateDir>/backups/skills-pack/` | No error expected |
| Pack update | Install from pack A, then from pack B (a scratch pack with one skill dropped and one changed) | The dropped skill's owned files are removed (`no longer in the skills pack`), the changed skill is updated, everything else is `unchanged` | No error expected |
| Shared paths | Install `codex`, then `cursor`; uninstall `cursor` | `.agents/skills/` and the `AGENTS.md` block stay (codex still owns them). `.cursor/rules/…mdc` is removed. The manifest drops `cursor` | No error expected |
| CLAUDE.md (AC 41.6.3) | A project with `CLAUDE.md` (or `.claude/CLAUDE.md`, `CLAUDE.local.md`); `--client claude-code` | The rule goes to `.claude/rules/`. The note `N-claude-md` (Design Notes) is printed in the preview and the result. `CLAUDE.md` is byte-identical and never opened for writing | No error expected |
| AGENTS.md shadows CLAUDE.md | A project with `CLAUDE.md` and no `AGENTS.md`; `--client codex` | Note `N-first-match` (Zed, Kilo Code, Pi), in the preview before confirmation | No error expected |
| Usage errors | No action, unknown action, `--client` missing or unknown, `--client claude-desktop`, `--scope user`, `--project` not a directory, an extra positional, non-TTY without `--yes` or `--dry-run` | Exit 2, with `Error: <message>` and the usage line on stderr. `claude-desktop` prints its no-route reason | Nothing written |
| Write failure | An fs that throws on the k-th write | Every path changed in this run is restored (reverse order) and created paths are removed. Exit 1, naming the path and the cause. The manifest is not written | The tree is byte-identical to before |
| Changed since preview | A planned path's bytes change between plan and execute | `<path> changed after the preview; nothing was written; re-run the command`. Exit 1 | Nothing written |
| Invalid manifest | `.iris-mcp/skills-pack.json` that is not JSON, has the wrong shape or an unknown `schema`, or names a path outside the installer's locations (`../x`, `/abs`, `src/a.ts`) | `the installer's record .iris-mcp/skills-pack.json is not valid (<why>); fix or delete it, then re-run`. Exit 1 | Nothing written or deleted |
| Provenance (Integration: check) | `pnpm check:provenance` on the real tree | Exit 0. The line ends `1 provenance row(s), 40 agent file(s), 12 distribution(s).`: the 8 npm packages plus `installer:claude-code`, `installer:cursor`, `installer:gemini` and `installer:agents` | Payload without the notice beside the adapted skill: `[distribution] installer:<route>: the installed copy <path> carries adapted content but no IRIS-MCP-THIRD-PARTY-NOTICES.md beside it equal to the canonical notice`, exit 1. client-config not built: `[distribution] installer: …`, exit 1 |
| 41.2 consumer (Integration) | `story-41-2-qa-agents-md-consumer.test.ts` | All rows run against the installer's real `locateRuleBlock`/`withRuleBlock` from the built dist, with no test-local reader | The test fails loudly when the client-config dist is stale |
| Never boundary | Install and uninstall for each route through a jailed fs rooted at the temp directory, with `stateDir` left unset | Every touched path, including the default `<homeDir>/.iris-mcp/client-manager` backups, is inside the temp root | The jail throws, so the test is red |

</intent-contract>

## Code Map

**client-config, as it is (reuse; see the REUSE verdicts in Design Notes):**

- `packages/client-config/src/cli/clients.ts`:
  - `:110-129` `CliDeps`, `:150-166` `resolveDeps` (`projectDir = process.cwd()`), `:169-177` `hostContext`;
  - `:318-332` `VALUED_OPTIONS`, `:334-367` `parseArgs`, `:375-392` `helpRequested`, `:399-409` `emitJson` (private);
  - `:441-534` `buildHelpText`, `:540-549` `adapterFor`, `:551-555` `scopeFor`, `:573-576` `usageError`, `:581` `isFailure`;
  - `:1004-1146` `APPLY_USAGE`/`cmdApply`. Its confirmation gate is `:1071-1086`. Its exact messages are `apply needs confirmation before writing and this is not an interactive terminal; re-run with --yes to accept the previewed changes`, `Aborted; no changes were written.` and the envelope error `confirmation declined`;
  - `:1773-1812` `runCli`, with the dispatch `switch` and the valid-commands string at `:1808`.
- `packages/client-config/src/write.ts`:
  - `:38-57` `WriteFs`/`REAL_WRITE_FS` (utf8 strings only, `remove` handles files only);
  - `:299-301` `stamp` (private; ISO with `:` and `.` turned into `-`), which `listBackups`' regex `:460-477` relies on;
  - `:333-431` `applyWrite`, the six-step protocol, string- and adapter-bound (it pre-parses and re-parses through `readConfigEntries` at `:349`/`:405`). It imports `jsonc-parser`/`yaml` (`:30-31`).
- `packages/client-config/src/state.ts:65-69` `resolveStateDir(ctx)` (default `<homeDir>/.iris-mcp/client-manager`). It has only type imports plus `node:path`, so it is safe to import.
- `packages/client-config/src/adapters.ts:34-573` `CLIENT_ADAPTERS` (13), `:579-601` `CLIENT_DISPOSITIONS` (3). It has type-only imports, so it is safe to import from the pack modules.
- `packages/client-config/src/types.ts:154-160` `HostContext`. `src/index.ts` holds the export list; no test pins it.
- `packages/client-config/package.json`: `files` = `dist`, `!dist/**/__tests__`, `skills-pack`. `tsconfig` `rootDir: src`. A module in `src/` reaches the pack at `new URL("../skills-pack/", import.meta.url)` from both `src/` and `dist/` (precedent: `scripts/render-certification-table.mjs:25`).
- `packages/client-config/README.md:15-64`: the CLI section and its command block (`:31-39`), which is hand-maintained and unpinned.

**Pack and scripts:**

- `scripts/lib/skills-pack.mjs`:
  - `:1-33` the header (layout, "each rule's two forms");
  - `:50-53` `RULE_FORM_DIRS`, `:59` `ALWAYS_ON_RULE_FILENAME`;
  - `:124-129` `agentsMdMarkers`, `:140-148` `renderAgentsMdSection`;
  - `:195-201` `catalogRuleLine`, `:211-247` `renderPackReadme` (the Layout lines `:232-237`);
  - `:515-530` the `assemblePack` doc, `:607-637` the rules loop (forms emitted at `:633-634`), `:661-694` `listAgentContentFiles` (`.md` only, at `:663`).

  It must keep exactly its three imports.
- `scripts/gen-pack.mjs:4-8` (header prose), `:68` (`… ${n} pack file(s) match their sources, no drift.`).
- `scripts/lib/provenance-inputs.mjs`:
  - `:1-9` the header, which already says "Stories that add a distribution (the installer payload, the plugin) append it";
  - `:20` `PACK_SHIPPING_PACKAGES`, `:57-95` `gatherDistribution`, `:103-135` `gatherDistributions`, `:144-158` `gatherProvenanceInputs` (sync, `options.runNpmPack` injectable).
- `scripts/lib/provenance-core.mjs`:
  - `:47` `DISTRIBUTION_MARKER`, `:80` `PACK_PATH_IN_PACKAGE`;
  - `:228-236` the `ProvenanceInputs` typedef;
  - `:323-354` the `distribution` rule (the notice present anywhere in a distribution).
- `scripts/check-provenance.mjs:59-62` (the OK line).

**Tests to follow (client-config `src/__tests__/`):**

- `engine-e2e.test.ts:76-101` (built dist by `pathToFileURL` after `checkDistFresh`; `mkdtempSync` sandbox with `home/`, `proj/`, `state/`);
- `clients-cli-process.test.ts:60-128` (the built bin, `spawnSync` with a from-scratch env: HOME/USERPROFILE/APPDATA, `cwd: project`), `:298-403` (exit matrix);
- `clients-cli.test.ts:56-78` (harness), `:115-120` (valid-commands `toContain`), `:159-183` (`VALUED_OPTIONS` source scan: `parseArgs(args|rest, […], […])`), `:185-206` (the no-parser/no-edit-logic scan of `clients.ts` and `clients-cli.ts`, with its `modify(` regex);
- `byte-preservation.test.ts` (non-canonical inline fixtures, byte oracles), `golden.test.ts` (remove equals the initial bytes), `helpers.ts` (`MemFs`, `fixedNow`).

**iris-mcp-all tests that move** (all under `packages/iris-mcp-all/src/__tests__/`):

- `story-41-2-qa-agents-md-consumer.test.ts`:
  - `:27-37` imports; `:48-96` `linesOf`/`locateBlock`/`replaceBlock` (to delete); `:307-310` `endLine` (to delete);
  - `:286-303` missing/repeated rows; `:305-335` append rows, including "no final newline puts BEGIN inside the last line", which inverts;
  - `:137-142` its hard-coded two-form list.
- **The pack count 22 → 23:** `skills-pack.test.ts:452`, `skills-pack-rule.test.ts:392`, `story-41-1-qa-pack-scratch-cli.test.ts:151`.
- **Exact pack key lists:** `skills-pack.test.ts:63-72`, `:358-366`, and its README fixtures `:134-139` (`README_LAYOUT`) and `:148-149` (`ruleLine`).
- **The catalog golden:** `skills-pack.test.ts:476-480` (11648 bytes, 48 lines, `bdd1b54f…`). `:482-496` stays one "Its Claude Code form" rule entry.
- **The forms tests:** `skills-pack-rule.test.ts:96-138` ("exactly these two forms") and `:278-285`; `story-41-2-qa-rule-text-hygiene.test.ts:38-39`; `story-41-5-qa-fixture.ts:160` (`["agents-md","claude-code"]`) and `story-41-5-qa-preset-oracle.test.ts:129-132`.
- **Agent files 39 → 40:** `story-41-1-qa-provenance-cli.test.ts:99,105`, `story-41-4-qa-first-row-process.test.ts:93,170`, `skills-pack-frontmatter.test.ts:504`.
- **`validate:prompts` lines 1 and 2:**
  - `validate-prompts.test.ts:386,661,662`;
  - `story-41-1-qa-validate-prompts-pack.test.ts:49,52,60,126-130`;
  - `validate-prompts-pack-checks.test.ts:49,190-195,241,288`.
- **Distributions:**
  - `pack-provenance.test.ts:595-625` (names equal the publishable packages at `:603`; `mustShipPack` at `:622`);
  - the scratch-root counts `"1 distribution(s)"`/`"2 distribution(s)"` at `story-41-1-qa-provenance-cli.test.ts:99,105,303`, `story-41-4-qa-first-row-process.test.ts:93` and `skills-pack-frontmatter.test.ts:504`. Those roots use `makeScratchRepo({ clientConfigManifest: true })`, which copies client-config's `package.json` and `dist/` (`story-41-1-qa-fixture.ts:42-57`);
  - `story-41-1-qa-provenance-cli.test.ts:341-362` removes the scratch dist (its problem list gains the `installer` row).
- `pack-fixture.ts` (`REPO_ROOT`, `makeTempRoot`, `put`, `runNode`); `story-41-1-qa-fixture.ts` (`makeScratchRepo`, `runScript`, `problemPairs`, `toCrlf`, `BOM`, `treeLines`).

**Docs:**

- `packages/client-config/README.md:31-39` and `:41-64`;
- `CHANGELOG.md:5` (the newest section is 41.5, in the house style with a "counts that did not move" paragraph);
- `.changeset/story-41-5-workflow-skills-refresh.md` (the precedent);
- `skills-pack-src/README.md:10,43-50` ("two forms").

## Tasks & Acceptance

**Execution:**

- `scripts/lib/skills-pack.mjs` -- D2 (AD-28, AD-14). Add the Cursor form, keeping the three imports:
  - **Constants.** `RULE_FORM_DIRS.cursor = 'rules/cursor'`, and `RULE_FORM_EXTENSIONS = Object.freeze({ claudeCode: '.md', cursor: '.mdc', agentsMd: '.md' })`.
  - **Helpers.** `ruleFormPath(form, stem)`, `CURSOR_RULE_FRONTMATTER = '---\nalwaysApply: true\n---\n\n'`, and `renderCursorRule(bytes)` = that prefix followed by the source bytes, never decoded.
  - **Emission.** Emit `rules/cursor/<stem>.mdc` after `:633`.
  - **Agent files.** `listAgentContentFiles` also takes `.mdc` (the filter at `:663`), so the form is scanned by `validate:prompts` and `check:provenance`.
  - **Catalog.** `catalogRuleLine` and the Layout lines get the golden text (Design Notes).
  - **Docs.** Update the header and `assemblePack` doc comments (three forms).
- `scripts/gen-pack.mjs`, `skills-pack-src/README.md` -- prose only: three forms. Then run `pnpm gen:pack`. The pack goes from 22 to 23 files, and the README is regenerated; record its new byte count, line count and sha256.
- `packages/client-config/src/pack-targets.ts` (new, data) -- AC 41.6.1, D1, D3, D9.
  - **Types.** `PackRouteId = 'claude-code'|'cursor'|'gemini'|'agents'`. `PACK_ROUTES` maps each route to a skills dir and a rule: `{kind:'file', form, dir}` or `{kind:'block', host}`.
  - **Rows.** `PACK_TARGETS` has 17 rows (the 16 adapter and disposition ids plus `agents`): `{ id, displayName, route | null, why, notes, sources, readsAgentsMdBeforeClaudeMd? }`, exactly as the disposition table and the golden notes. `displayName` comes from `CLIENT_ADAPTERS`/`CLIENT_DISPOSITIONS`, and `agents` is `Other agents`.
  - **Date.** `PACK_TARGETS_CHECKED_ON = '2026-10-19'`.
- `packages/client-config/src/rule-block.ts` (new, pure; DW-616, D7) -- the real marker reader and writer:
  - **Markers.** `ruleBlockMarkers(stem)`.
  - **Reader.** `locateRuleBlock(host, stem)` returns `{status:'absent'}`, `{status:'one', start, end, beginLine, endLine}` or `{status:'ambiguous', begins: number[], ends: number[]}` (1-based line numbers).
  - **Insert or replace.** `withRuleBlock(host | null, section, stem)` returns `{ok:true, bytes, change:'create'|'insert'|'replace'|'unchanged', lineEndingAdded:''|'\n'|'\r\n'}` or `{ok:false, location}`.
  - **Remove.** `withoutRuleBlock(host, stem, {lineEndingAdded, created})` returns `{ok:true, bytes | null /* null = delete the file */, change:'remove'|'absent'}` or `{ok:false, location}`.
  - **Refusals.** `withRuleBlock` and `withoutRuleBlock` also refuse a host that starts with a UTF-16 BOM (`FF FE`/`FE FF`), and a `section` that is not exactly its own BEGIN line, a body and its own END line.
  - **Rules** are in Design Notes "DW-616 contract".
- `packages/client-config/src/pack-plan.ts` (new, pure over an injected project view; portable imports only) -- AC 41.6.2, D4, D5, D6.
  - **The pack.** `DEFAULT_PACK_DIR` and `loadPack(packDir?)`. The loader reads `skills/<n>/**`, the three rule forms per stem and the notice. It refuses a missing pack, notice or form, or an agents-md form that is not a valid section.
  - **The manifest.** `parseManifest`/`renderManifest` (deterministic: sorted, two-space JSON, LF, no timestamp).
  - **The plan.** `planPackChange({action, client, includeModified, pack, project: {read(rel), isDirectory(rel)}})` returns a plan:
    - items, sorted by path, of `{path, change: 'create'|'update'|'remove'|'adopt'|'unchanged'|'keep'|'conflict', detail?}`;
    - the writes `{rel, before, after}`;
    - the directories to create and remove, the manifest's before and after bytes, the notes, the counts and the conflicts.
  - **Refusals.** An unknown client, a client with no route, or an invalid manifest is a refusal, never a throw.
  - **Payloads.** `installerPayloads(packDir?)` returns, per route, the files a route-id install writes into an empty project, in path order.
  - **Adapted content.** A rule form or block section that carries `Adapted from intersystems-community/iris-agentic-dev` is a refusal: the installer cannot place a notice beside it. That check runs fail-closed.
- `packages/client-config/src/pack-apply.ts` (new) -- AC 41.6.2, D4:
  - `BytesFs` (`exists`, `isDirectory`, `readBytes`, `writeBytes`, `mkdir`, `removeFile`, `removeEmptyDir`, `listDir`) and `REAL_BYTES_FS`;
  - `preparePackChange(ctx, {action, client, includeModified, fs?, packDir?})`, which validates paths and builds the project view;
  - `executePackPlan(ctx, plan, {fs?, now?})`. It re-checks every planned path's bytes against the plan (changed-since-preview refusal), then follows the protocol order in Design Notes.

  `projectKey` = the sanitized project basename plus the first 12 hex digits of the sha256 of the absolute path.
- `packages/client-config/src/write.ts` -- export the existing `stamp` unchanged, so both writers share one backup timestamp format.
- `packages/client-config/src/index.ts` -- export the new public API (targets, routes, the rule-block functions, `loadPack`, `planPackChange`, `installerPayloads`, `preparePackChange`, `executePackPlan`, `BytesFs`, `REAL_BYTES_FS`, and the types).
- `packages/client-config/src/cli/clients.ts` -- AC 41.6.4, D8.
  - **The command.** Add `cmdSkills` (thin: parse, validate, `preparePackChange`, render the preview, confirm, `executePackPlan`, render the result) and `SKILLS_USAGE`.
  - **Options.** Add `--project` to `VALUED_OPTIONS`; the `parseArgs` first argument stays named `args` or `rest`.
  - **The confirmation gate.** Extract it from `cmdApply` into one private helper used by both. `apply`'s three messages stay byte-identical.
  - **Help and dispatch.** Extend `buildHelpText` with the golden help lines, the `switch` with `case "skills"`, and the valid-commands string with `, skills`.
  - **Deps.** Add `bytesFs?: BytesFs` to `CliDeps`, defaulting to `REAL_BYTES_FS`.
- `scripts/lib/installer-payload-probe.mjs` (new CLI) -- D10. `node <it> <root>` imports `<root>/packages/client-config/dist/pack-plan.js` and prints `{"payloads":[{"route","files":[{"path","base64"}]}]}`. Exit 1, with one stderr line, on failure.
- `scripts/lib/provenance-inputs.mjs` -- D10. When `<root>/packages/client-config/package.json` exists:
  - append one distribution per route, `{ name: 'installer:<route>', mustShipPack: false, noticeBeside: true, files }`, from `runInstallerProbe(root)`, which is injectable as `options.runInstallerProbe`;
  - on a probe failure, append instead `{ name: 'installer', mustShipPack: false, files: [], problem: 'the installer payloads could not be computed (<first stderr line>); build @iris-mcp/client-config first' }`.

  Update the header comment.
- `scripts/lib/provenance-core.mjs` -- D10. Add the optional `noticeBeside` to the typedef. In the `distribution` rule, each file of a `noticeBeside` distribution that carries `DISTRIBUTION_MARKER` needs `<its dir>/IRIS-MCP-THIRD-PARTY-NOTICES.md` byte-equal to the canonical notice (the message is in the I/O matrix). The existing checks are unchanged.
- `packages/client-config/src/__tests__/pack-targets.test.ts` (new) -- the rows:
  - **Coverage.** The ids equal the `CLIENT_ADAPTERS` keys ∪ the `CLIENT_DISPOSITIONS` ids ∪ `{agents}` exactly.
  - **Row fields.** Each row has https sources, a `why`, and a route or (only `claude-desktop`) none.
  - **The AC minimum,** asserted literally: claude-code is `.claude/skills` + `.claude/rules`; cursor is `.cursor/rules` `.mdc`; every other routed client is `.agents/skills` + an `AGENTS.md`/`GEMINI.md` block.
  - **Data.** The `readsAgentsMdBeforeClaudeMd` set equals `{zed, kilo-code, pi}`, and the date constant is pinned.
  - **Cross-check (Rule #44).** Against `scripts/lib/skills-pack.mjs`, imported at run time by path: `RULE_FORM_DIRS`, `RULE_FORM_EXTENSIONS`, `NOTICE_FILENAME`, and `agentsMdMarkers` equal to `ruleBlockMarkers`.
  - **Source scans.** The pack modules import only the allowed modules, and no installer module contains `homedir(`, `process.cwd(` or `process.env`.
- `packages/client-config/src/__tests__/rule-block.test.ts` (new) -- DW-616. The I/O rows for ambiguity, look-alikes and host fixtures, at unit level, with byte oracles (outside-span equality, a round trip equal to the original, idempotent replace). Build non-ASCII and BOM bytes from numbers.
- `packages/client-config/src/__tests__/pack-plan.test.ts` (new) -- planning over a `Map` project view and over scratch packs:
  - the golden path list per route on an empty project;
  - the notice beside the SQL skill; the adapted-rule refusal;
  - adopt, keep / `--include-modified`, foreign conflict, pack update and stale removal, shared refcount, uninstall of a non-installed client (`Nothing to remove`);
  - the manifest refusals (each `why`), the notes `N-claude-md` and `N-first-match`, and the payload shape.
- `packages/client-config/src/__tests__/pack-apply.test.ts` (new) -- real temp directories, with the injected ctx and a jailed `BytesFs`:
  - install and uninstall round trips equal to the original bytes for every host fixture;
  - byte-exact pack copies; idempotent re-run with zero writes, counted through an fs spy;
  - backups for each overwrite or delete under the injected `stateDir`; rollback on an injected k-th write failure (the tree byte-identical);
  - the changed-since-preview refusal; created directories removed on uninstall;
  - the Never-boundary jail with `stateDir` unset.
- `packages/client-config/src/__tests__/skills-cli.test.ts` (new, in-process `runCli`) -- every usage error row (exit 2, exact message start), the non-TTY refusal, a TTY decline (exit 1, nothing written), `--json` envelopes (stdout one line; the preview on stderr), conflict exit 1, the help lines, the valid-commands string with `skills`, and `apply`'s gate messages unchanged.
- `packages/client-config/src/__tests__/skills-cli-process.test.ts` (new, built bin) -- Rule 3. A child process with `cwd` = a temp project and HOME/USERPROFILE/APPDATA = a temp home, for `claude-code` and `codex`: dry run, then non-TTY with no `--yes` (exit 2), then `--yes` (the tree), then re-run (unchanged), then uninstall `--yes` (the original bytes), then `--json`. Also `claude-desktop` exit 2. It fingerprints the real repository root's `.claude/rules`, `.claude/skills`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.agents`, `.cursor` and `.iris-mcp` before and after (unchanged).
- `packages/client-config/src/__tests__/clients-cli.test.ts` -- extend `:115-120` with an exact pin of the new valid-commands string, and `:185-206` so that `clients.ts` imports `../pack-apply.js` (the CLI holds no installer logic).
- `packages/iris-mcp-all/src/__tests__/story-41-2-qa-agents-md-consumer.test.ts` -- DW-616.
  - **The reader.** Delete `linesOf`/`locateBlock`/`replaceBlock`/`endLine`. In `beforeAll`, run `checkDistFresh` for client-config, then import `packages/client-config/dist/rule-block.js` by `pathToFileURL`.
  - **The rows.** Every row calls the real functions, and the "no final newline" row now asserts that the real insert ends the line first and finds BEGIN as a whole line. Add the rows for one BEGIN with two END, BEGIN directly after a BOM, and the BOM kept at byte 0 through insert, replace and remove.
  - **The forms list.** Extend it to the three forms.
- `packages/iris-mcp-all/src/__tests__/story-41-6-qa-installer-provenance.test.ts` (new) -- D10:
  - **Real tree.** The installer distributions (4 names, each holding the notice beside the SQL skill).
  - **The beside rule,** proven red through an injected probe whose payload lacks the notice beside the skill but has one elsewhere.
  - **Probe failure,** fail-closed: a scratch root with client-config's manifest but no dist reports `[distribution] installer`, and the CLI exits 1.
- **The moving pins** (Code Map) -- update each to the value the tool prints (Rule #51), and extend the forms lists so they cover `rules/cursor/`. Some scratch-root `check:provenance` tests pin their problem list exactly and copy client-config's dist but break its pack or dist. Each of those also gains the `installer` row; take it from the output.
- `packages/client-config/README.md` -- Rule #43 minimal docs. Add the command line to the block, plus one short subsection, "Installing the skills pack":
  - routes `claude-code`, `cursor`, `gemini`, `agents`;
  - project scope only;
  - preview plus confirmation, as for `apply`;
  - the manifest path and the backups path;
  - `--include-modified`;
  - a pointer to `iris-mcp-clients --help` for the full options. Make no promise about future docs.
- `CHANGELOG.md`, `.changeset/story-41-6-skills-and-rules-installer.md` -- AD-29. A `minor` bump for `@iris-mcp/client-config` only. The CHANGELOG section is `## [Pre-release — YYYY-MM-DD] — Story 41.6: Skills and rules installer`, dated the day the implement stage runs, with Added, Changed, Tests and Known limits (Design Notes), and the paragraph on counts that did not move: tools 110/115, the prompts, `BOOTSTRAP_VERSION` `5296a1c836f4`, the baseline `1e62c5ad5bf7`/141, and `gen:skills` 13. The paragraph also states the counts that moved: pack 22 → 23, agent files 39 → 40, distributions 8 → 12.

**Acceptance Criteria:**

- Given the 16 adapters and dispositions of `adapters.ts` on 2026-10-19, when `PACK_TARGETS` is read, then it has exactly one row per id plus `agents`. Each row names its skills location and its rule location and format, or "`AGENTS.md` fallback" / no route, with a reason and at least one documentation source. Deleting any row turns `pack-targets.test.ts` red (AC 41.6.1).
- Given any route, when `skills install` runs, then the preview is printed before any write, and nothing is written unless `--yes` or a TTY confirmation is given. A second identical run writes nothing (AC 41.6.2).
- Given an owned install, when the pack changes or the user runs `skills uninstall`, then only manifest-owned files, adopted files and our marked block are changed or removed. Foreign files and every byte of a host file outside our block are unchanged (AC 41.6.2).
- Given any route's install, when it completes, then `IRIS-MCP-THIRD-PARTY-NOTICES.md` sits beside `iris-mcp-objectscript-sql/SKILL.md`, byte-equal to the pack notice. `check:provenance` proves that for every route's payload (AC 41.6.2, AC 41.1.4).
- Given a project with a `CLAUDE.md`, when the Claude Code route installs, then the rule is in `.claude/rules/`, `CLAUDE.md` is byte-identical, and the output carries the `@AGENTS.md` note (AC 41.6.3).
- Given the built bin, when `iris-mcp-clients skills install|uninstall` runs, then the exit codes, stdout/stderr and `--json` envelope follow D8. No MCP tool count moves (AC 41.6.4).
- Given the 41.2 consumer test, when it runs, then no test-local marker reader remains, and every row exercises the installer's real reader on the built dist (DW-616).

## Spec Change Log

- 2026-10-19 (lead spec gate): D1–D10 and D1a taken as recommended (wave-7 decisions #23–#33). `epics.md` AC 41.6.1's VS Code bullet amended per D1a (#24). The spine was amended and its lint passed:
  - AD-28: the Cursor form in Shape and the render list, a new "Installer routes" bullet, and Duplicates noting both are installed until 42.8;
  - AD-30: the manifest bullet;
  - the "Marked blocks" row: the BOM, ambiguous markers, the added line ending and the hosts.

  The two plan-stage `deferred:` items are harvested at dev complete: plugin detection goes to 42.8, and the stale adapter data to 42.9.

## Review Triage Log

## Design Notes

**Governing architecture.** The decisions that bind this story:

- **AD-30:** the write protocol, ownership, the manifest, re-install and uninstall.
- **AD-28:** one pack, the rule forms, the notice beside adapted content, frontmatter preserved, and Duplicates (deferred to 42.8).
- **AD-14:** generated pack output, only through `gen:pack`.
- **AD-2:** checks in `scripts/` share their core with the tests; client-config depends on no server; iris-mcp-all imports client-config's dist only by path, never as a dependency.
- **AD-29:** a `minor` changeset, no version or publish.
- **AD-15:** no prompt or wire change.
- **Conventions:** "Pack names" and "Marked blocks".

None of the ACs contradicts an AD Rule. D1 amends an AC's named location, and that preserves AD-28's "loads in every session".

**Orchestrator decisions needed** (the Lead's calls, delegated; the next wave-7 number is #23). The plan follows each recommendation.

- **D1. Orchestrator decision needed: the per-client disposition (AC 41.6.1)** -- recommended: the table below. It has four routes, and the native rule location wherever the AC names one (Claude Code, Cursor) or the client needs one (Gemini, which reads `GEMINI.md` by default). Every other client uses the shared `AGENTS.md` block, which each of them reads at the project root natively and always-on. The table is exhaustive as of 2026-10-19: the 16 `adapters.ts` ids plus `agents`. Every URL was fetched on 2026-10-19 and returned 200.
- **D1a. Orchestrator decision needed: VS Code / Copilot's rule location** -- recommended: the `AGENTS.md` block, not AC 41.6.1's `.github/instructions/*.instructions.md` with `applyTo:`.
  - Why: VS Code's own page (dated 10/14/2026) says "VS Code automatically attaches an `.instructions.md` file when its `applyTo` pattern matches a file that the agent creates or modifies". So even `applyTo: "**"` never loads for a class written through `iris_doc_put`, when no local file is involved. That is exactly the trap the Lead's 2026-10-15 decision rejected for Claude Code's `paths:`. `AGENTS.md` at the repository root is always applied (`chat.useAgentsMdFile`, on by default), and "applicable instruction sources are additive".
  - AC amendment (Rule 5, apply and report): AC 41.6.1's VS Code bullet becomes "VS Code / Copilot → `.agents/skills/` and the `AGENTS.md` block (an `applyTo:` instructions file attaches only to files the agent creates or modifies)".
  - Alternative (AC literal): a fourth form, `rules/copilot/<stem>.instructions.md`, with `applyTo: "**"` and a `description:`, and a fifth route. That gives pack 24, distributions 13, agent files 41. The rule loads only on local edits, or when the model matches the description.
- **D2. Orchestrator decision needed: the rule forms per client (AD-14: generated vs runtime)** -- recommended: `gen:pack` generates the one new form, `rules/cursor/<stem>.mdc` (`CURSOR_RULE_FRONTMATTER` followed by the source bytes). Gemini's block uses the existing agents-md form. Copilot gets no form (D1a). Why:
  - Cursor ignores a plain `.md` in `.cursor/rules` ("Project rules must use the `.mdc` extension. A plain `.md` file in `.cursor/rules` is ignored by the rules system"), and `alwaysApply: true` is "Always included".
  - A generated form is committed, drift-checked by `gen:pack:check`, and scanned by `validate:prompts` and `check:provenance`. The installer stays a pure byte copier, so there is no second renderer of rule forms (AD-28: one pack, `gen:pack` renders the forms). A runtime-rendered file would be the only installed bytes no check ever sees.
  - Counts, from tool output: pack 22 → 23, agent files 39 → 40, `validate:prompts` 51 → 52 sources. The catalog sha moves.
  - Spine text for the Lead (AD-28 Shape): "… `rules/claude-code/<name>.md` (the source bytes …), `rules/cursor/<name>.mdc` (`---`, `alwaysApply: true`, `---`, a blank line, then the source bytes) and `rules/agents-md/<name>.md` (…) for each rule's three forms".
- **D3. Orchestrator decision needed: project or user scope** -- recommended: project scope only. `--scope project` is accepted; `--scope user` exits 2 with the message `skills supports only --scope project: at user scope the always-on rule would load in every session of every project, and a personal skill shadows a project skill of the same name in Claude Code`. Why:
  - The Lead's 2026-10-15 premise is that the checklist loads "in projects that opt in". `~/.claude/rules/` would load it everywhere.
  - Claude Code documents that personal and project skills of the same name shadow each other.

  Alternative: user scope for skills only, which doubles the route table and the tests. The deferred item is not filed; reopen it on request.
- **D4. Orchestrator decision needed: ownership and lifecycle (AC 41.6.2, AD-30)** -- recommended:
  - **The manifest** lives in the target, at `.iris-mcp/skills-pack.json`. It is deterministic (no timestamp), so an unchanged re-install writes nothing. It records `files: [{path, sha256, clients}]`, `blocks: [{path, rule, created, lineEndingAdded, clients}]` and `dirs: [created directories]`. Why in the target rather than the state directory:
    - it moves with the project, where a state-dir key by absolute path breaks on a rename or a move;
    - a teammate's clone that holds the committed files and manifest can update or uninstall them;
    - `.iris-mcp/` is unused at project level today (checked), and it matches `~/.iris-mcp/` at user level.
  - **How ownership is known:**
    - a whole file, by its manifest record, or by content identity (byte-equal to the pack, which counts as adopt);
    - a block, by its markers (the conventions row), so it is replaced whole.
  - **Clients share paths through the manifest.** Each record lists the client ids that need it. Uninstall removes a client id, and deletes a path only when no client is left.
  - **A user-edited owned file** (its sha differs from the record) is `keep`. Only `--include-modified` replaces or removes it, after a backup.
  - **Any conflict refuses the whole run.**
  - **Update** = install again: changed pack files are updated, and owned paths no longer in the pack are removed.
  - **Uninstall** removes the owned files, the block, and a host the installer created when it then holds nothing. It strips the recorded added line ending when our block was at the end of the file, and removes the empty directories it created, deepest first. When no client is left, it deletes the manifest and `.iris-mcp/` (if the installer created it).
  - **Manifest paths are allow-listed:**
    - files only under `.claude/skills/`, `.agents/skills/`, `.claude/rules/` and `.cursor/rules/`;
    - blocks only in `AGENTS.md` and `GEMINI.md`;
    - directories only inside those, or `.iris-mcp`;
    - no `..`, no absolute path, no backslash.

    So a hand-edited or cloned manifest can never make uninstall delete `src/a.ts`.

  Alternative: the manifest in `<stateDir>/skills/<hash>.json`, like `state.json`. It is machine-local and lost on a project move.
- **D5. Orchestrator decision needed: the dry-run diff format** -- recommended: a file-level plan.
  - **Layout.** A header, then one line per path, `  <change padded to 9> <path>[  (<detail>)]`, then the counts line, then `Notes:`. Templates are below.
  - **What it never shows.** It never prints a user file's bytes outside our block, or a modified file's content (AD-30: third-party content is never logged).
  - **Where it goes.** The same preview in dry-run and before confirmation. Under `--json`, the preview goes to stderr and the plan's items into the envelope, like `apply`.
  - Why: a skill is 2–7 KB, so a line diff of 18 skills is noise, and the existing `diff` command also shows only owned content.
- **D6. Orchestrator decision needed: where the notice goes** -- recommended: in the directory of each installed file that carries the adaptation marker, byte-equal to the pack notice. Today that is `<skillsDir>/iris-mcp-objectscript-sql/IRIS-MCP-THIRD-PARTY-NOTICES.md`. Why:
  - The header says "see IRIS-MCP-THIRD-PARTY-NOTICES.md", relative to the skill.
  - A skill's other files are never auto-loaded, as AD-28 requires ("at a location no client auto-loads").
  - A rule form carrying the marker is refused, because `.claude/rules/**/*.md` is auto-loaded, so no safe place exists.
- **D7. Orchestrator decision needed: the BOM before line 1 (DW-616)** -- recommended: a UTF-8 BOM at byte 0 is not part of line 1. A BEGIN line right after it is a marker, and the BOM stays at byte 0 through insert, replace and remove (the Lead's advisory). A file the installer creates has no BOM. Why: editors hide the BOM, so a user who sees BEGIN on line 1 expects it to count. 41.2's reader made a BOM-first BEGIN invisible and could append a second block.
- **D8. Orchestrator decision needed: the CLI shape (AC 41.6.4)** -- recommended:
  - **Syntax.** `iris-mcp-clients skills install|uninstall --client <id> [--project <dir>] [--scope project] [--dry-run] [--yes] [--include-modified] [--json]`.
  - **Clients.** One `--client`, as for every other command: the 17 `PACK_TARGETS` ids.
  - **Project.** `--project` is resolved against the current directory, which is also the default.
  - **Confirmation.** It is asked only when the plan writes something, as with `apply`'s `wantsWrite`. A plan with nothing to change, or with only a manifest record that is already up to date, exits 0 without `--yes`, even on a non-TTY.
  - **Exit codes:**
    - 0: success, nothing to change, or a clean dry run;
    - 1: a conflict (dry run included), an invalid manifest or pack, a write failure (rolled back), a declined confirmation, or the file changed since the preview;
    - 2: a usage error (see the I/O matrix).
  - **Governance and visibility.** It is a CLI in client-config, never registered on a server (AD-2). So no tool, `mutates` classification, preset row or governance key exists for it, and the tool counts stay at 110/115.
- **D9. Orchestrator decision needed: Gemini CLI's rule location** -- recommended: the agents-md block in `GEMINI.md`. Gemini reads `GEMINI.md` by default and `AGENTS.md` only after a `context.fileName` setting, which the installer must never edit. The marked-block reader is host-generic, so this costs no new code path. Alternative: `AGENTS.md`, plus a note naming the setting.
- **D10. Orchestrator decision needed: checking the installer payload (AC 41.1.4, which assigns it to 41.6)** -- recommended:
  - **The distributions.** One `installer:<route>` distribution per route, from the built `pack-plan.js`'s `installerPayloads`, through a child-process probe. That keeps `gatherProvenanceInputs` synchronous and fail-closed for every existing caller.
  - **The beside rule.** The `distribution` rule gains it for those distributions. The real tree goes from 8 to 12 distributions. Why: the check must run the installer's real placement logic. A scripts-side re-implementation would check itself, not the installer.

**Disposition table (AC 41.6.1; Rule #56; checked 2026-10-19).** Rule form key: CC = the `rules/claude-code/` bytes; CUR = `rules/cursor/<stem>.mdc`; block = the `rules/agents-md/` bytes between the markers.

| Client (id) | Route | Skills → | Rule → | Why (and the other locations it reads) | Sources |
|---|---|---|---|---|---|
| Claude Code (`claude-code`) | claude-code | `.claude/skills/` | `.claude/rules/iris-mcp-objectscript-pre-write.md`, CC, no `paths:` | Never reads `.agents/`. A rule without `paths` "loaded at launch". `AGENTS.md` is read only without `CLAUDE.md`, so `.claude/rules/` always works (AC 41.6.3) | code.claude.com/docs/en/skills; code.claude.com/docs/en/memory |
| Claude Desktop (`claude-desktop`) | none | none | none | Skills are only uploaded as a ZIP (Customize > Skills); instructions are only settings fields; the Code tab is Claude Code. Refused with exit 2 and the golden reason | support.claude.com/en/articles/12512180-use-skills-in-claude; code.claude.com/docs/en/desktop |
| Cursor (`cursor`) | cursor | `.agents/skills/` | `.cursor/rules/iris-mcp-objectscript-pre-write.mdc`, CUR | Also reads `.cursor/skills/`, `.claude/skills/`, `.codex/skills/`, `AGENTS.md`, `CLAUDE.md` | cursor.com/docs/skills; cursor.com/docs/rules |
| VS Code (`vscode`) | agents | `.agents/skills/` | `AGENTS.md` block, an `AGENTS.md` fallback (D1a) | Also reads `.github/skills/`, `.claude/skills/`, `.github/copilot-instructions.md`, `CLAUDE.md` | code.visualstudio.com/docs/agent-customization/agent-skills; …/custom-instructions |
| Cline (`cline`) | agents | `.agents/skills/` (confirmed in source: `skill-directories.ts` scans it; the docs page names `.cline/skills/`, `.clinerules/skills/` and `.claude/skills/`) | `AGENTS.md` block, an `AGENTS.md` fallback: Cline reads the workspace-root `AGENTS.md` as a rule (toggle in its Rules panel), so no Cline-only file is needed | Native `.clinerules/` (no frontmatter means always active) is not used | docs.cline.bot/customization/skills; docs.cline.bot/customization/cline-rules; github.com/cline/cline/blob/main/apps/vscode/src/core/storage/skill-directories.ts |
| Roo Code (`roo-code`) | agents | `.agents/skills/` | `AGENTS.md` block, an `AGENTS.md` fallback: it reads the root `AGENTS.md` while `roo-cline.useAgentRules` is on (the default) | Discontinued on 2026-05-15. Native `.roo/skills/` and `.roo/rules/` are not used | roocodeinc.github.io/Roo-Code/features/skills; …/features/custom-instructions |
| Windsurf, now Devin Desktop (`windsurf`) | agents | `.agents/skills/` | `AGENTS.md` block, an `AGENTS.md` fallback: a root `AGENTS.md` is "treated as an always-on rule" | Native `.devin/rules/` and `.windsurf/rules/` (`trigger: always_on`) are not used | docs.devin.ai/desktop/cascade/skills; docs.devin.ai/desktop/cascade/agents-md |
| Codex CLI (`codex`) | agents | `.agents/skills/` | `AGENTS.md` block (native) | Its 32 KiB combined cap is far above the 2.2 KB block | learn.chatgpt.com/docs/build-skills; learn.chatgpt.com/docs/agent-configuration/agents-md |
| Gemini CLI (`gemini`) | gemini | `.agents/skills/` (alias) | `GEMINI.md` block (native, D9) | `AGENTS.md` only through `context.fileName` | geminicli.com/docs/cli/skills/; geminicli.com/docs/cli/gemini-md/ |
| Zed (`zed`) | agents | `.agents/skills/` (its only location; trusted worktrees only) | `AGENTS.md` block (native, first match) | It reads only the first of `.rules`, `.cursorrules`, `.windsurfrules`, `.clinerules`, `.github/copilot-instructions.md`, `AGENT.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` | zed.dev/docs/ai/skills; zed.dev/docs/ai/instructions |
| Goose (`goose`) | agents | `.agents/skills/` | `AGENTS.md` block (native) | Also reads `.goose/skills/`, `.claude/skills/`, `.goosehints`. The context files need the Developer extension | goose-docs.ai/docs/guides/context-engineering/using-skills/; …/using-goosehints/ |
| Kimi CLI (`kimi`) | agents | `.agents/skills/` | `AGENTS.md` block (native) | Archived. Also reads `.kimi/skills/`, `.claude/skills/`, `.codex/skills/` | moonshotai.github.io/kimi-cli/en/customization/skills.html; …/agents.html |
| Kimi Code (`kimi-code`) | agents | `.agents/skills/` | `AGENTS.md` block (native) | Also reads `.kimi-code/skills/`, `.kimi-code/AGENTS.md` | moonshotai.github.io/kimi-code/en/customization/skills; …/agents |
| Pi (`pi`) | agents | `.agents/skills/` (trusted project only) | `AGENTS.md` block (native; per folder, `AGENTS.md` before `CLAUDE.md`) | Also reads `.pi/skills/`. iris-mcp-clients configures no MCP for it | github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md; …/configuration.md |
| JetBrains Junie (`jetbrains-junie`) | agents | `.agents/skills/` (trusted project only) | `AGENTS.md` block (native; ignored when `.junie/AGENTS.md` or a custom guidelines file exists) | Also reads `.junie/skills/`, `.junie/rules/`. iris-mcp-clients configures no MCP for it | junie.jetbrains.com/docs/agent-skills.html; …/guidelines-and-memory.html |
| Kilo Code (`kilo-code`) | agents | `.agents/skills/` | `AGENTS.md` block (native; `AGENTS.md` before `CLAUDE.md`, first match) | Also reads `.kilo/skills/`, `.claude/skills/`, `.kilo/rules/`. iris-mcp-clients configures no MCP for it | kilo.ai/docs/customize/skills; kilo.ai/docs/customize/agents-md |
| Other agents (`agents`) | agents | `.agents/skills/` | `AGENTS.md` block | The cross-client convention for any agent reading both | agentskills.io/client-implementation/adding-skills-support; agents.md |

All URLs are `https://`. `PACK_TARGETS.sources` stores them in full, and `…` repeats the host and path prefix of the previous URL in that cell.

**Review question (Rule #56): what is missing from this table?**

- **Clients outside the roster.** Antigravity CLI (it replaced Gemini CLI for unpaid users), GitHub Copilot CLI, Devin CLI, OpenCode, Amp, ZooCode (the Roo fork), JetBrains AI Assistant chat (`.aiassistant/rules/`; its `apply:` frontmatter is unconfirmed), Kiro, Aider, Warp, Augment, TRAE and Factory. Each is served by `--client agents` only if it reads `.agents/skills/` and `AGENTS.md`. Each is unverified.
- **Native locations that were not chosen,** listed in the Why column.
- **Not covered:**
  - user scope (D3);
  - a `CLAUDE.md` in a parent directory, or a nested `AGENTS.md` (only the project directory is checked);
  - symlinked `.claude/` directories (written through);
  - a client that reads the skills or the rule twice (Cursor: `.claude/skills/` plus `.agents/skills/`, `.cursor/rules` plus `AGENTS.md`; Claude Code without `CLAUDE.md`: `.claude/rules/` plus `AGENTS.md`). This gets static notes only and no deduplication;
  - plugin detection (42.8);
  - the stale MCP adapter data (`deferred:`).

**Golden notes.** These are user-facing ASCII strings, printed under `Notes:` in the preview and the result for the selected client.

- `N-claude-md` (claude-code, when the project has `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md`): `This project has a CLAUDE.md, so Claude Code does not read AGENTS.md here. The always-on rule is installed in .claude/rules/, which Claude Code loads either way. To have Claude Code also read this project's AGENTS.md, add the line @AGENTS.md to CLAUDE.md; this installer never edits CLAUDE.md.`
- `N-first-match` (this run creates `AGENTS.md` in a project that has `CLAUDE.md`): `This run creates AGENTS.md in a project that has a CLAUDE.md. Zed, Kilo Code and Pi read only one of the two, and they take AGENTS.md first, so they stop reading CLAUDE.md here.` The names are the `displayName`s of the rows flagged `readsAgentsMdBeforeClaudeMd`, in table order.
- **Static notes per row:**
  - cursor: `Cursor also reads .claude/skills/ and AGENTS.md, so a project that also installs for Claude Code or for an AGENTS.md client shows Cursor each skill, or the rule, twice.`
  - vscode: `VS Code reads the rule from AGENTS.md at the repository root while its chat.useAgentsMdFile setting is on, the default. It also reads .claude/skills/, so a project that also installs for Claude Code shows each skill twice.`
  - cline: `Cline lists AGENTS.md in its Rules panel, where the rule can be switched off. It also reads .claude/skills/, so a project that also installs for Claude Code shows each skill twice.`
  - roo-code: `Roo Code was discontinued on 2026-05-15. Its last release reads .agents/skills/, and reads AGENTS.md while its roo-cline.useAgentRules setting is on, the default.`
  - windsurf: `Windsurf is now Devin Desktop, which treats AGENTS.md at the repository root as an always-on rule.`
  - gemini: `For unpaid-tier and Google One users, Gemini CLI was replaced by Antigravity CLI on 2026-06-18.`
  - zed: `Zed loads project skills only in a trusted worktree, and reads only the first instructions file it finds, in the order .rules, .cursorrules, .windsurfrules, .clinerules, .github/copilot-instructions.md, AGENT.md, AGENTS.md, CLAUDE.md, GEMINI.md.`
  - goose: `Goose reads AGENTS.md through its Developer extension, which must be enabled.`
  - kimi: `Kimi CLI is archived and no longer maintained; Kimi Code replaces it.`
  - pi: `Pi loads project skills only in a trusted project. iris-mcp-clients does not configure MCP for Pi, so add the IRIS MCP servers to Pi yourself before using the workflow skills.`
  - jetbrains-junie: `Junie loads project skills only in a trusted project, and ignores AGENTS.md when .junie/AGENTS.md exists or a custom guidelines file is set. iris-mcp-clients does not configure MCP for Junie, so add the IRIS MCP servers to Junie yourself before using the workflow skills.`
  - kilo-code: `iris-mcp-clients does not configure MCP for Kilo Code, so add the IRIS MCP servers to Kilo Code yourself before using the workflow skills.`
  - claude-code, codex, kimi-code and agents: none.
  - claude-desktop's refusal: `Claude Desktop has no project folder for skills or rules: upload skills as a ZIP under Customize > Skills. Its Code tab runs Claude Code, so use --client claude-code for that.`

**DW-616 contract** (`rule-block.ts`; addressed, not declined):

- **Lines.** The host is split on LF. A line's text excludes its LF and one CR before it. A UTF-8 BOM (`EF BB BF`) at byte 0 is not part of line 1 (D7).
- **Markers** are exact whole lines: `<!-- IRIS-MCP-RULE:<stem>:BEGIN -->` and `…:END -->`. Indents, trailing blanks, other case, other names and inline text are not markers. Another rule's or another tool's block is foreign.
- **`one`** = exactly one BEGIN line and one END line, with BEGIN first. Any other count or order with at least one marker is `ambiguous` (both line lists). Nothing is guessed, and nothing is written.
- **Insert.**
  - When the host is absent, the file is created as the section bytes.
  - When the host is empty, it becomes the section, with no line ending added.
  - Otherwise: if the last line has no line ending, one is added in the file's style (`\r\n` if the host contains `\r\n`, else `\n`) and recorded as `lineEndingAdded`; then the section is appended. The section's LF bytes are copied as they are, never converted.
- **Replace and remove** splice exactly `[start, end)` of the block's lines, from BEGIN's first byte to the byte after END's line ending. A BOM before line 1 stays.
- **Remove,** after the splice:
  - if `lineEndingAdded` is recorded and the block was at the end of the file, strip that exact ending;
  - if the host was `created` and the result is empty, return `null` (delete the file).
- **Replace** of a block that already equals the section is `unchanged`.
- **41.2's consumer rows** now import these functions (iris-mcp-all → client-config dist by path; AD-2 allows it, no dependency is added).

**Protocol order** (`executePackPlan`; AD-30 FR141, run-level):

1. Re-read every planned path. Refuse if any differs from the plan.
2. Create the missing directories, recording each.
3. For each write, in path order:
   - back up an existing file to `<stateDir>/backups/skills-pack/<projectKey>/<rel>.<stamp>[-N]`;
   - write the bytes;
   - re-read them and compare. A block host is also re-located: there must be exactly one block, equal to the section, with the bytes outside it equal to before.
4. Delete removed files, each with a backup first.
5. Remove the recorded empty directories.
6. Write the manifest last.

On any failure, undo every completed step in reverse (rewrite the old bytes, remove created files and directories), and return the path and the cause. Results name paths and causes, never content.

**Golden help text** (inserted in `buildHelpText`):

- **Commands,** after `doctor`:

  ```text
    skills install|uninstall --client <id> [--project <dir>] [--dry-run] [--yes] [--include-modified] [--json]
        Install, update or remove the IRIS MCP skills pack and its always-on
        rule in a project, in the client's native locations (--client agents
        for any agent that reads .agents/skills/ and AGENTS.md). Previews the
        changes first and needs the same confirmation as apply; only files and
        marked blocks it installed are changed.
  ```

- **Options:**

  ```text
    --project <dir>       skills: the project to install into (default: the
                          current directory). Only project scope is supported.
    --dry-run             skills: preview the changes and write nothing.
    --include-modified    skills: also replace or remove installed files you
                          changed since (each is backed up first).
  ```

  The `--yes` line becomes `apply, skills: skip the interactive confirmation.`
- **The footer** adds `Skills-pack backups live under ~/.iris-mcp/client-manager/backups/skills-pack/.`
- **`SKILLS_USAGE`** = `iris-mcp-clients skills install|uninstall --client <id> [--project <dir>] [--scope project] [--dry-run] [--yes] [--include-modified] [--json]`.
- **A missing action:** `skills needs an action: install or uninstall`.
- **The valid-commands string:** `Valid commands: detect, status, diff, apply, enable, disable, remove, restore, doctor, skills.`

**Golden output lines:**

- **Header:** `Skills pack <install|uninstall> for <displayName> in <absolute project>:`
- **Counts:** `<a> to create, <b> to update, <c> to remove, <d> to adopt, <e> unchanged, <f> kept, <g> conflict(s).`
- **Endings:**
  - dry run: `(dry run: nothing was written)`;
  - done: `Done: <n> path(s) changed for <displayName>.`;
  - nothing to do: `Nothing to change for <displayName>: the skills pack is already installed.` / `Nothing to remove for <displayName>: the skills pack is not installed.`
- **The non-TTY refusal:** `skills <action> needs confirmation before writing and this is not an interactive terminal; re-run with --yes to accept the previewed changes, or --dry-run to preview only`.
- **Details:**
  - adopt: `(already identical to the skills pack; recorded as installed)`;
  - stale: `(no longer in the skills pack)`;
  - insert: `(add the <stem> block at the end)`, or `(end the last line, then add the <stem> block at the end)`;
  - replace: `(replace the <stem> block, lines <a>-<b>)`;
  - remove: `(remove the <stem> block, lines <a>-<b>)`;
  - delete a created host: `(it holds only the <stem> block this installer created)`;
  - a new host: `(a new file holding the <stem> block)`;
  - a missing record: `(already gone; its record is dropped)`;
  - the manifest: `(the installer's record of what it owns here)`;
  - the conflict and keep texts are in the I/O matrix.
- **The JSON envelope** is `command: "skills"`. Its `data` holds `{action, client, route, project, dryRun, changed, items, notes}`.

**Golden pack text.**

- The Cursor form is `CURSOR_RULE_FRONTMATTER` followed by the 2120 source bytes, so it is expected to be 2147 bytes (take the value from `gen:pack`).
- `catalogRuleLine` becomes:

  ``- `<stem>`: <title>. Its Claude Code form, `rules/claude-code/<stem>.md`, has no `paths:` scope, so it loads in every session of a project that installs it. `rules/cursor/<stem>.mdc` is the same text as a Cursor rule with `alwaysApply: true`, and `rules/agents-md/<stem>.md` holds it for `AGENTS.md`, between two marker lines.``

- The Layout gains, after the claude-code bullet:

  ``- `rules/cursor/<name>.mdc`: the same rule as a Cursor project rule, with `alwaysApply: true` frontmatter.``

**The manifest, for example** (claude-code; sorted; `sha256` is lower-case hex):

```json
{
  "schema": 1,
  "note": "Written by iris-mcp-clients. It lists the files and blocks the skills installer owns in this project, so an update or an uninstall changes only those.",
  "files": [{ "path": ".claude/rules/iris-mcp-objectscript-pre-write.md", "sha256": "<hex>", "clients": ["claude-code"] }],
  "blocks": [],
  "dirs": [".claude", ".claude/rules", ".claude/skills", ".claude/skills/audit-security-posture", ".iris-mcp"]
}
```

**REUSE verdicts (Rule #47, verified in source; Rule 2 "extend, don't copy"):**

- **Reused as they are:**
  - `resolveStateDir`;
  - the backup timestamp, `stamp` (exported);
  - the CLI's `parseArgs`, `usageError`, `emitJson`, `isFailure` and the `VALUED_OPTIONS` single-sourcing;
  - the confirmation gate (extracted into one helper that `apply` also uses);
  - `CLIENT_ADAPTERS`/`CLIENT_DISPOSITIONS` for names and coverage.
- **A sibling, not an extension:** `executePackPlan` is a sibling of `applyWrite` with the same step order. `applyWrite` is string-only (`WriteFs` decodes utf8, which would corrupt invalid UTF-8 outside the block). It is also hard-wired to `readConfigEntries` (an adapter is required), cannot delete, and is pinned by every engine test. Generalizing it would touch every engine caller for no gain.
- **New instead of reused:** `BytesFs` is new rather than members added to `WriteFs`, which `MemFs` and the fakes implement.
- **Copies pinned by a cross-check:** `ruleBlockMarkers` and the form constants copy `agentsMdMarkers`/`RULE_FORM_DIRS`, because the shipped package cannot import the repository's `scripts/`. `pack-targets.test.ts` pins the copies against the originals (Rule #44).
- **A deliberate test copy:** 41.2's by-hand `sectionOf` renderer stays in its test as an independent oracle of the section bytes.

**Integration ACs and linkage (Rules 1 and 2).**

- **Integration rows** (in the I/O matrix):
  - the `iris-mcp-clients skills` CLI (the built bin) reads the installer modules and produces files in a temporary project;
  - `check:provenance` reads `installerPayloads` from the built dist, and produces `12 distribution(s)` or the beside problem;
  - the 41.2 consumer test reads `rule-block.js`, and its 60 rows pass.
- **Consumed-by:**
  - 41.7: the every-route CLI capstone, the README rendering of `PACK_TARGETS`, the root README pack section, and the live Claude Code check;
  - 42.8: plugin detection on the claude-code route, and a plugin rooted at the pack that ignores `rules/`.
- **Consumes:** the pack (41.1–41.5), `gen:pack`, and the provenance check (41.1).

**Capstone seam (Rule #52).**

- **41.6 ships and pins:**
  - the four routes and 17 targets, at unit level;
  - the DW-616 reader;
  - byte preservation on the Rule #58 fixtures;
  - idempotence, update, uninstall, refcount, the manifest, the notices and rollback;
  - the CLI exit matrix and `--json` on the built bin, for the claude-code and codex clients;
  - the installer distributions in `check:provenance`.
- **41.7 owns:**
  - AC 41.7.2's default-suite capstone driving the built CLI for every one of the 17 client ids (claude-desktop's refusal included). It checks the exact paths against `PACK_TARGETS`/`PACK_ROUTES`, the frontmatter through `readSkillFrontmatter`, the notice, re-install, and uninstall leaving foreign content intact, and is proven red;
  - the README docs, including rendering the disposition table from `PACK_TARGETS`;
  - the root README pack section, which also rewrites the "installer arrives in Story 41.6" sentence (`README.md:825`, pinned by `story-41-2-doc-claims.test.ts`);
  - the live check;
  - DW-611. The 41.2 consumer test now also needs client-config's dist, so the ordering problem DW-611 names widens to that file.
- **41.6 does not re-touch** 41.7's docs, and 41.7 does not reopen the installer's write path.

**AC interpretations** (apply and report):

- **"Native skill location"** is the one directory each route writes. The other directories a client reads are documented, not written.
- **"Driven by the existing engine"** means the engine's protocol order, backups, state directory, confirmation gate and envelope, through a byte-level sibling writer (REUSE).
- **"Instructions file preserved outside the marked block"** covers `GEMINI.md` as a block host. The installer never writes `CLAUDE.md` or Copilot's instructions files, and tests pin those as byte-identical.
- **AC 41.6.3** gives the claude-code route `.claude/rules/` whether or not a `CLAUDE.md` exists.
- **AC 41.6.4** is one command, `skills`, with two actions.

**Known limits** (for the CHANGELOG):

- project scope only;
- no plugin detection;
- static duplicate-read notes;
- no parent-directory `CLAUDE.md` detection;
- symlinks are followed;
- skills-pack backups are never pruned and `doctor` does not list them;
- an edit inside our block is replaced on the next install (the Marked blocks convention);
- installing for one client never updates another client's non-shared files.

**Mutations to apply, observe red and record** (Rule 19, one per AC; the implement stage writes `mutation:` lines):

- delete the `pi` row → `pack-targets.test.ts`;
- write before the confirmation check → the `skills-cli` non-TTY row;
- always rewrite unchanged files → the idempotence row;
- normalize CRLF in `withRuleBlock` → the CRLF host row;
- drop the notice placement → `pack-plan` notice row, and (rebuilt) real-tree `check:provenance` exit 1;
- take the first BEGIN/END pair → the ambiguous rows;
- count the BOM in line 1 → the BOM-BEGIN row;
- skip ending the last line → the no-final-newline row;
- drop `N-claude-md` → the AC 41.6.3 row;
- remove `case "skills"` → the process row;
- default `stateDir` through `os.homedir()` → the jail row;
- remove the `noticeBeside` check → the injected-probe row.

## Verification

**Commands** (repository root `/Users/jbrandt/git/iris-execute-mcp-v2`; each runs in the foreground with `timeout: 600000`):

- (loop) `pnpm gen:pack && pnpm gen:pack:check` -- expected: `gen-pack --check: OK — 23 pack file(s) match their sources, no drift.`
- (loop) `pnpm --filter @iris-mcp/client-config build` -- expected: exit 0. Run it after every client-config `src/` change and before the process, provenance and 41.2 tests.
- (loop) `pnpm --filter @iris-mcp/client-config exec vitest run src/__tests__/pack-targets.test.ts src/__tests__/rule-block.test.ts src/__tests__/pack-plan.test.ts src/__tests__/pack-apply.test.ts src/__tests__/skills-cli.test.ts src/__tests__/skills-cli-process.test.ts src/__tests__/clients-cli.test.ts src/__tests__/clients-cli-process.test.ts` -- expected: all pass.
- (loop) `pnpm check:provenance` -- expected: exit 0, and a line ending `1 provenance row(s), 40 agent file(s), 12 distribution(s).` (take the values from the output, Rule #51).
- (loop) `pnpm validate:prompts` -- expected: exit 0. Line 1 is `…52 source(s) checked (12 prompt(s) + 40 content file(s): 12 workflow, 21 pack, 6 knowledge, 1 rule), 111 known tool name(s).` Line 2 is `…24 file(s) declare one (12 core, 6 developer, 6 full) and 16 tool-free file(s) declare none; no internal reference in 52 source(s), 2 adaptation header line(s) exempted.`
- (loop) `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-41-2-qa-agents-md-consumer.test.ts src/__tests__/story-41-6-qa-installer-provenance.test.ts src/__tests__/pack-provenance.test.ts src/__tests__/skills-pack.test.ts src/__tests__/skills-pack-rule.test.ts` -- expected: all pass.
- (loop) `pnpm --filter @iris-mcp/all exec vitest run` over the remaining moved-pin files (Code Map) -- expected: all pass.
- (once) `pnpm --filter @iris-mcp/client-config test`, `… type-check`, `… lint` -- expected: green.
- (once) `pnpm --filter @iris-mcp/all exec vitest run $(ls src/__tests__/*.test.ts | awk 'NR%3==0')`, then `NR%3==1`, then `NR%3==2` (three calls, run from `packages/iris-mcp-all`) -- expected: green.
- (once) `pnpm gen:skills:check` (13 generated files), `pnpm gen:governance-baseline:check` (`1e62c5ad5bf7`/141), and `node packages/client-config/scripts/render-certification-table.mjs --check` (in sync) -- expected: unchanged.
- (once) the added and changed test files with `--sequence.shuffle`, two seeds each, in both packages -- expected: green (in either order).

**Shared surfaces:**

- the pack file list and count (22 → 23);
- the pack catalog README sha;
- `RULE_FORM_DIRS` and the forms lists of the 41.2 and 41.5 tests;
- the `listAgentContentFiles` enumeration (39 → 40) and the `validate:prompts` lines 1 and 2;
- the `check:provenance` OK line and the distribution names (8 → 12; scratch roots with client-config's dist move from 1 to 5 and from 2 to 6);
- the CLI valid-commands string, help text and `VALUED_OPTIONS` (`--project`);
- client-config's `index.ts` exports;
- `write.ts` exports (`stamp`).

Every test added or changed passes on a fresh environment, in either order. No IRIS instance is touched, and no `ExecuteMCPv2.Temp.*` fixture is needed. All installer tests create their own temporary directories and delete them in `afterEach`/`afterAll`.

**Manual checks:**

- `git status --short` shows no change under the real repository root's `.claude/`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.agents/`, `.cursor/` or `.iris-mcp/`, and nothing was created under the real `~/.iris-mcp/client-manager/backups/skills-pack/`.

## Auto Run Result

Status: ready-for-dev
Blocking condition: none

Planning halted after the READY-FOR-DEVELOPMENT gate, as the invocation asked ("Halt after planning."). The ledger inbox (DW-616) is addressed by the `rule-block.ts` and 41.2 consumer-test tasks. Orchestrator decisions D1 to D10 (including D1a, an AC 41.6.1 amendment) are recorded in Design Notes, with the plan following each recommendation. Two `deferred:` items are filed for harvest: plugin detection goes to 42.8, and the stale MCP adapter data to burndown or a later story.
