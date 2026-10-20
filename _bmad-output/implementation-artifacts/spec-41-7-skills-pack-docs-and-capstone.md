---
title: 'Story 41.7: Skills Pack Docs and Capstone'
type: 'feature'
created: '2026-10-19'
status: 'done'
baseline_revision: '49244c39e91b82323588695b8d08466352d40979'
baseline_commit: '49244c39e91b82323588695b8d08466352d40979'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings:
  - oversized
deferred:
  - summary: 'The documented npx form `npx -y @iris-mcp/client-config iris-mcp-clients <command>` would pass `iris-mcp-clients` to the CLI as its command, and it carries no `@1` pin.'
    evidence: '`packages/client-config/src/cli/clients-cli.ts:14` runs `runCli(process.argv.slice(2))`, and `runCli` takes the first argument as the command (`clients.ts:1966`). So once the package is published, the documented line fails with an unknown-command error. The form appears at `packages/client-config/README.md:17`, `docs/client-config/README.md:5` and `docs/client-config/{claude-code,claude-desktop,cursor}.md:4`, and `certification-docs.test.ts:88` pins the exact string. Story 42.1 (AC 42.1.6) owns the npx spec pin and the unpinned-spec test. The likely fix is `npx -y -p @iris-mcp/client-config@1 iris-mcp-clients <command>`, verified against the published package. This story adds no npx form.'
    location: 'packages/client-config/README.md:17; docs/client-config/*.md'
    severity: 'med'
  - summary: >-
      The `why` text of the `cursor` and `vscode` rows of `PACK_TARGETS` never says that the client reads `.agents/skills/`,
      the claim that justifies their route; every other `agents`-route row states it.
    evidence: |-
      Found by the blind-hunter layer reading the generated `Skills pack targets` table in `packages/client-config/README.md`. The Cursor row names `.cursor/skills/`, `.claude/skills/` and `.codex/skills/`, the VS Code row names `.github/skills/` and `.claude/skills/`, and neither names `.agents/skills/`, which is the folder the installer writes for both. This story may not change a `PACK_TARGETS` row (the 41.6 seam), so the text is installer data owned by 41.6 and DW-626's re-dispositions. A change there needs the sources re-read, then a re-render of the table.
    location: >-
      packages/client-config/src/pack-targets.ts (rows `cursor` and `vscode`, field `why`)
    severity: low
  - summary: >-
      The `description` of `packages/client-config/package.json` still reads "read-only foundation; writes arrive in Epic 33 Story 33.1", although the package now writes client configs and installs the skills pack.
    evidence: |-
      Pre-existing, seen by the blind-hunter layer. The field is the npm-facing summary of a package that Story 42.1 (pre-publish package fixes) prepares for its first publish. This story touches no `package.json`.
    location: >-
      packages/client-config/package.json:4
    severity: low
---

<intent-contract>

## Intent

**Problem:** The skills pack and its installer exist, but the docs still describe the old state:
- The root README tells users to copy `skills/` by hand and says "The installer arrives in Story 41.6."
- `skills/README.md` duplicates the catalog with `cp -r` instructions.
- Nothing documents where each client's files go.
- The pack docs read the tool presets as if they were nested (DW-624).

The epic also has no default-suite gate that drives the built installer for every client. In addition, `@iris-mcp/all`'s tests can run against a stale or unbuilt client-config dist, or replay a cached green after the pack sources change (DW-611).

**Approach:**
- **Docs.** Write the docs from the real sources:
  - a root README "The skills pack" section, pinned by tests that read the bin's output, `PACK_TARGETS`/`PACK_ROUTES`, the pack tree and the presets;
  - a client-config README per-client table generated from `PACK_TARGETS`, with `--check`;
  - `skills/README.md` reduced to a generated pointer;
  - the not-nested presets stated in the root README and the catalog.
- **The capstone.** Add the Epic 41 capstone: one default-suite test that drives the built `iris-mcp-clients` bin for all 17 client ids and is proven red on the built-bin path.
- **DW-611.** Order `@iris-mcp/all#test` after `@iris-mcp/client-config#build`. Stop a cached test green from outliving a change to what the tests read (D6: no test result is cached). Give the installer probe a freshness guard.
- **The live check.** Specify AC 41.7.3's one-time live Claude Code check for the lead to run.

## Boundaries & Constraints

**Always:**
- **Every doc claim this story adds is pinned.** Each pin is a test that reads the real source of truth: the built bin's output, `PACK_TARGETS`/`PACK_ROUTES`/`MANIFEST_PATH`/`LINK_DETAILS` from client-config's dist, the pack tree on disk, or the preset rosters (Rule #51). The claim-to-pin map is in Design Notes.
- **Generated files change only through their generators (AD-14):**
  - `skills/README.md` through `pnpm gen:skills`;
  - the catalog through `pnpm gen:pack`;
  - the client-config README marker sections through `node packages/client-config/scripts/render-certification-table.mjs`.
- **The capstone:**
  - It drives only the BUILT bin, in a fresh child process per call, with `HOME`/`USERPROFILE`/`APPDATA` set to a temp home and `cwd` set to a temp project.
  - Its oracles are independent of the bin: `PACK_TARGETS`, `PACK_ROUTES` and the constants come from client-config's `src/` modules, the pack bytes from disk, and frontmatter is read through `readSkillFrontmatter` from `scripts/lib/skills-pack.mjs`.
- **Temp directories only.** Tests and probes write only under OS temp directories they create and delete. Every child process gets a temp `HOME`. Nothing is written to the real repository root (`.claude/`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.agents/`, `.cursor/`, `.iris-mcp/`) or to the real `$HOME`.
- **No IRIS contact in iris-mcp-all runs.** Every `@iris-mcp/all` run sets `IRIS_HOST=127.0.0.1 IRIS_PORT=1` (DW-627).
- **Source text.** New `.ts`/`.mjs` code is ASCII; any non-ASCII is written as escapes, and test bytes are built from numbers (Rule 14). Files are written with the file tools, never a heredoc (#55).

**Never:**
- **The installer is not reopened.** No change to its write path, plan, manifest, routes, `PACK_TARGETS` rows or CLI behavior (the seam with 41.6, Rule #52). The installer's `src/` modules are read, never edited.
- **No surface change.** No MCP tool, action, governance key, preset roster, prompt, refusal code or bootstrapped class changes. No ObjectScript (`src/`) changes. Tools stay at 110 package / 115 advertised, the prompts stay byte-identical on the wire, the baseline stays `1e62c5ad5bf7`/141, and `BOOTSTRAP_VERSION` stays `5296a1c836f4`.
- **No npx form, and no new package dependency.** Add no `npx` command line anywhere (42.1 owns the `@1` pin). Add no workspace dependency between packages (AD-2).
- **Files not to touch:**
  - `.claude/rules/*`, `CLAUDE.md`, the spine, `epics.md`, `irislib/`, `irissys/`, the installer-managed `.claude/skills/bmad-*`, earlier `CHANGELOG.md` sections, and `docs/client-config/*`;
  - the npx line at `packages/client-config/README.md:17-19` (it is pinned and deferred).
- **Out of scope:** DW-622 and DW-615 (the lead's at the burn-down gate).
- **The implement, QA and review stages:**
  - They never run `claude`. The lead runs AC 41.7.3 at smoke.
  - They make no IRIS call.
  - They never run `git commit`, `git push`, `git reset` or `git rebase`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Capstone, a routed client (Integration: CLI; 16 legs) | A temp project seeded with foreign content (Design Notes "Capstone fixtures"), then `skills install --client <id> --yes` | Exit 0. The tree diff is exactly: the pack's skill files under `PACK_ROUTES[route].skillsDir`; the notice beside each file that carries the adaptation header; the rule file, or our block in the host; the manifest; the created directories. Every installed file is byte-equal to the pack. Every installed `SKILL.md` passes `readSkillFrontmatter` with no problem and `name` = its directory: 12 declare a preset, 6 declare none. Every foreign file is byte-identical | No error expected |
| Capstone, re-install | The same project with file mtimes aged, then the same install again | Exit 0, `Nothing to change for <displayName>: the skills pack is already installed.` The tree and every mtime are unchanged, the manifest bytes are unchanged, and the backup count under the temp home is unchanged | No error expected |
| Capstone, uninstall | `skills uninstall --client <id> --yes` | Exit 0. The tree (with modes) equals the pre-install snapshot exactly, so every foreign byte is intact | No error expected |
| Capstone, Claude Desktop (1 leg) | Seeded project; `skills install` and `skills uninstall --client claude-desktop --yes` | Exit 2 each. stdout is empty, stderr starts `Error: <CLAUDE_DESKTOP_REFUSAL>` followed by a blank line and `Usage: iris-mcp-clients skills install\|uninstall`. The tree is unchanged, with no manifest and no backup | Refused |
| Generated table (Integration: `certification-docs.test.ts` reads the renderer) | `render-certification-table.mjs --check` on the real package | `render --check: README.md marker sections are in sync`, exit 0. The `PACK-TARGETS-TABLE` section has 17 rows in `PACK_TARGETS` order | A hand edit inside the markers, or a `PACK_TARGETS` change without a re-render: exit 1 with the OUT OF SYNC line. A roster violation: exit 2 |
| Root README claims (Integration: docs against tool output) | `story-41-7-doc-claims.test.ts` | Each documented `skills` command runs with `--dry-run --project <temp>` and exits 0 with nothing written. The 4 route rows equal the rows rendered from `PACK_ROUTES`/`PACK_TARGETS`. The counts match the pack tree, the not-nested example matches the admin rosters, and each known limit matches the bin's output | A drifted row or claim fails the test, naming the line |
| `skills/README.md` | `pnpm gen:skills`, then `gen:skills:check` | The generated pointer (golden in Design Notes), with no skill table and no `cp -r`. `13 generated file(s) match source` | A hand edit: DRIFT, exit 1 |
| Turbo graph (Integration: turbo reads `turbo.json`, DW-611) | `turbo run test --dry=json --cwd <temp copy of the working-tree manifests>` | `@iris-mcp/all#test` depends on `@iris-mcp/all#build` and `@iris-mcp/client-config#build`. Every `#test` task's resolved definition has `cache: false` | Reverting either change makes the test red |
| Probe freshness (Integration: `check:provenance` reads the probe, DW-611) | A scratch root with client-config's `package.json`, `dist/` and a `src/` file newer than `dist/` | `[distribution] installer: the installer payloads could not be computed (<stale reason>); build @iris-mcp/client-config first`, exit 1. A root without client-config's `src/` (every existing scratch root) and the fresh real tree are unchanged | Fail-closed |
| Live check (AC 41.7.3; the lead, at smoke) | The Design Notes procedure: positive leg, uninstall, contrast leg | The positive leg's init `skills` list includes all 18 names, and an `InstructionsLoaded` for the installed rule (`session_start`) comes before the `.cls` `iris_doc_put` `PreToolUse` in the same session. The contrast leg has neither, while the `PreToolUse` still fires. No IRIS write happens | The fallbacks are in the procedure. A leg over USD 1 is stopped by `--max-budget-usd` |

</intent-contract>

## Code Map

**Root and package docs:**
- `README.md`:
  - **The section to extend.** `## Workflow Prompts & Agent Skills` runs `:800-831` (`---` at `:832`). `:806-823` is the 12-prompt table, `:825` the retirement sentence, and `:827-830` `### Using the prompts`.
  - **The bullet to rewrite.** `:830` says to copy `skills/` into `.claude/skills/`, links `skills/README.md` twice, and calls the preset "the tool preset under which every tool it names is visible" (DW-624's nested misreading).
  - **Anchor links.** `:471`, `:492`, `:512` and `tool_support.md:450` link `#workflow-prompts--agent-skills`. Keep that heading.
  - **The manager section.** `:229-250` `#### The manager: iris-mcp-clients (recommended)`. It uses the built-bin form `node packages/client-config/dist/cli/clients-cli.js <cmd>` (`:233-238`) after "Not yet published to npm…" (`:231`).
  - No table of contents. "110 tools" at `:21`, `:718`, `:804`.
- `packages/iris-dev-mcp/README.md:271`: the same retirement sentence. `:273`, plus admin `:259`, interop `:401` and ops `:199`: `Also installable as [Agent Skills](../../skills/README.md).`
- `tool_support.md:450`: one long line. It holds the `TOOL_SUPPORT_NOTE` substring and ends "…and the generated [`skills/`](skills/README.md) install pack."
- `packages/client-config/README.md`:
  - **The CLI section.** `:15`; `:17-19` is the npx line plus its caveat, which is pinned (do not touch). The command block is `:32-41`, with the `skills` line at `:40`.
  - **The installer docs.** `## Installing the skills pack` `:66-105` (routes, scope, preview, ownership, `--include-modified`, the record, exit codes, notice; `:105` points to `--help`). `## Doctor` follows at `:107`.
  - **Generated sections.** `## Adapter table (generated)` `:219` (markers `:221`/`:241`) and `## Certification dispositions (generated)` `:243` (markers `:269`/`:386`).

**Generators:**
- `packages/client-config/scripts/render-certification-table.mjs` (225 lines):
  - **Inputs.** It imports `../dist/adapters.js` (`:29`) and reads `scripts/certification-results.json`; its marker constants are at `:32-35`.
  - **Guards and renderers.** Roster guards exit 2 (`:41-71`). `renderAdapterTable` `:121-140`, `renderCertificationDetails` `:146-195`, `splice` `:201-209` (exit 2 on a missing pair). Composition is at `:211-213`.
  - **Modes.** `--check` (`:215-222`) prints `render --check: README.md marker sections are in sync` or the OUT OF SYNC line (exit 1). Write mode is `:224-225`.
- `packages/client-config/src/__tests__/certification-docs.test.ts`:
  - `:32` runs the renderer `--check` as a child process and expects status 0;
  - **Trap:** `:70-83` takes the FIRST line that starts `| ` and includes `` (`<id>`) ``. A new table placed earlier in the README must not use that cell form;
  - `:86-92` pins the npx caveat.
- `packages/client-config/src/__tests__/certification-process.test.ts:276-300`: `makePkgSandbox` copies only the renderer, the results, `dist/adapters.js` ("zero imports") and the README.
- `scripts/gen-skills.mjs`:
  - **Rendering.** `doNotEditHeader` `:51-56`; `renderReadme` `:58-89` (the table row at `:62`). `computeExpectedFiles` puts `README.md` in the expected map at `:109`.
  - **Check and write.** `--check` prints `${files.size} generated file(s) match source` (`:138`) and reports MISSING, DRIFT or STRAY. `writeTree` deletes stray files (`:146-147`). The header comment is `:20-21`.
- `scripts/lib/skills-pack.mjs`: `renderPackReadme` `:247`, intro `:251-258` (the first-of preset sentence ends "`full`, the default, shows every tool."), Layout `:268-274`, Third-party `:275-278`. The file keeps exactly its three imports. `readSkillFrontmatter(text, dirName)` `:350` returns `{fields, metadata, problems}` (a BOM is a problem).
- `packages/client-config/skills-pack/README.md`: generated; today 11859 bytes, 49 lines, sha256 `00004f56…`.

**Doc and generated-file pins** (all in `packages/iris-mcp-all/src/__tests__/`):
- **`story-41-2-doc-claims.test.ts`:**
  - `RETIREMENT_SENTENCE` `:44-46` must be a whole line in both READMEs (`:118-125`);
  - `TOOL_SUPPORT_NOTE` `:49` is a substring check (`:127-131`);
  - the sweep `:133-169`: a line naming `objectscript-review` must equal `RETIREMENT_SENTENCE`. `.changeset/` is scanned except two files; `CHANGELOG.md` is not scanned.
- `skills-generated-frontmatter.test.ts:230-243` (`skills/README.md`: banner, generator name, `| Skill | Server | Tool preset | Description |`, 12 rows, catalog path) and `:204` (comment: the generator pointer lives in `skills/README.md`).
- `skills-pack-rule.test.ts:495-500` (`skills/README.md` has 12 `` | `name` | `` rows, none retired).
- **Still green under D1:**
  - `story-41-5-qa-gen-skills-refusal.test.ts:125,151` (deletes and regenerates `skills/README.md`);
  - `story-41-1-qa-pack-scratch-cli.test.ts:358,363,383` (`13 generated file(s)`, `MISSING generated file: skills/README.md`);
  - `story-39-6-doc-claims.test.ts:480-500` (scans every `packages/*/README.md` and `skills/README.md` for `doc-claims-patterns.ts:8-19` claims).
- `skills-pack.test.ts`: `README_INTRO` `:130-131`, `README_LAYOUT` `:135`, `ruleLine` `:151`, `expectedReadme` `:155-182`, and the golden `:480-485` (bytes, lines, sha).
- `docs-prompt-sync.test.ts` (prompt names, `110 tools` `:127`, `12 prompts` `:149-157`; unchanged claims).

**Installer surface the tests read** (`packages/client-config/src/`):
- **`pack-targets.ts`:**
  - types `:19-34`; `RULE_FORM_DIRS` `:37`, `RULE_FORM_EXTENSIONS` `:44`, `NOTICE_FILENAME` `:51`, `ADAPTATION_MARKER` `:54`;
  - `PACK_ROUTES` `:57-78` (`{id, skillsDir, rule: {kind:"file", form, dir} | {kind:"block", host}}`), `PACK_ROUTE_IDS` `:81`;
  - `CLAUDE_DESKTOP_REFUSAL` `:114-116`;
  - `PACK_TARGETS` `:128-348`, 17 rows in this order: claude-code, claude-desktop (route `null`), cursor, vscode, cline, roo-code, windsurf, codex, gemini, zed, goose, kimi, kimi-code, pi, jetbrains-junie, kilo-code, agents.
- **Exports.** `index.ts:131-145` exports the targets, routes and refusal, but NOT `NOTICE_FILENAME`, `RULE_FORM_*` or `ADAPTATION_MARKER`; import those from the module itself. `pack-plan.ts:54` `MANIFEST_PATH`, `:162` `LINK_DETAILS` (exported through `index.ts:164-166`).
- **`cli/clients.ts`:**
  - `cmdSkills` `:1821`; a null route refuses through `usageError` (`:1849-1851`, `:596-598`): `Error: <msg>\n\nUsage: <SKILLS_USAGE>\n`, exit 2, no JSON envelope;
  - `runCli` `:1958`; the first argument is the command (`:1966`).
- **`__tests__/qa-41-6-helpers.ts`:** `BIN`, `REPO_ROOT`, `PACK_ON_DISK`, `RULE_STEM`, `NOTICE`, `MANIFEST`, `ADAPTED`, `SPAWN_TEST_TIMEOUT` (180 s), `BACKUP_ROOT`, `assertBinFresh()`, `runBin(sandbox, args, {cwd})` (from-scratch env with a temp home, 90 s timeout), `lstatTree(dir, {modes})`, `treeDiff`, `packSkillFiles`, `packNotice`, `packRuleForms`, `expectedSkillFiles(skillsDir)` (the skills plus the notice beside adapted files), `filesUnder`, `backupsOf(home, rel)`.
- **`__tests__/pack-test-helpers.ts`:**
  - `makeSandbox()` / `removeSandboxes()`, `BOM`;
  - `hostFixtures(stem)` returns 16 fixtures: lf, crlf, bom+lf, bom+crlf, no final newline (lf and crlf), bom with no final newline, lone cr at the end, whitespace-only (terminated and unterminated), single newline, empty, bom only, comments and look-alike markers, another rule's and another tool's block, and non-ascii with invalid utf-8.
- **What 41.6's process suites drive** (`skills-cli-process`, `qa-41-6-routes-process`, `qa-41-6-byte-fixtures-process`, `qa-41-6-safety-process`):
  - only claude-code, codex, cursor and gemini, plus claude-desktop (a partial `toContain`) and an unknown id;
  - none loops over `PACK_TARGETS`, and none calls `readSkillFrontmatter`;
  - 12 agents-route ids never run end to end.
- **Config and conventions.**
  - **Runtime import from `scripts/lib`:** `pack-targets.test.ts:29-30,155` (`pathToFileURL(path.join(REPO_ROOT,"scripts","lib","skills-pack.mjs"))`).
  - **client-config vitest:** includes `src/**/*.test.ts`, excludes `*.integration.test.ts`, sets no `testTimeout` (5 s default), and runs files in parallel.
  - **The header convention:** `packages/iris-mcp-all/src/__tests__/epic40-capstone-gate.test.ts:1-45` ("Epic N capstone gate: … in the default suite (project rule #21), each row naming the path it guards (rule #59)"; one "Path:" per row).

**Presets (DW-624 oracle):**
- `scripts/lib/tool-catalog.mjs:93` `loadToolPresetCatalog(root)` returns `{owners, rosters[pkg][preset].{include,exclude}}` from the built `dist/tools/presets.js`.
- `scripts/lib/validate-prompts-core.mjs:80` `declaredToolPreset(text, packRel)`, and the visibility rule `:200`.
- `packages/iris-admin-mcp/src/tools/presets.ts:28` (`core.include` holds `iris_user_manage`) and `:68` (`developer.exclude` holds it).
- `packages/iris-admin-mcp/src/prompts/provisionProjectEnvironment.ts:26` (`preset: "core"`) and `:49` (names `iris_user_manage`). It is the only skill that a preset other than its declared one hides a tool from.

**DW-611:**
- **`turbo.json`** (whole file): `build` `{dependsOn:["^build"], outputs:["dist/**"]}`, `test` `{dependsOn:["build"]}`, `lint` `{}`, `type-check` `{dependsOn:["^build"]}`.
- **turbo 2.9.4.** `node_modules/turbo/bin/turbo` is the Node launcher. It supports `$TURBO_ROOT$`/`$TURBO_DEFAULT$` inputs, root `pkg#task` keys (which do not inherit the generic task) and `dependsOn: ["pkg#task"]`. `.gitignore:29` ignores `.turbo/`.
- **Today's dry run.** `@iris-mcp/all#test` has `dependencies ["@iris-mcp/all#build"]` (a `<NONEXISTENT>` placeholder that orders the five server builds) and 149 inputs, none outside the package. `@iris-mcp/client-config#build` is absent.
- **The dry-run JSON shape.** Top-level keys: `id, version, turboVersion, monorepo, globalCacheInputs, packages, envMode, frameworkInference, tasks, user, scm`. Per-task keys: `taskId, task, package, hash, inputs, …, dependencies, dependents, resolvedTaskDefinition, …`. A scratch copy without `node_modules` works through `--cwd` in under 0.1 s and hashes by content.
- **Root reads.** `@iris-mcp/all` tests read the repo root broadly: `README.md` (32 files), `CHANGELOG.md` (24), `.changeset/` (22), `tool_support.md` (21), `docs/` (13), `.claude` (27), `src/` (11), `extensions/` (7), plus `scripts/` (~80), `skills/` (~20) and `skills-pack-src/`. Shared (9 files), dev (2) and client-config (4) tests also read root paths (`scripts/lib/*.mjs`, `docs/client-config/`).
- **`scripts/lib/installer-payload-probe.mjs:32-36`:** imports `<root>/packages/client-config/dist/pack-plan.js`, exit 1 with one stderr line on failure.
- **`scripts/lib/provenance-inputs.mjs:177-213`:** `gatherInstallerDistributions` / `runInstallerProbe` turn a probe failure into the fail-closed `installer` distribution.
- **`scripts/lib/dist-freshness.mjs`:** `checkDistFresh(pkgDir, pkgName)` never throws. A package without `src/` passes; `src/` newer than `dist/` (ignoring `__tests__`) is stale.
- **`story-41-1-qa-fixture.ts:37-52`:** `makeScratchRepo({clientConfigManifest:true})` copies only client-config's `package.json` and `dist/`, never `src/`. So the guard cannot fire on existing scratch roots.
- **`story-41-6-qa-installer-provenance-cli.test.ts`:** the green control `:56-61` (`5 distribution(s).`), the fail-closed rows `:91-127`, and the `FAIL_CLOSED` regex `:92`.
- **`packages/iris-mcp-all/src/__tests__/pack-fixture.ts`:**
  - `REPO_ROOT` `:17`, `makeTempRoot` `:30`, `removeTempRoot` `:34`, `put` `:39`;
  - `runNode(cwd, script, args, {env, timeout})` `:60`, whose env merges `process.env`.

**Release and back-compat:**
- **CHANGELOG and changesets.** `CHANGELOG.md:5` is the newest section (41.6), with Added/Changed/Tests/Known limits and the installer's known limits at `:87-100`. Precedent changesets: `.changeset/story-41-6-skills-and-rules-installer.md` (`minor`) and `story-40-4-*.md` (`patch`, a docs/capstone story).
- **Tool counts:**
  - each server's `src/__tests__/index.test.ts`: admin `:48` 27, data `:59` 8, dev `:86` 33, interop `:48` 25, ops `:49` 22;
  - `story-41-5-qa-preset-oracle.test.ts:101-109` (total 115 under `full`), `story-40-1-doc-claims.test.ts:146,161`;
  - `tools-list-snapshot.test.ts` plus `pnpm gen:tools-list-snapshot:check` (`fixtures/tools-list-snapshot.json`), and `story-39-6-qa-snapshot-cli.test.ts:148` (115 entries).
- **The prompt wire.** `story-41-2-qa-prompts-stdio-wire.test.ts:280-313` holds `WIRE_GOLDEN`, the 16 hashes captured at `26dc8b2`.
- **Governance.** `packages/shared/src/__tests__/governance-baseline-check.test.ts:72,84`.
- **Bootstrap.** `packages/shared/src/bootstrap-classes.ts:25` (`5296a1c836f4`).
- **The closed-port server env:** `epic37-default-outage-gate.test.ts:216-219` (`IRIS_HOST=127.0.0.1`, `IRIS_PORT=9`, dummy user and password). Servers start with an unreachable IRIS ("an unreachable peer never does" fail startup).

## Tasks & Acceptance

**Execution** (in dependency order):

- `scripts/gen-skills.mjs` -- D1 (AD-14).
  - **The README.** `renderReadme` renders the golden pointer (Design Notes); the entries argument may stay unused or be dropped.
  - **Comments.** Update the `:58` docstring and the header comment to "a pointer to the catalog and the installer".
  - **Run.** `pnpm gen:skills` (13 files).
- `scripts/lib/skills-pack.mjs` -- DW-624 (AD-28).
  - **The intro.** `renderPackReadme` gains the golden not-nested sentence after "`full`, the default, shows every tool.", keeping exactly the three imports.
  - **Run.** `pnpm gen:pack` (23 files), then record the catalog's new bytes, lines and sha256 from the file.
- `packages/client-config/scripts/render-certification-table.mjs` -- D2 (AD-14; extends the renderer, Rule 2).
  - **The section.** Add the `PACK-TARGETS-TABLE` section: import `../dist/pack-targets.js`, read the rule stems from `../skills-pack/rules/claude-code/*.md`, render the golden table, and splice it.
  - **The guard.** Exit 2 on a roster violation:
    - not 17 rows, or a duplicate id;
    - a routed row whose route has no `PACK_ROUTES` entry;
    - a `null` route without `noRouteReason`;
    - a row without an `https://` source.
  - **The header comment** names the third section.
- `packages/client-config/README.md` -- AC 41.7.1:
  - add the `## Skills pack targets (generated)` section with its marker pair directly after `## Installing the skills pack`;
  - in `## Installing the skills pack`, add the golden example block and the link line;
  - run the renderer in write mode, then `--check`.
- `README.md` -- AC 41.7.1, DW-624 (D3, D4):
  - **The new section.** Add `### The skills pack` (golden) after `### Using the prompts`, inside `## Workflow Prompts & Agent Skills`.
  - **Rewrites.** Replace `:825` with the golden retirement sentence, and rewrite the `:830` bullet (golden).
  - **The manager section.** Add the golden one-sentence pointer at the end of the `:240` paragraph ("`apply` prints the pending diff first…").
- `packages/iris-dev-mcp/README.md` -- `:271` becomes the golden retirement sentence. In the dev, admin, interop and ops READMEs, the `Also installable as [Agent Skills](../../skills/README.md).` line becomes `Also installable as [Agent Skills](../../README.md#the-skills-pack).`
- `tool_support.md` -- `:450`: replace only the closing clause "and the generated [`skills/`](skills/README.md) install pack." with "and the [skills pack](README.md#the-skills-pack), which installs these workflows as Agent Skills." The `TOOL_SUPPORT_NOTE` substring stays intact.
- `packages/client-config/src/__tests__/epic41-capstone-gate.test.ts` (new) -- AC 41.7.2 (the epic-done gate, Rule #21). It is the design in Design Notes "Capstone":
  - **Structure.** `beforeAll(assertBinFresh)`, then one `it` per `PACK_TARGETS` row (17), each in its own sandbox with `SPAWN_TEST_TIMEOUT`, plus one completeness `it`.
  - **Header.** It follows the epic capstone convention, naming the path each row guards.
  - **Reuse.** It reuses `qa-41-6-helpers.ts` and `pack-test-helpers.ts`, and copies nothing.
- `packages/client-config/src/__tests__/skills-docs.test.ts` (new) -- AC 41.7.1, client-config README:
  - **Command lines.** Every `iris-mcp-clients skills …` line of the README (the `:40` command line and the new example block) passes three checks:
    - its flags are a subset of the flags of the bin's own `Usage: iris-mcp-clients skills …` line (from `runBin(sandbox, ["skills"])`, exit 2);
    - its `--client` value is a routed `PACK_TARGETS` id;
    - each example runs with `--dry-run`, appended unless present, and `--project <temp>` replacing any project, and exits 0 with nothing written.
  - **The table.** It holds 17 body rows whose `--client` cells equal the `PACK_TARGETS` ids in order.
  - **Anchors.** `#skills-pack-targets-generated` and `#installing-the-skills-pack` resolve to headings.
- `packages/client-config/src/__tests__/certification-process.test.ts` -- extend `makePkgSandbox` to also copy `dist/pack-targets.js` and `skills-pack/rules/`. Add a row: a sandbox README whose `PACK-TARGETS-TABLE` row is edited makes `--check` exit 1, and a re-render restores it (the red proof of the generated table on its real `--check` path).
- `packages/iris-mcp-all/src/__tests__/story-41-7-doc-claims.test.ts` (new) -- AC 41.7.1 and DW-624:
  - **Scope.** Every row of the Design Notes claim-to-pin map for the root README, the catalog sentence, the package README links and `tool_support.md`.
  - **Freshness and imports.** `beforeAll` runs `checkDistFresh` for client-config, then imports `dist/pack-targets.js` and `dist/pack-plan.js` by `pathToFileURL`.
  - **Bin runs.** It runs the bin with `runNode` (`{env: {HOME, USERPROFILE, APPDATA}}` set to temp dirs, `cwd` a temp project).
  - **Presets.** `loadToolPresetCatalog(REPO_ROOT)` gives the rosters.
- `packages/iris-mcp-all/src/__tests__/story-41-2-doc-claims.test.ts` -- `RETIREMENT_SENTENCE` becomes the golden 41.7 sentence. Every other assertion stays.
- `packages/iris-mcp-all/src/__tests__/skills-generated-frontmatter.test.ts:230-243` and `skills-pack-rule.test.ts:495-500` -- D1.
  - **The pointer.** The `skills/README.md` pin becomes the pointer shape. It contains `DO NOT EDIT`, `gen-skills.mjs`, `packages/<server>/src/prompts/`, `packages/client-config/skills-pack/README.md`, `iris-mcp-clients skills install` and `#the-skills-pack`. It does not contain `| Skill |`, `cp -r` or `objectscript-review`.
  - **The 12-row check moves to the catalog.** Its `## Workflow skills` section lists exactly the 12 `skills/*` names, and none is retired.
  - **The `:204` comment** stays true.
- `packages/iris-mcp-all/src/__tests__/skills-pack.test.ts` -- `README_INTRO` gains the golden sentence. The golden (`:480-485`) takes the byte, line and sha256 values from the regenerated file (Rule #51).
- `turbo.json` -- DW-611 (D6): the golden config.
- `packages/iris-mcp-all/src/__tests__/story-41-7-turbo-test-graph.test.ts` (new) -- DW-611 (the design is in Design Notes "DW-611").
- `scripts/lib/installer-payload-probe.mjs` -- DW-611 occurrence (41.6 review): before the import, run `checkDistFresh(<root>/packages/client-config, "@iris-mcp/client-config")`, imported from `./dist-freshness.mjs` (reuse; no new freshness logic). On `!ok`, write one stderr line `client-config's dist is not fresh: <reason>` and exit 1.
- `packages/iris-mcp-all/src/__tests__/story-41-6-qa-installer-provenance-cli.test.ts` -- extend it with the stale-`src/` row. It sits in a scratch root from `makeScratchRepo({clientConfigManifest:true})`, plus `packages/client-config/src/index.ts` with an mtime 10 s after the newest `dist/` file. `check-provenance.mjs` must exit 1, `problemPairs` must equal `["distribution installer"]`, and stderr must match `FAIL_CLOSED` and contain `not fresh`.
- `CHANGELOG.md`, `.changeset/story-41-7-skills-pack-docs-and-capstone.md` -- AD-29 (D8):
  - **The changeset** is `"@iris-mcp/client-config": patch`. It must not name the retired prompt (the 41.2 sweep scans `.changeset/`).
  - **The CHANGELOG section** goes on top: `## [Pre-release — YYYY-MM-DD] — Story 41.7: Skills pack docs and capstone`, dated the day the implement stage runs, with Added, Changed, Tests and Known limits (Design Notes), and the counts paragraph.
- `_bmad-output/implementation-artifacts/spec-41-7-skills-pack-docs-and-capstone.md` (`## Verification`) -- AC 41.7.3, the implement stage's part. Run only steps 2 and 5 of the Design Notes live procedure in a scratch directory, with the built bin and a temp `HOME`: the install gives 18 skill directories and the rule, and the uninstall leaves only `.claude/settings.json`. Record the result. If the bin's output differs, correct the procedure text. Never run `claude`, and never write the hook or `mcp.json` files; the lead does that at smoke.

**Acceptance Criteria:**

- **AC 41.7.1, the docs.** Given the built client-config dist, the pack and the built server dists, when `story-41-7-doc-claims.test.ts`, `skills-docs.test.ts`, `certification-docs.test.ts`, `certification-process.test.ts` and `story-41-2-doc-claims.test.ts` run, then:
  - every root README claim matches its source, the documented commands run;
  - the client-config table is in sync with `PACK_TARGETS`, and a hand edit fails `--check`;
  - `skills/README.md` is the generated pointer, so the catalog is the only skill list.
- **DW-624.** Given the admin rosters, when the doc test runs, then the root README section and the catalog both say the presets are not nested. Their `provision-project-environment` / `iris_user_manage` example holds: `core` shows the tool, `developer` hides it, and the skill declares `core`.
- **AC 41.7.2, the capstone.** Given the built bin, when `epic41-capstone-gate.test.ts` runs in client-config's default suite, then:
  - all 17 legs pass as in the I/O matrix;
  - each Design Notes capstone mutation, applied on the built-bin path, turns it red;
  - each red is recorded as a `mutation:` line naming the path.
- **AC 41.7.3, the live check.** Given the Design Notes procedure, when the lead runs it once at the smoke step, then the positive leg meets both oracles, and the contrast leg meets neither while its `.cls` `PreToolUse` still fires. The lead appends the record under `## Verification`: CLI version, commands without secrets, the init `skills` excerpt, the reduced hook log, `total_cost_usd` per leg, and the cleanup.
- **DW-611, ordering and cache.** Given the working-tree `turbo.json`, when `story-41-7-turbo-test-graph.test.ts` runs, then `@iris-mcp/all#test` depends on `@iris-mcp/client-config#build` and no `#test` task is cacheable. Reverting either change turns it red.
- **DW-611, the probe.** Given a client-config `src/` newer than its dist, when `check:provenance` runs, then it fails closed as `installer`.
- **Back-compat, the epic close.** Given the epic base `25e10bda15a3376c8fff8f55b56dd6c625174f49`, when the (once) epic-close checks run, then every Design Notes "Epic close" proof holds with the listed values.

### Review Findings

Code review 2026-10-20 (first review; tier full-opus; all four layers delivered: blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor). 48 rows, grouped into 16 entries (high 0, medium 5, low 11); 12 patched, 4 ledgered, 20 rows rejected, plus the rejected half of one patched row (appendix). Each patch's mutation line is under `## Verification`, "Code-review record".

- [x] [Review][Patch] (med; fix-risk low, one line plus its pin) The manager-section pointer "It also installs the skills pack" named `apply`, which writes only `.mcp.json`, and `story-41-7-doc-claims` pinned the false text [README.md:240] — now names `iris-mcp-clients skills install` (lead authorization 1; golden amended, Spec Change Log).
- [x] [Review][Patch] (med; fix-risk low, docs plus bin-driven pins) The root README's "The full list is in the client-config README" was false (Rule #56): that section held none of seven 41.6 limits, among them that `--project ~` installs the rule where every session loads it [packages/client-config/README.md:113] — a "Known limits" bullet added, each limit pinned on the built bin with a control run in `skills-docs.test.ts`.
- [x] [Review][Patch] (med; fix-risk low, a helper move) Rule 2: the capstone copied `ancestors` and `ageAllFiles`/`mtimes` (as `mtimesOf`) from `qa-41-6-routes-process.test.ts`, and QA's home check repeated the capstone's `backupCount` loop [packages/client-config/src/__tests__/epic41-capstone-gate.test.ts:102] — all four now live in `qa-41-6-helpers.ts`.
- [x] [Review][Patch] (med; fix-risk low) Rule 2: four copies of the heading-anchor function with two algorithms (ASCII-only and not fence-aware in three) [packages/iris-mcp-all/src/__tests__/story-41-7-doc-claims.test.ts:95] — one `markdownHeadingSlugs` in `pack-fixture.ts` for `@iris-mcp/all`; `skills-docs.test.ts` keeps a copy of the same algorithm, reason in Design Notes "Reuse".
- [x] [Review][Patch] (med; fix-risk low) The DW-624 roster pin read the admin dist with no freshness check, so a per-package run stayed green after a `presets.ts` edit without a rebuild [packages/iris-mcp-all/src/__tests__/story-41-7-doc-claims.test.ts:137] — `beforeAll` checks the admin dist too.
- [x] [Review][Patch] (low; lead authorization 2) Four pre-existing links to `#read-only-mode-point-...` were broken (the em dash leaves two hyphens) and exempted in `qa-41-7-doc-links`, whose fail-when-fixed row would turn red on a fix [README.md:81] — links corrected, exemptions and that row removed.
- [x] [Review][Patch] (low) The turbo graph test copied no package-level `turbo.json[c]`, which overrides the root task definitions [packages/iris-mcp-all/src/__tests__/story-41-7-turbo-test-graph.test.ts:56] — copied when present.
- [x] [Review][Patch] (low) Hermeticity: the claude-desktop and `--scope user` refusals and the asks-first run used the shared project, so a regressed refusal would cascade into later rows [packages/iris-mcp-all/src/__tests__/story-41-7-doc-claims.test.ts:200] — each gets its own folder and asserts it stays empty.
- [x] [Review][Patch] (low) The hard-link pin did not check that the link survives the refusal [packages/iris-mcp-all/src/__tests__/story-41-7-doc-claims.test.ts:323] — inode and `nlink` asserted.
- [x] [Review][Patch] (low) "it takes skills only as an uploaded ZIP" was pinned only against its own wording [packages/iris-mcp-all/src/__tests__/story-41-7-doc-claims.test.ts:205] — pinned to `CLAUDE_DESKTOP_REFUSAL` from the dist.
- [x] [Review][Patch] (low) The CHANGELOG's Tests section named none of QA's three files [CHANGELOG.md:62] — added, with the review's doc changes under Changed.
- [x] [Review][Patch] (low, Rule 19 tracking) MC-2 and MC-4 to MC-7 named no path; the back-compat AC and the doc-claims freshness guards had no mutation line [## Verification] — paths added, mutations applied and recorded.
- [x] [Review][Defer] The client-config README's status line (`:5`) and the root README's package summary (`:924`) still describe the package before Epic 41 [packages/client-config/README.md:5] — deferred: DW-630 occurrence (42-1-pre-publish-package-fixes, the package summary fixes).
- [x] [Review][Defer] No `PACK_TARGETS` row or id names Antigravity CLI, which the gemini row's own note says replaced Gemini CLI for unpaid users [packages/client-config/src/pack-targets.ts:241] — deferred: DW-626 occurrence (42-9 re-dispositions; the 41.6 seam forbids a row change here).
- [x] [Review][Defer] `docs/client-config/*` has no pointer to the skills installer and three links to the same broken `#read-only-mode-point-...` anchor [docs/client-config/claude-code.md:306] — deferred: DW-631, wontfix-accepted with reopen_if (the Never list excludes these files).
- [x] [Review][Defer] `qa-41-7-doc-links` checks only the nine documents this story changed; the same checker over every tracked `*.md` finds other broken links (`packages/shared/README.md:108`, three historical `docs/known-bugs-*` links) [packages/iris-mcp-all/src/__tests__/qa-41-7-doc-links.test.ts:26] — deferred: DW-632, wontfix-accepted with reopen_if.

**Rejected** (one line each):
- Blind: the `:830` bullet says "with the knowledge skills and the always-on rule" twice — low, spec-bound golden text (D-section `:830` replacement); flagged to the lead.
- Blind: the generated Why column repeats `why` text in its `Installer note:` — low, spec-bound cell composition over `PACK_TARGETS` data.
- Blind: the CHANGELOG known-limits bullet names AC 41.7.3 — low; it is the spec's CHANGELOG known limit, and CHANGELOG sections name stories and ACs by convention.
- Edge: `cell()` does not escape a backslash before a pipe or a newline — low; no `PACK_TARGETS` text holds either (reviewed constants).
- Edge: QA's GFM cell split treats `\\|` as escaped — low; same unreachable input.
- Edge: a route named `toString` passes the unknown-route guard — false in practice; `route` is a typed union in `pack-targets.ts`.
- Edge: a dist without `PACK_TARGETS_CHECKED_ON` renders "checked undefined" — low; a dist that old has no `pack-targets.js` at all.
- Edge: the guard's empty-`sources`, empty-`noRouteReason` and write-mode branches have no sandbox row — low; the guards run over reviewed constants and each main branch is pinned.
- Edge: `assertBinFresh` compares newest `src` with newest `dist` — low; `tsc` re-emits the changed file, and a hand-touched dist is deliberate (shared `checkDistFresh` semantics).
- Edge: the probe guard passes a `skipped: true` result — unreachable; client-config's `files` ships `dist`.
- Edge: inherited `TURBO_*` variables reach the turbo child — verified harmless: a dry run under an outer `turbo run test` (inheriting `TURBO_INVOCATION_DIR`, `TURBO_HASH`) succeeded with the same graph; no remote cache is configured.
- Edge: a link-refused run could write into the shared temp home unseen — low; the refusal precedes any write, and `qa-41-6-safety-process` owns that matrix.
- Edge: fixed link-test folder names would hit `EEXIST` on a retry — theoretical; no retry or repeat is configured.
- Edge: `lstatTree` compares directory modes only — theoretical; `writeFileSync` keeps an existing file's mode and created files are removed.
- Edge: the capstone's `utimesSync` follows a symlink — unreachable; no link is seeded (the shared `ageAllFiles` now skips links anyway).
- Edge: reference-style and angle-bracket links are not scanned — low; the nine documents use inline links.
- Edge: the slug drops `_emphasis_`, entities and setext headings — low; no such heading in the checked documents.
- Edge: no capstone-safety leg deletes a host the installer created — low; that host holds only the installer's block, so nothing of the user's is lost.
- Verification-gap: the clean-home check counts regular files only — theoretical; the installer creates no directory or link under the home outside the backups.
- Verification-gap: `certification-docs.test.ts` run alone stays green on a stale dist — low; decided with the lead's question 3 (Spec Change Log): the default suite and the loop command fail closed.
- Acceptance-auditor: "It writes only the files it installs and its own marked block" omits the home backups — low, spec-bound golden text scoped to the project; the backups are in the limits bullet.

## Spec Change Log

- 2026-10-20 (lead spec gate): D1–D8 were taken as recommended (wave-7 decisions #35–#42). D6's spine row "Turbo test tasks" is added to the Consistency Conventions (Rule 20), and the spine lint passed. The plan-stage `deferred:` item (the npx form) is harvested at dev complete to `42-1-pre-publish-package-fixes`. The lead runs the AC 41.7.3 live check at smoke (D7).
- 2026-10-20 (code review, lead authorization 1): the golden manager-section pointer was false. It followed the `apply` sentence, so "It also installs the skills pack" named `apply`, which writes only `.mcp.json` (QA's runtime check; `cmdApply` never plans a pack change). Original: "It also installs the skills pack into a project: see [The skills pack](#the-skills-pack)." Amended: "`iris-mcp-clients skills install` also installs the skills pack into a project: see [The skills pack](#the-skills-pack)." `README.md:240` and its pin in `story-41-7-doc-claims.test.ts` changed with it.
- 2026-10-20 (code review, lead authorization 2): the four pre-existing links to `#read-only-mode-point-it-at-production-with-one-environment-variable` (`README.md:81,391`, `packages/iris-dev-mcp/README.md:45,197`) now use the heading's real anchor, `#read-only-mode--point-it-at-production-with-one-environment-variable` (the em dash leaves two hyphens; checked with the link test's own slug function). `qa-41-7-doc-links.test.ts` lost its exemptions and its fail-when-fixed row, so it pins every link of the nine documents. The same broken anchor remains in `docs/client-config/{claude-code,claude-desktop,cursor}.md`, which this spec's Never list excludes (ledgered).
- 2026-10-20 (code review, Rule #42): Design Notes D3 assumed the client-config README held the installer's full list of known limits ("plus a link to the client-config README's full list"). It held none of the 41.6 limits beyond the refusals. No golden text changed: the client-config README's `## Installing the skills pack` gained a "Known limits" bullet (the seven 41.6 limits it lacked), each pinned on the built bin in `skills-docs.test.ts`, so the root README's "The full list is in the client-config README" is true.
- 2026-10-20 (code review, lead question 3, decision): the renderer stays a pure reader of client-config's built dist and does not fail closed by itself. Its `--check` is a gate only through the default suite, where `qa-41-7-generated-table-gate.test.ts` runs `assertBinFresh` before it (and the capstone and `skills-docs.test.ts` fail the same run on a stale dist); `check:provenance` differs because it is a standalone gate CLI. A guard inside the renderer would need the repository's `scripts/lib/` beside a package script, which `certification-process.test.ts`'s sandbox package does not have. Residual: `certification-docs.test.ts` run alone stays green on a stale dist.
- 2026-10-20 (code review, lead question 4, decision): the epic-done gate is genuine where it is. `epic41-capstone-gate.test.ts` drives the built bin for all 17 ids and is red on the built-bin path for every AC 41.7.2 property (MC-1 to MC-8). QA's rows in `qa-41-7-capstone-safety.test.ts` pin AD-30 properties the AC does not list (backups, a home holding only backups, plain host shapes on block routes), run in the same default suite on the same bin with the same helpers, and are named in the capstone's header as its companion; moving them would change no path the gate guards.

## Review Triage Log

### 2026-10-19 — Review pass
- verdicts: 34 findings — high 0, medium 6, low 28, false 0, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind 1: the capstone's "16 byte shapes" overclaims, because three shapes (crlf, bom+lf, lf) land on legs whose host the block editor never edits — spec-bound: Design Notes "Capstone fixtures" states "13 of the 14 block-route legs" and that claude-code's CRLF and cursor's BOM+LF are foreign content; the CHANGELOG says "seeded with foreign content", which holds for all 16.
  - `[low]` `[reject]` Blind 2: the generated Why column repeats text from `why` and `Installer note:` — the join is the golden's (`why`, then ` Installer note: <note>`), and the text is `PACK_TARGETS` data the intent forbids editing.
  - `[low]` `[defer]` Blind 3: the Cursor and VS Code `why` text never says that the client reads `.agents/skills/` — pre-existing 41.6 installer data the intent excludes (`PACK_TARGETS` rows); deferred (frontmatter item 2).
  - `[low]` `[reject]` Blind 4: root README `:240` appends "It also installs the skills pack" to the `apply` sentence, so "It" reads as `apply`; and the `:830` bullet says "with the knowledge skills and the always-on rule" twice — both are the Design Notes golden text, which the lead decided (D3, D4); the fix edits the spec. Flagged to the lead in the run report.
  - `[medium]` `[patch]` Blind 5 + Verification-gap 7: the symlink-and-hard-link known limit is pinned only for a symlink at `AGENTS.md` — patched: two tests (a link above a written path, a second hard link), each mutation-proven.
  - `[medium]` `[patch]` Blind 6: several pinning assertions have no `mutation:` line (the capstone completeness row, the turbo non-vacuity and build-cacheable tests, the combined README mutation) — patched: lines written for the first three; the turbo non-vacuity test could not go red (`>= 8`), so it was rewritten to compare with every package under `packages/` and then proven red; the 18-edit combined run stays, since Rule 19 scopes a mutation to the AC's pinning test.
  - `[low]` `[reject]` Blind 7: `check:provenance` fails on an unchanged tree after a branch switch, when `src/` mtimes move and `tsc` emits nothing — the mtime guard is the spec's (matrix row "Probe freshness"), and the probe prints `checkDistFresh`'s reason, which already gives the delete-`dist/`-and-`tsconfig.tsbuildinfo` remedy.
  - `[low]` `[reject]` Blind 8: no Claude Desktop ZIP how-to and no upgrade guidance in the new docs — the intent does not ask for either.
  - `[low]` `[defer]` Blind 9: `docs/client-config/README.md` has no pointer to the installer, and `packages/client-config/package.json` still describes a "read-only foundation" — `docs/client-config/*` is excluded by the intent; the stale package description is pre-existing, deferred (frontmatter item 3).
  - `[low]` `[reject]` Blind 10: the renderer hard-codes `skills-pack/rules/claude-code` for the rule stems — the task says to read the stems from `rules/claude-code/*.md`; the pack generator writes one stem for all three forms.
  - `[low]` `[reject]` Edge 1: the fixture rotation overclaims — same as Blind 1.
  - `[low]` `[patch]` Edge 2: the turbo child's environment is built from `PATH` alone, which can break the dry run on Windows — patched: it spreads `process.env` and sets HOME, USERPROFILE and the two telemetry switches.
  - `[low]` `[reject]` Edge 3: a source URL with `)`, `|` or a space passes the `https://` check — no real input reaches it: `PACK_TARGETS` sources are reviewed constants, and the guard's job is the scheme.
  - `[low]` `[reject]` Edge 4: the rule stems come only from `rules/claude-code` — same as Blind 10.
  - `[low]` `[reject]` Edge 5: "a file you edit after installing is kept" is pinned by README and `--help` text only — the claim-to-pin map pins the `--help` words; 41.6's process suites pin the behavior.
  - `[low]` `[reject]` Edge 6: the uninstall example is dry-run against an empty project — the spec's rule for the example commands (exit 0, nothing written); the capstone runs a real uninstall on every route.
  - `[medium]` `[patch]` Edge 7: the capstone's `read()` and `packRuleBytes()` copy `readProjectFile` and `packRuleForms` — Rule 2, spec says "copies nothing"; patched: the capstone imports both helpers (and `packNotice`).
  - `[low]` `[reject]` Edge 8: `:240` "It" — same as Blind 4.
  - `[low]` `[reject]` Edge 9: the removed `cp -r` path needed no build, so the new commands need a built dist — the root README section says "From the repository root (the package is not yet published to npm)", and the Quick Start documents the build; the section text is golden.
  - `[medium]` `[patch]` Verification-gap 1: the renderer's row-count and unknown-route guards have no test — patched: one sandbox row for each, both mutation-proven.
  - `[low]` `[patch]` Verification-gap 2: the `|` escaping in `cell()` is never exercised — patched with a sandbox row (a `|` in a `why`), mutation-proven.
  - `[low]` `[patch]` Verification-gap 3: the relative links of `skills/README.md` are not resolved by a test — patched: the pointer test pins both links and resolves them (file exists, anchor is a heading); mutation-proven.
  - `[low]` `[patch]` Verification-gap 4: the capstone's uninstall step and the end of its re-install step have no recorded red — patched: MC-8 (uninstall leaves the `.mdc` rule) written; the re-install tail is covered by MC-5.
  - `[low]` `[reject]` Verification-gap 5: AC 41.7.3 has no automated test and so no `mutation:` line — it is the lead's one-time live check by definition; its contrast leg is its falsifiability.
  - `[low]` `[reject]` Verification-gap 6: `:240` "It" — same as Blind 4.
  - `[medium]` `[patch]` Verification-gap 7: the hard-link half of the known limit is not pinned — grouped with Blind 5.
  - `[low]` `[reject]` Intent 1: the turbo edge and `cache: false` apply only under `turbo run`, not under a per-package `vitest run` — the decided D6 fix; per-package runs rely on `checkDistFresh`, which `story-41-7-doc-claims` runs.
  - `[low]` `[reject]` Intent 2: the probe guard keys on `packages/client-config/src` existing and compares mtimes — the spec's matrix row defines both.
  - `[low]` `[reject]` Intent 3: per-client placement claims are checked against the installer's data, and only Claude Code is checked live — D7 and the CHANGELOG's known limits say so.
  - `[medium]` `[patch]` Intent 4: the docs say the installer "asks before it writes", a claim no new test pinned — patched: `story-41-7-doc-claims.test.ts` runs the bin without `--yes` and without a terminal (exit 2, the plan printed, nothing written); mutation-proven.
  - `[low]` `[reject]` Intent 5: the installed `SKILL.md` frontmatter carries no not-nested wording — the intent names the root README and the catalog.
  - `[low]` `[reject]` Intent 6: the capstone's 17 ids come from `src/` and the red proof is prose in the spec — D5 decides both (oracles from `src/`; the red proof is the recorded `mutation:` lines).
  - `[low]` `[reject]` Intent 7: the CHANGELOG and changeset claims are outside the pin map — the lead recomputed the catalog's bytes, lines and sha256 from the file; the map does not list them.
  - `[low]` `[reject]` Intent 8: the client-config README commands use the bare `iris-mcp-clients` — the README's own existing convention; the golden example block.

## Design Notes

**Governing architecture** (Rule 6). None of the ACs contradicts an AD Rule.

- **AD-28:** one pack (the catalog renders through `gen:pack` only), the installer routes (documented exactly as the four routes), the catalog's preset wording (AD-28 already says "the presets are not nested"), and Duplicates (until 42.8 the claude-code route installs both; this is documented as a limit).
- **AD-30:** observed, never changed. The capstone pins ownership, idempotence and the preservation of foreign bytes end to end.
- **AD-14:** every generated file changes only through its generator.
- **AD-2:**
  - The cross-package doc and turbo checks live in `packages/iris-mcp-all`.
  - The capstone is single-package (client-config's own bin plus the repo's `scripts/lib`, which client-config tests already import at run time), so it lives in client-config.
  - DW-611 adds no package dependency: the ordering is a turbo `pkg#task` edge.
- **AD-29:** a `patch` changeset, no version or publish, and no new npx form.
- **AD-15:** no wire change; the epic-close proof is below.
- **Conventions:** "Pack names" and "Marked blocks" (documented, not changed).

**Orchestrator decisions needed** (the Lead's calls, delegated; the next wave-7 number is #35). The plan follows each recommendation.

- **D1. Orchestrator decision needed: the end state of `skills/README.md` (AC 41.7.1).** Recommended: reduce it to a generated pointer. It stays the 13th `gen:skills` file, with no skill table and no `cp -r`. Why:
  - **The contributor pointer.** Decision #19 moved the generator and prompt-source pointer there, and `skills/` stays a generated contributor directory.
  - **Superseded.** The table and the copy instructions are exactly what the catalog and the installer now supersede, so dropping them meets "superseded".
  - **Fewer pins move.** Two pins move (`skills-generated-frontmatter:230`, `skills-pack-rule:495`). Retiring the file would move four test files and the `13 → 12` count, break 7 doc links, and leave a stray-file trap.
  - Alternative: retire it from `gen:skills` (12 files; `writeTree` deletes the committed file). The generator pointer then moves into `skills-pack-src/README.md`.
- **D2. Orchestrator decision needed: where the per-client table comes from (AC 41.7.1, AD-14).** Recommended: generate the 17-row table into the client-config README from `PACK_TARGETS`, by extending `render-certification-table.mjs` with a `PACK-TARGETS-TABLE` marker pair. Its `--check` already runs in client-config's default suite (`certification-docs.test.ts:32`). The root README carries a hand-written 4-row route summary pinned by a sync test that renders the rows from `PACK_ROUTES`/`PACK_TARGETS`. Why:
  - It reuses the precedent and its guard, and keeps the table next to its data.
  - A client-config script writing the root README would make one package's generator own a root file.
  - A 4-row summary is cheap to sync-test.
  - Alternative: a root `scripts/` generator for a table in the root README.
- **D3. Orchestrator decision needed: the root README pack section's shape.** Recommended: the golden section below, as `### The skills pack` inside `## Workflow Prompts & Agent Skills`, so the four existing anchors stay valid.
  - **Commands.** They use the built-bin form `node packages/client-config/dist/cli/clients-cli.js skills …`, the root README's own convention (`:231-238`). That adds no unpinned npx form for 42.1 to rewrite (AD-29).
  - **Known limits.** Five bullets, each pinned, plus a link to the client-config README's full list.
- **D4. Orchestrator decision needed: the new retirement sentence** (`README.md:825` and `packages/iris-dev-mcp/README.md:271`, one whole line in both). Recommended: the golden sentence below. It names where `iris-mcp-clients skills install` puts the rule for each route, and those locations are pinned against `PACK_ROUTES`.
- **D5. Orchestrator decision needed: the capstone's home and shape (AC 41.7.2).** Recommended: `packages/client-config/src/__tests__/epic41-capstone-gate.test.ts`, with one sandbox per client and oracles from `src/`, the pack on disk and `readSkillFrontmatter`. Why:
  - client-config's own `test` task depends on its own `build`, so the bin is fresh.
  - The 41.6 helpers live there.
  - Earlier capstones sit in iris-mcp-all only because they span the servers.
  - Alternative: iris-mcp-all, importing client-config's test helpers across packages.
- **D6. Orchestrator decision needed: the DW-611 fix.** Recommended: two changes, both fully in force once made.
  - Make every turbo `test` task uncacheable (`cache: false`).
  - Add `"@iris-mcp/all#test": {dependsOn: ["build", "@iris-mcp/client-config#build"], cache: false}`.

  Why:
  - **The inputs span the repo.** The suite reads far more of the root than the ledger names (README 32 files, CHANGELOG 24, `.changeset/` 22, `docs/` 13, `.claude` 27, `src/` 11, `extensions/` 7). Shared, dev and client-config tests read root files too. So any input list is incomplete by construction (Rule #56), and an unlisted path replays a stale green.
  - **Nothing cached means nothing replayed.** With nothing cached, "a pack-source change invalidates the cached green" holds for every input.
  - **The cost is small here.** There is no CI, the parallel turbo run flakes, and per-package runs are the norm.
  - **The ordering** is a turbo edge, so AD-2 is untouched.

  Alternative (the ledger's literal wording): keep caching and give `@iris-mcp/all#test` `inputs: ["$TURBO_DEFAULT$", "$TURBO_ROOT$/skills-pack-src/**", "$TURBO_ROOT$/skills/**", "$TURBO_ROOT$/scripts/**", "$TURBO_ROOT$/packages/client-config/package.json", "$TURBO_ROOT$/packages/client-config/skills-pack/**", "$TURBO_ROOT$/packages/client-config/dist/**"]`.
  - Verified on a scratch copy: a one-byte `skills-pack-src` change moves the hash only under this config (`18e94a6cf789df3e` → `cea15e1acdfc264b`); today it does not.
  - The residual is that the doc-claims, CHANGELOG, `.changeset`, `src/`, `extensions/` and `.claude` reads stay outside the key, and shared, dev and client-config keep their gaps.
  - A workspace devDependency alone orders the build but hashes no root input, and it contradicts 41.6's reading of AD-2.

  **Spine follow-up for the lead (Rule 20), if D6 is taken:** a Consistency Conventions row: "Turbo `test` tasks are never cached; a test that needs another package's build gets a `pkg#task` `dependsOn` edge, never a package dependency."
- **D7. Orchestrator decision needed: AC 41.7.3, how the live check runs.** Recommended: the procedure below. Why:
  - **The installed artifact.** It installs with the built bin, so it checks the installed pack, not a hand copy.
  - **The contrast is an uninstall.** That proves both oracles see the installer's effect and can fail (#59).
  - **No IRIS contact.** The iris-dev server runs against a closed port with dummy credentials (the epic 37 gate's env), and the `PreToolUse` hook logs and then denies the `iris_doc_put` call. No IRIS write and no credential copy is needed. If something slips, the only reachable name is the disposable `ExecuteMCPv2.Temp.Probe417Live`.
  - **The fallback.** If the closed-port server does not advertise `iris_doc_put`, the procedure falls back to 41.2's write path, with the class deleted and leftovers `[]`.
  - Alternative: 41.2's procedure verbatim, with real credentials and one disposable write per leg.
- **D8. Orchestrator decision needed: the changeset.** Recommended: `"@iris-mcp/client-config": patch`. The README and catalog that ship in the package change, and no API or behavior does. The precedent is `story-40-4` (`patch`). `@iris-mcp/all` ships no files.

**AC interpretations** (apply and report):
- AC 41.7.2 "for every client route": every one of the 17 `PACK_TARGETS` ids, covering all four routes and claude-desktop's refusal.
- AC 41.7.3 "the rule activates for a `.cls` path" (defined under the live check below).
- AC 41.7.1 "superseded by the generated catalog" (D1).

**Ledger inbox:** DW-611 is addressed (turbo task, probe guard, two tests). DW-624 is addressed (catalog sentence, root README paragraph, the `:830` rewording, the doc pin). Nothing is declined.

**Golden: the root README section** (inserted before the `---` at `:832`):

~~~markdown
### The skills pack

The skills pack gives an agent the suite's ObjectScript know-how where the agent looks for it: 18 Agent Skills (6 knowledge skills and the 12 workflow skills above) and 1 always-on rule, the ObjectScript pre-write checklist. It ships inside [`@iris-mcp/client-config`](packages/client-config/README.md) as `packages/client-config/skills-pack/`, whose [catalog](packages/client-config/skills-pack/README.md) lists every skill with what it is for and its tool preset. `iris-mcp-clients skills install` copies the pack into one project, into the folders the chosen client reads:

| Route | `--client` | Skills go to | The always-on rule goes to |
|---|---|---|---|
| Claude Code | `claude-code` | `.claude/skills/` | `.claude/rules/iris-mcp-objectscript-pre-write.md` |
| Cursor | `cursor` | `.agents/skills/` | `.cursor/rules/iris-mcp-objectscript-pre-write.mdc` |
| Gemini CLI | `gemini` | `.agents/skills/` | a marked block in `GEMINI.md` |
| Every other client | `vscode`, `cline`, `roo-code`, `windsurf`, `codex`, `zed`, `goose`, `kimi`, `kimi-code`, `pi`, `jetbrains-junie`, `kilo-code`, `agents` | `.agents/skills/` | a marked block in `AGENTS.md` |

Claude Desktop (`claude-desktop`) has no route: it takes skills only as an uploaded ZIP, so the installer refuses it. The per-client table, with each client's reason and documentation sources, is generated from the installer's own data in the [client-config README](packages/client-config/README.md#skills-pack-targets-generated).

From the repository root (the package is not yet published to npm), preview the plan first, then install:

```bash
node packages/client-config/dist/cli/clients-cli.js skills install --client claude-code --project /path/to/your/project --dry-run
node packages/client-config/dist/cli/clients-cli.js skills install --client claude-code --project /path/to/your/project
node packages/client-config/dist/cli/clients-cli.js skills install --client cursor --project /path/to/your/project
node packages/client-config/dist/cli/clients-cli.js skills install --client gemini --project /path/to/your/project
node packages/client-config/dist/cli/clients-cli.js skills install --client codex --project /path/to/your/project
node packages/client-config/dist/cli/clients-cli.js skills uninstall --client claude-code --project /path/to/your/project
```

The installer prints its plan and asks before it writes (`--yes` skips the question). It writes only the files it installs and its own marked block, records them in `.iris-mcp/skills-pack.json` in the project, and leaves every other byte, `CLAUDE.md` included, as it was. Running the same install again changes nothing, and `uninstall` removes only what the installer put there.

**Tool presets are not nested.** A workflow skill declares, as `metadata.iris-tools-preset`, the first of `core`, `developer` and `full` under which every tool it names is visible. `developer` is not `core` plus more tools: it hides some tools that `core` shows. So a skill runs under its declared preset and under `full`, the default, but not necessarily under the other one. For example, `provision-project-environment` declares `core` and uses `iris_user_manage`, which the admin server's `developer` preset hides.

**Known limits:**

- Project scope only: `--scope user` is refused.
- Claude Desktop has no route, as above.
- The Claude Code route always installs both the skills and the rule; it does not detect a Claude Code plugin.
- A symbolic link at or above a path the installer would write, or a second hard link to such a file, refuses the run.
- A file you edit after installing is kept; `--include-modified` replaces or removes it after a backup under `~/.iris-mcp/client-manager/backups/skills-pack/`.

The full list is in the [client-config README](packages/client-config/README.md#installing-the-skills-pack).
~~~

**Golden: the other root-README and package-README lines.**

- **The retirement sentence (D4)**, one line, identical in `README.md` and `packages/iris-dev-mcp/README.md`:

  ``objectscript-review` was retired in Story 41.2: its checklist is now the always-on rule in the skills pack, which `iris-mcp-clients skills install` puts where each client loads it (`.claude/rules/` for Claude Code, `.cursor/rules/` for Cursor, a marked block in `GEMINI.md` for Gemini CLI and in `AGENTS.md` for every other client).`
- **`:830`.** Replace "and `metadata.iris-tools-preset`, the tool preset under which every tool it names is visible." with "and `metadata.iris-tools-preset`, the first of `core`, `developer` and `full` under which every tool it names is visible (the presets are not nested)." Then replace "Copy the skills you want into your project's `.claude/skills/` directory (see [`skills/README.md`](skills/README.md) for details);" with "Install them, with the knowledge skills and the always-on rule, through `iris-mcp-clients skills install` (see [The skills pack](#the-skills-pack));". The rest of the line stays.
- **The manager-section pointer.** "`iris-mcp-clients skills install` also installs the skills pack into a project: see [The skills pack](#the-skills-pack)." [AMENDED 2026-10-20, lead authorization at code review; see the Spec Change Log]

**Golden: `skills/README.md`** (the full output of `renderReadme`; lines 1-2 keep today's banner):

~~~markdown
<!-- DO NOT EDIT — generated by scripts/gen-skills.mjs from the registered PromptDefinitions across packages/*/src/prompts/*.ts.
     Regenerate via: pnpm gen:skills -->

# Generated workflow skills

This directory is **generated** from the suite's MCP prompts. Each `<name>/SKILL.md` is the text `prompts/get` renders for the prompt of the same name; its `description` and `metadata.iris-tools-preset` come from the prompt's `skill` field in `packages/<server>/src/prompts/`. To change a skill, edit its prompt, then run `pnpm gen:skills` and `pnpm gen:pack`.

These files are a source of the skills pack, not the copy you install. The [skills pack catalog](../packages/client-config/skills-pack/README.md) (`packages/client-config/skills-pack/README.md`) lists every skill with its tool preset, and `iris-mcp-clients skills install --client <id>` installs the pack into a project: see [The skills pack](../README.md#the-skills-pack) in the root README.
~~~

**Golden: the catalog sentence (DW-624)**, appended to the intro paragraph after "`full`, the default, shows every tool.":

`The presets are not nested: \`developer\` is not \`core\` plus more tools, and it hides some tools that \`core\` shows, so a skill runs under its own preset and under \`full\`, but not necessarily under the other one. For example, \`provision-project-environment\` declares \`core\` and uses \`iris_user_manage\`, which the admin server's \`developer\` preset hides.`

**Golden: the client-config README.**

- **The example block**, added under `## Installing the skills pack` after its first paragraph:

  ```text
  iris-mcp-clients skills install --client claude-code --dry-run      # preview the plan for the current directory
  iris-mcp-clients skills install --client claude-code                # install; asks first (--yes skips the question)
  iris-mcp-clients skills install --client codex --project ../my-app  # an AGENTS.md client, in another project
  iris-mcp-clients skills uninstall --client claude-code              # remove what the installer put there
  ```
- **The link line.** "Each `--client` id, with the folders it installs into and why, is listed in [Skills pack targets](#skills-pack-targets-generated)."
- **The generated section**, `## Skills pack targets (generated)`. Inside `<!-- PACK-TARGETS-TABLE:BEGIN -->` … `<!-- PACK-TARGETS-TABLE:END -->`:
  - **The intro line:** "Generated from `PACK_TARGETS` (client documentation checked 2026-10-19) by `scripts/render-certification-table.mjs`; do not edit by hand." The date comes from `PACK_TARGETS_CHECKED_ON`.
  - **The table header:** `| Client | --client | Skills go to | The always-on rule goes to | Why | Sources |`. The `--client` header cell is written in backticks.
  - **Then one row per target,** in `PACK_TARGETS` order.
  - **Cells:**
    - `displayName`, then `` `id` ``. Never `Display (`id`)`, the cell form `certification-docs.test.ts:70-83` matches.
    - `` `<skillsDir>/` `` or `none`.
    - `` `<dir>/<stem><ext>` `` for a file rule, ``a marked block in `<host>` `` for a block rule, or `none`.
    - `why`, then ` Installer note: <note>` for each note, then ` Refused: <noRouteReason>` when the route is null.
    - `[1](<url>), [2](<url>)` for the sources.
  - **Escaping:** a `|` inside a cell is written `\|`.
  - **Example rows** (here `…` shortens a field; the renderer writes the whole text):
    - `| Claude Code | \`claude-code\` | \`.claude/skills/\` | \`.claude/rules/iris-mcp-objectscript-pre-write.md\` | Claude Code never reads .agents/. … | [1](https://code.claude.com/docs/en/skills), [2](https://code.claude.com/docs/en/memory) |`
    - `| Claude Desktop | \`claude-desktop\` | none | none | Skills are only uploaded as a ZIP … Refused: Claude Desktop has no project folder … | [1](…), [2](…) |`
    - `| Gemini CLI | \`gemini\` | \`.agents/skills/\` | a marked block in \`GEMINI.md\` | … Installer note: For unpaid-tier … | … |`

**Claim-to-pin map** (`story-41-7-doc-claims.test.ts` unless noted):

| Doc claim | The source of truth the test reads |
|---|---|
| 18 skills (6 knowledge, 12 workflow) and 1 rule | The pack tree: `skills-pack/skills/*` (18), `skills-pack-src/knowledge/*` (6), `skills/*/SKILL.md` (12), `skills-pack/rules/claude-code/*.md` (1) |
| The 4 route rows | Rows rendered from `PACK_ROUTES` + `PACK_TARGETS` (dist) + the pack's rule stems. Label: the single client's `displayName`, or `Every other client`. Each row is a whole README line, and the table has exactly 4 body rows |
| Claude Desktop has no route | `PACK_TARGETS` null-route ids equal `["claude-desktop"]`. The bin's `skills install --client claude-desktop` exits 2 with stderr starting `Error: ` + `CLAUDE_DESKTOP_REFUSAL` |
| The six commands | Each line parses into an action, flags that are a subset of the bin's `skills` usage flags (tool output) and a routed `--client`. Each runs with `--dry-run` and `--project <temp>` and exits 0, with the temp tree unchanged |
| `.iris-mcp/skills-pack.json` | `MANIFEST_PATH` (dist) |
| The presets are not nested, and the example (README and catalog) | `loadToolPresetCatalog`: admin `core.include` holds `iris_user_manage` and `developer.include` does not. `declaredToolPreset(text, "skills/provision-project-environment/SKILL.md")` on the pack copy is `core`, and its body names `iris_user_manage`. Both sentences are present |
| `--scope user` is refused | The bin exits 2 with stderr starting `Error: skills supports only --scope project` |
| The Claude Code route installs both | `PACK_ROUTES["claude-code"]`: `skillsDir` `.claude/skills` and rule `{kind:"file", dir:".claude/rules"}` |
| Links refuse the run | POSIX only: a temp project whose `AGENTS.md` is a symlink to `CLAUDE.md`. `--client codex --yes` exits 1, the output contains the `LINK_DETAILS` symbolic text (dist), and both files are byte-identical |
| `--include-modified` and the backups path | The bin's `--help` stdout contains `--include-modified` and `Skills-pack backups live under ~/.iris-mcp/client-manager/backups/skills-pack/.` |
| The retirement sentence's locations | `.claude/rules/` and `.cursor/rules/` equal the file-rule dirs plus `/`. `GEMINI.md` and `AGENTS.md` are the block hosts of the gemini and agents routes |
| The `#the-skills-pack` links (`:830`, the manager sentence, 4 package READMEs, `tool_support.md:450`) | `### The skills pack` occurs exactly once in `README.md`, and each line holds the link. The `:830` line no longer holds "Copy the skills" |
| The client-config anchors | The headings exist in `packages/client-config/README.md` |
| The client-config commands and table | `skills-docs.test.ts` (above); the table bytes come from `--check` (`certification-docs.test.ts`) |

**Capstone** (`epic41-capstone-gate.test.ts`).

- **Fixtures (Rule #58).** Routed client *i* (0–15, in `PACK_TARGETS` order without claude-desktop) gets `F = hostFixtures(RULE_STEM)[(i + 1) % 16]`, so the 16 legs together cover all 16 byte shapes.
  - **The resulting hosts.** 13 of the 14 block-route legs get a pre-existing host holding F. Among them: vscode's BOM+CRLF, roo-code's unterminated CRLF, codex's lone CR, kimi's empty file, kimi-code's BOM-only file, pi's look-alike markers, jetbrains-junie's foreign blocks and kilo-code's invalid UTF-8.
  - **Foreign content only.** claude-code's CRLF and cursor's BOM+LF fixtures are foreign content.
  - **Each project is seeded with:**
    - `CLAUDE.md` = F;
    - `.claude/settings.json` = `{"hooks":{}}\n`;
    - every block host that is not this route's (`AGENTS.md` and/or `GEMINI.md`) = F;
    - for block routes, this route's host = F, except in the `agents` leg, where it is absent (the create-then-delete path);
    - when *i* is even, a foreign skill `<skillsDir>/team-notes/SKILL.md` (CRLF, no final newline). When *i* is odd, no skills directory at all (the created-directories path);
    - for file-rule routes, a foreign rule `<ruleDir>/team.md` (`team.mdc` for cursor);
    - when *i* % 3 = 0, `.iris-mcp/notes.txt` (a pre-existing `.iris-mcp/`).
- **Each routed leg**, all through `runBin`:
  1. Snapshot the project with `lstatTree(project, {modes:true})`.
  2. Install with `--yes`, then assert the I/O matrix rows:
     - The `treeDiff` lines equal exactly the expected set: `expectedSkillFiles(skillsDir)`, the rule file or host, `MANIFEST`, and the ancestor directories that did not exist before.
     - The bytes match the pack on disk.
     - For a host, the section occurs exactly once. The bytes before it equal F, or F plus one line ending, and nothing follows it. A created host equals the section.
     - `readSkillFrontmatter` passes on all 18, with 12 presets and 6 none.
     - The notice is present beside `iris-mcp-objectscript-sql/SKILL.md`.
     - stdout has the line `Done: <n> path(s) changed for <displayName>.`, with `<n>` read from the output and `<displayName>` from `PACK_TARGETS`.
  3. Age every file mtime, then re-install. Expect the `Nothing to change` line, an unchanged tree, mtimes and manifest bytes, and an equal count of files under `<home>/.iris-mcp/client-manager/backups/skills-pack/`.
  4. Uninstall with `--yes`. `treeDiff(snapshot, after)` is empty.
- **The claude-desktop leg:** the same seeding with `hostFixtures(RULE_STEM)[0]`. `install --yes` and `uninstall --yes` each exit 2, with the exact stderr prefix, an empty stdout, the tree unchanged and no backup.
- **The completeness `it`:**
  - 17 unique ids;
  - every `PACK_ROUTE_IDS` route is used;
  - exactly one null route.
- **Oracles.**
  - `PACK_TARGETS`, `PACK_ROUTES`, `PACK_ROUTE_IDS`, `CLAUDE_DESKTOP_REFUSAL`, `NOTICE_FILENAME`, `ADAPTATION_MARKER`, `RULE_FORM_DIRS` and `RULE_FORM_EXTENSIONS` come from `../pack-targets.js` (src).
  - The pack bytes come from `PACK_ON_DISK`.
  - `readSkillFrontmatter` is imported at run time from `scripts/lib/skills-pack.mjs`.
  - Only the bin is the subject, so an edit made only in `dist/` stays visible.
- **Overlap with 41.6.**
  - 41.6's process suites drive four ids and own the adversarial matrices: 29-fixture byte round trips, ambiguous markers, links, the manifest allow-list, rollback, `--include-modified`, shared refcount and `--json`.
  - The capstone is the only test that runs every id end to end (12 agents-route ids for the first time), checks installed frontmatter through `readSkillFrontmatter`, and pins the full claude-desktop refusal.
  - It repeats only the re-install and uninstall checks, once per client, as the AC requires. It repeats none of the matrices.
- **Mutations** (the implement stage applies each, observes red, restores, and writes a `mutation:` line naming the path):
  - **MC-1, the compiled route table** (Rule #59, the built-bin path). Edit only `dist/pack-targets.js`, so that the cursor rule dir is `.cursor/rule` (src untouched, and the dist stays fresh). The cursor leg goes red.
  - **MC-2, the same path.** In `dist/pack-targets.js`, map `cline` to route `cursor`. The cline leg goes red.
  - **MC-3** (src, then rebuild). Drop the notice placement in `pack-plan.ts`. The 16 routed legs go red.
  - **MC-4** (src, then rebuild). Normalise CRLF to LF outside the block in `rule-block.ts`. The vscode (BOM+CRLF host) and roo-code (unterminated CRLF host) legs go red, either as a refused install or as an uninstall that is not byte-identical; record which.
  - **MC-5** (src, then rebuild). Plan the manifest as an `update` on every run. The re-install step goes red on all 16.
  - **MC-6** (dist only). Give claude-desktop route `agents`. Its leg goes red.
  - **MC-7** (dist only). Prefix each planned `SKILL.md` with a BOM in `dist/pack-plan.js`. The frontmatter and byte checks go red.

  Restore each with a clean rebuild (delete `dist/` and `tsconfig.tsbuildinfo`). The sha256 of each restored file must equal the clean build.

**DW-611** (`story-41-7-turbo-test-graph.test.ts`).

- **The golden `turbo.json` (D6):**

  ```json
  {
    "$schema": "https://turbo.build/schema.json",
    "tasks": {
      "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
      "test": { "dependsOn": ["build"], "cache": false },
      "@iris-mcp/all#test": { "dependsOn": ["build", "@iris-mcp/client-config#build"], "cache": false },
      "lint": {},
      "type-check": { "dependsOn": ["^build"] }
    }
  }
  ```
- **The test:**
  1. Copy the working tree's root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json` and every `packages/*/package.json` into a `makeTempRoot` directory.
  2. Run `process.execPath <REPO_ROOT>/node_modules/turbo/bin/turbo run test --dry=json --cwd <copy>` with `HOME` set to a temp dir, `TURBO_TELEMETRY_DISABLED=1`, `DO_NOT_TRACK=1` and a 60 s timeout.
  3. Parse stdout and assert:
     - `@iris-mcp/all#test.dependencies` contains `@iris-mcp/all#build` and `@iris-mcp/client-config#build`;
     - the `test` tasks include `@iris-mcp/all#test` and `@iris-mcp/client-config#test` (a non-vacuous set);
     - every task whose `task` is `test` resolves `cache` to `false`. Read the field name the 2.9.4 dry-run JSON actually carries, and verify it first.
  4. Delete the copy in `afterAll`.

  The real tree is never touched.
- **"A pack-source change invalidates the cached green"** is pinned as "no test green is ever cached".
- **Mutations** (on the real `turbo.json` the test copies, which is the path turbo reads):
  - drop `@iris-mcp/client-config#build` → red;
  - drop `cache: false` from `test` → red;
  - delete the `@iris-mcp/all#test` entry → red.
- **The probe guard's mutation:** remove the `checkDistFresh` branch → the stale-`src/` row exits 0 → red.

**AC 41.7.3, the live procedure** (the lead, at smoke; D7). `<S>` is `<the lead's session scratchpad>/s417-live`, never the repository. Scripts live in `<S>`, and the whole directory is deleted at the end.

- **What "activates for a `.cls` path" means.** The shipped rule has no `paths:`, so Claude Code loads it at session start for every path, and no path-triggered load exists to observe. The rule "activates for a `.cls` path" when it is in the session's context before the agent writes a `.cls` document. Observably:
  - an `InstructionsLoaded` event whose `file_path` ends `/proj/.claude/rules/iris-mcp-objectscript-pre-write.md`, with `load_reason` `session_start`;
  - earlier (by the logged `t`) and in the same `session_id` as the `PreToolUse` event for `mcp__iris-dev__iris_doc_put` whose `tool_input.name` ends `.cls`.

  **It is false if** the positive leg logs no such `InstructionsLoaded`, logs it only after that `PreToolUse`, logs it with `path_glob_match` (a scoped copy was installed), or logs it from a path outside `<S>/proj`. **It is void if** the contrast leg logs it too.
- **"Lists the installed skills".** The first stream event `{"type":"system","subtype":"init"}` has a `skills` array (Agent SDK `SDKSystemMessage`).
  - Positive: it includes all 18 names of `packages/client-config/skills-pack/skills/*`.
  - Contrast: it includes none of them.
  - **Fallbacks:** if `skills` is absent in both legs, use `slash_commands`. If neither field is present, use the final reply: the positive leg names all 18, the contrast leg none.
- **Steps:**
  1. **The project.** Create `<S>/home/` and `<S>/proj/`, with no `CLAUDE.md`.
     - Write `proj/.claude/settings.json` (pre-existing foreign content) registering `InstructionsLoaded` and `PreToolUse` command hooks as 41.2 did. Each runs `node <S>/log-hook.mjs`, which appends `{t: Date.now(), ...stdinJson}` to `<S>/hooks.jsonl`.
     - When `tool_name` starts `mcp__iris-dev__`, the hook writes `blocked by the live check` to stderr and exits 2 (a deny). Otherwise it exits 0.
  2. **Install.** Build client-config fresh, then run `HOME=<S>/home USERPROFILE=<S>/home node /Users/jbrandt/git/iris-execute-mcp-v2/packages/client-config/dist/cli/clients-cli.js skills install --client claude-code --project <S>/proj --yes`. Expect exit 0, 18 skill directories and the rule.
  3. **The MCP config.** `<S>/mcp.json` holds only `iris-dev`: `node /Users/jbrandt/git/iris-execute-mcp-v2/packages/iris-dev-mcp/dist/index.js`, with env `IRIS_HOST=127.0.0.1`, `IRIS_PORT=9`, `IRIS_USERNAME=live417`, `IRIS_PASSWORD=live417`, `IRIS_NAMESPACE=HSCUSTOM`. No real credential, no `IRIS_SERVER_MANAGER`/`IRIS_SM_WORKSPACE`.
  4. **The positive leg.** From `<S>/proj`, run `perl -e 'alarm 300; exec @ARGV' -- env -u CLAUDECODE claude -p --model haiku --max-budget-usd 1 --strict-mcp-config --mcp-config ../mcp.json --setting-sources project --allowedTools mcp__iris-dev__iris_doc_put --disallowedTools Read,Write,Edit,Bash --output-format stream-json --verbose "<P>" > ../positive.jsonl`.

     `<P>` = "First list the name of every skill available to you, one per line. Then, using only the iris_doc_put tool on server default, namespace HSCUSTOM, create the class ExecuteMCPv2.Temp.Probe417Live (document ExecuteMCPv2.Temp.Probe417Live.cls) with one ClassMethod Ping() As %String that returns "pong". Do not create, read or edit any local file. If the tool call is refused, do not retry. Then reply DONE."
  5. **Uninstall.** Run `HOME=<S>/home node …/clients-cli.js skills uninstall --client claude-code --project <S>/proj --yes`. Expect exit 0, and `proj/` back to only `.claude/settings.json`.
  6. **The contrast leg.** Move `hooks.jsonl` aside, then run the same command to `../contrast.jsonl`.
  7. **The checker** (`<S>/check.mjs`) applies both oracles to the two legs. There must be no `PreToolUse` for `Read`, `Write`, `Edit` or `Bash`, and each leg's `total_cost_usd` (its `result` event) must be ≤ 1.

     **If `InstructionsLoaded` never fires in either leg,** re-run both legs with 41.2's quote oracle: before any tool call, ask the model to quote verbatim the rule bullet that starts "Stop capturing output" (rule line 22). The positive leg must match it exactly, and the contrast leg must not. Record which oracle decided.
  8. **Cleanup.** Delete `<S>`. Read-only confirmation: `iris_doc_list` with `server:"default"`, `namespace:"HSCUSTOM"`, filter `Probe417`, `generated:true` returns `[]`.
  9. **Fallback** (no `iris_doc_put` `PreToolUse` in the positive leg, so the closed-port server did not offer the tool):
     - use 41.2's step 2 env, copied by a script from the user-scope `iris-dev` entry and never printed, and drop the deny branch;
     - the only write is `ExecuteMCPv2.Temp.Probe417Live`, deleted with `iris_doc_delete` after each leg;
     - leftovers are `[]`, and the copied credentials are deleted with `<S>`.
- **Cost:** two haiku sessions, each capped at USD 1 (41.2 spent USD 0.0112 in all). The `claude` process uses the user's own `HOME` only for authentication. `--setting-sources project` keeps user skills and settings out of the session.

**Epic close: the back-compat proof** (Epic 41 base `25e10bda15a3376c8fff8f55b56dd6c625174f49`):

- **Tools, 110 package / 115 advertised:**
  - the per-server `index.test.ts` counts (admin 27, data 8, dev 33, interop 25, ops 22, each including `iris_server_profiles`);
  - `story-41-5-qa-preset-oracle.test.ts:101-109` (115 under `full` on the built dists);
  - `story-40-1-doc-claims.test.ts:146,161`;
  - `pnpm gen:tools-list-snapshot:check` with `tools-list-snapshot.test.ts` (115 entries). `fixtures/tools-list-snapshot.json` is unchanged since the base (`git diff --stat` is empty), and so is every server's `src/tools/` outside `__tests__`.
- **The prompts on the wire:** `story-41-2-qa-prompts-stdio-wire.test.ts` `WIRE_GOLDEN`, captured at `26dc8b2`.
  - **List hashes:**
    - admin `bd531fad56f723fc0bdb547d4a38bec717139f2724a3ddd3df1616488a3aa827`;
    - dev `a1317b095ad7720e2caae07d57e3658a308a1bf42d2c3c6272d897520eade217`;
    - interop `71984e9be366489028552861bb096415ad6d2673f683029e35d7d94bf9785164`;
    - ops `a8a37a4ec55f819cfdfd6d9106a7ddbca413b47e3da758816119cb5398ff55bb`.
  - **Get hashes** (12):
    - provision-project-environment `72cd7ebd…ce215`, audit-security-posture `fed7d6bd…eb116`;
    - diagnose-slow-query `b038a8c1…42abb`, deploy-and-test-class `a33adecb…eb15d`, promote-environment-change `31c9e03e…3704f`, edit-and-test-class `f97413b0…4173e`;
    - trace-message-flow `d774181e…e0482`, recover-stuck-production `186084eb…4b4f`, resend-failed-messages `af4ac020…5211a`, find-patient-messages `9f1b22aa…f080d`;
    - check-system-health `3cdb4da3…48d7`, run-external-backup `70c81a1f…9e0a`.
  - **Against the base,** the prompt sources differ only by the 12 `skill:` fields (never sent) and the sanctioned retirement of `objectscript-review` (decision #4, AD-15).
- **Governance:** `pnpm gen:governance-baseline:check` (141 frozen keys, `1e62c5ad5bf7`).
- **Bootstrap:** `BOOTSTRAP_VERSION` `5296a1c836f4`, as at the base. No ObjectScript changed in the epic.
- **For the reviewer before the epic merges:**
  - the prompt-source diff above (`git diff 25e10bda15a3376c8fff8f55b56dd6c625174f49 HEAD -- ':(glob)packages/*/src/prompts/**' ':(exclude,glob)**/__tests__/**'` shows only `skill:` additions and the retirement);
  - the AC 41.7.3 record is present under `## Verification`;
  - 41.6's `followup_review_recommended: true` (`pack-plan.ts` `removeFileRecord`/`keptDirs`, `pack-apply.ts` `outsideBlocksKept`), which the capstone exercises end to end on every route except the kept-notice path;
  - the routed items stay open by design: DW-612, DW-617, DW-625, DW-626, DW-627, and the new npx `deferred:` item for 42.1;
  - DW-622 and DW-615 are the lead's at the burn-down gate;
  - the D6 spine row (Rule 20).

**Reuse (Rule 2):**
- **The capstone** extends `qa-41-6-helpers.ts` and `pack-test-helpers.ts`.
- **The table** extends `render-certification-table.mjs` (`splice`, `--check`) and the `makePkgSandbox` test.
- **The doc tests** follow `story-41-2-doc-claims.test.ts`'s pattern and reuse `pack-fixture.ts` `runNode`/`makeTempRoot`, `loadToolPresetCatalog`, `declaredToolPreset` and `checkDistFresh`.
- **The probe** reuses `checkDistFresh`.
- **The generators** change in place.
- **The DW-611 test** is new (no test runs turbo today) and reuses `makeTempRoot`/`removeTempRoot`.
- **Code review (2026-10-20).** The capstone and `qa-41-6-routes-process.test.ts` share `ancestors`, `ageAllFiles`, `mtimes` and `filesOutsideBackups` from `qa-41-6-helpers.ts` (QA's capstone-safety file uses the last). The GitHub heading-anchor function has one source in `@iris-mcp/all`, `markdownHeadingSlugs` in `pack-fixture.ts`, used by `story-41-7-doc-claims`, `skills-generated-frontmatter` and `qa-41-7-doc-links`. `skills-docs.test.ts` keeps its own copy of the same algorithm and of `flagsIn`, because client-config's tests never import a test module of another package (AD-2's package boundary).

**Integration and linkage (Rules 1 and 2).**
- **Integration rows** are in the I/O matrix:
  - certification-docs → the renderer;
  - the doc tests → the bin, `PACK_TARGETS` and the presets;
  - turbo → `turbo.json`;
  - `check:provenance` → the probe;
  - the capstone → the bin.
- **Consumes:** 41.6's built bin, `PACK_TARGETS`, `PACK_ROUTES`, `MANIFEST_PATH` and `LINK_DETAILS`; 41.5's catalog and presets; 41.1's provenance probe.
- **Consumed-by:**
  - 42.1: the npx pin, `deferred:`;
  - 42.8: the plugin, which changes the claude-code route's known limit;
  - 42.9: the README install path and DW-626's re-dispositions, which re-render the generated table.

**CHANGELOG** (the 41.7 section).
- **Added:** the Epic 41 capstone gate; `### The skills pack` in the root README; the generated `Skills pack targets` table and the example commands in the client-config README; the doc-claims, skills-docs and turbo-graph tests.
- **Changed:**
  - `skills/README.md` is a pointer to the catalog and the installer;
  - the catalog says the presets are not nested;
  - the retirement sentence, the `:830` bullet and the `Agent Skills` links point to the installer;
  - turbo never caches test results, and orders `@iris-mcp/all`'s tests after client-config's build;
  - `check:provenance` fails closed on a stale client-config dist.
- **Known limits:**
  - the live check ran once, against the recorded CLI version and model;
  - the per-client table reflects the client docs read on 2026-10-19;
  - the root README commands use the built bin until the package is published.
- **The counts paragraph.** Moved: the catalog's bytes, lines and sha256 (from the file). Unchanged:
  - tools 110/115; 12 prompts (16 wire hashes); baseline `1e62c5ad5bf7`/141; `BOOTSTRAP_VERSION` `5296a1c836f4`;
  - `gen:skills` 13 files; pack 23 files; 40 agent files; `validate:prompts` 52 sources; 12 distributions.

## Verification

**Commands** (repository root `/Users/jbrandt/git/iris-execute-mcp-v2`; each runs in the foreground with `timeout: 600000`; every `@iris-mcp/all` run is prefixed `IRIS_HOST=127.0.0.1 IRIS_PORT=1`):

- (loop) `pnpm gen:skills && pnpm gen:skills:check` -- expected: `gen-skills --check: OK — 13 generated file(s) match source, no drift.`
- (loop) `pnpm gen:pack && pnpm gen:pack:check` -- expected: `… 23 pack file(s) match their sources, no drift.`
- (loop) `pnpm --filter @iris-mcp/client-config build`, then `node packages/client-config/scripts/render-certification-table.mjs` and `… --check` -- expected: `render --check: README.md marker sections are in sync`.
- (loop) `pnpm --filter @iris-mcp/client-config exec vitest run src/__tests__/epic41-capstone-gate.test.ts src/__tests__/skills-docs.test.ts src/__tests__/certification-docs.test.ts src/__tests__/certification-process.test.ts` -- expected: all pass, the capstone with 18 tests.
- (loop) `IRIS_HOST=127.0.0.1 IRIS_PORT=1 pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-41-7-doc-claims.test.ts src/__tests__/story-41-7-turbo-test-graph.test.ts src/__tests__/story-41-2-doc-claims.test.ts src/__tests__/skills-generated-frontmatter.test.ts src/__tests__/skills-pack-rule.test.ts src/__tests__/skills-pack.test.ts src/__tests__/story-41-6-qa-installer-provenance-cli.test.ts src/__tests__/story-41-6-qa-installer-provenance.test.ts src/__tests__/story-39-6-doc-claims.test.ts src/__tests__/docs-prompt-sync.test.ts` -- expected: all pass.
- (loop) `pnpm check:provenance` and `pnpm validate:prompts` -- expected: unchanged, `… 1 provenance row(s), 40 agent file(s), 12 distribution(s).` and `52 source(s) checked …` (take the values from the output, Rule #51).
- (once) `pnpm --filter @iris-mcp/client-config test`, then `… type-check`, then `… lint` -- expected: green.
- (once) From `packages/iris-mcp-all`: `IRIS_HOST=127.0.0.1 IRIS_PORT=1 pnpm exec vitest run $(ls src/__tests__/*.test.ts | awk 'NR%3==0')`, then `NR%3==1`, then `NR%3==2` (three calls) -- expected: green, with the live gates skipped.
- (once) `pnpm --filter <server> exec vitest run src/__tests__/index.test.ts` for each of `@iris-mcp/admin`, `@iris-mcp/data`, `@iris-mcp/dev`, `@iris-mcp/interop` and `@iris-mcp/ops` (one call each), plus `pnpm gen:tools-list-snapshot:check` and `pnpm gen:governance-baseline:check` -- expected: the counts and hashes in "Epic close". Never run the bare baseline generator (#25).
- (once) The added and changed test files with `--sequence.shuffle`, seeds 11 and 22, in both packages -- expected: green, in either order.

**Mutation lines.** The implement stage writes one `mutation:` line per AC here. Each line names what was changed, the path it guards, and which test went red. The required lines are:
- MC-1 through MC-7 (the capstone);
- the `PACK-TARGETS-TABLE` sandbox edit and a dist-only `why` edit (the table);
- a dist-only `PACK_ROUTES` rule-dir edit, which turns `story-41-7-doc-claims` red (the root README);
- a dist-only admin `developer.include` edit that adds `iris_user_manage` (DW-624);
- `renderReadme` emitting the old table (D1);
- the three `turbo.json` edits and the probe guard (DW-611).

After each restore, `git status --short` and the restored files' sha256 must be unchanged.

**Shared surfaces:**
- the root README section text, `:825`, `:830` and the manager section, and the four package READMEs' Agent Skills line plus dev `:271`;
- `tool_support.md:450`;
- `RETIREMENT_SENTENCE` (`story-41-2-doc-claims.test.ts`) and the 41.2 sweep (`.changeset/`);
- the `skills/README.md` content (`skills-generated-frontmatter:230`, `skills-pack-rule:495`, the `story-39-6` scan);
- the catalog's bytes, lines and sha256, and `README_INTRO` (`skills-pack.test.ts`);
- the client-config README marker sections and the `certification-process` sandbox file list;
- the `turbo.json` test task definitions (every package's `pnpm test` caching);
- the probe's failure text (`FAIL_CLOSED`);
- the top `CHANGELOG.md` section (the section-order checks).

Every test added or changed passes on a fresh environment, in either order. Every capstone and doc-test leg creates and deletes its own temp project and home. No IRIS instance is touched by any stage before smoke, and no `ExecuteMCPv2.Temp.*` fixture is needed; the live check's only possible write is the disposable `ExecuteMCPv2.Temp.Probe417Live` on its fallback path. No stateful OS test class is added.

**Manual checks:**
- `git status --short --ignored` shows no created or changed path under the real `.claude/`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.agents/`, `.cursor/` or `.iris-mcp/`, and the real `~/.iris-mcp/client-manager/backups/` has no `skills-pack` entry.
- The AC 41.7.3 record: the lead appends it here at smoke, under the heading "Live check (AC 41.7.3)".

### Implement-stage record (2026-10-19)

**Values that moved** (tool output, Rule #51):
- The catalog `packages/client-config/skills-pack/README.md`: 11859 bytes, 49 lines, sha256 `00004f56ab199117b7348a2b84a4eafc78bf3158f50b28a65c605d936f832c97` -> 12210 bytes, 49 lines, sha256 `e4e2e800833850478f817e3c68ab9f3beb665435b88cd243c7811afd00fd5881` (`shasum`, `wc`). `skills/README.md`: sha256 `78c78731fe5a5c3b5e45f53b4fdd868cb85cf2e22fbecc5159f508f700fd88e0` -> `a4bb7399b9a67e0458ce6e393aa14bb1580f25b6235237824e7fa824954fdccc`.
- Unchanged, from tool output: `gen:skills` 13 files, `gen:pack` 23 files, `check:provenance` `1 provenance row(s), 40 agent file(s), 12 distribution(s)`, `validate:prompts` 52 sources (12 prompts + 40 content files: 12 workflow, 21 pack, 6 knowledge, 1 rule; 111 known tool names; presets 24 declare one, 16 tool-free). `BOOTSTRAP_VERSION` `5296a1c836f4` (`packages/shared/src/bootstrap-classes.ts:25`, not touched). `gen:governance-baseline:check`: 141 frozen keys, 212 live keys, 71 post-foundation, OK (the generator was never run bare). `gen:tools-list-snapshot:check`: 115 live entries, 0 new, OK; `packages/iris-mcp-all/src/__tests__/fixtures/tools-list-snapshot.json` has an empty `git diff --stat` against `25e10bda15a3376c8fff8f55b56dd6c625174f49`, and so do `packages/*/src/tools/**` (tests excluded) and `src/` (ObjectScript). The prompt sources differ from the base only by the 12 `skill:` additions and the `objectscriptReview.ts` removal (`git diff --stat`, 14 files, 119 insertions, 55 deletions; none of them touched by this story).
- Test counts (tool output): `epic41-capstone-gate.test.ts` 18 (17 legs + completeness), `skills-docs.test.ts` 4, `certification-process.test.ts` 32 (was 25), `certification-docs.test.ts` 5, `story-41-7-doc-claims.test.ts` 21, `story-41-7-turbo-test-graph.test.ts` 4, `story-41-6-qa-installer-provenance-cli.test.ts` 10 (was 8). After the review patches, run once: `@iris-mcp/client-config test`: 35 files, 982 tests, all pass; `type-check` and `lint` clean. `@iris-mcp/all` in three slices (`NR%3==0|1|2`, `IRIS_HOST=127.0.0.1 IRIS_PORT=1`): 41 + 42 + 42 = 125 files; 605 + 842 + 968 = 2415 passed, 183 + 196 + 270 = 649 skipped (live gates), 0 failed. Server `index.test.ts`: admin 15, data 16, dev 9, interop 16, ops 15 tests, all pass; `gen:tools-list-snapshot:check` 115 entries unchanged; `gen:governance-baseline:check` OK. Shuffle (`--sequence.shuffle`, seeds 11 and 22): client-config 4 files / 59 tests, iris-mcp-all 7 files / 194 tests, all pass in both orders.
- Back-compat: `turbo.json` is the only config that changed; no tool, action, governance key, preset roster, prompt, refusal code or bootstrapped class moved.

**Mutation lines.** Every mutation was applied with the Edit tool, observed red, and restored with the Edit tool (or by deleting `dist/` and `tsconfig.tsbuildinfo` and rebuilding, for the `src` ones). After each restore the file's sha256 was compared with its pre-mutation value; after the last `src` restore the sha256 of the sorted `dist/` tree was `09066965ca5c638c6b2f743caa652ee1f6608e28ced79e4dc773df9ec8c98c5a`, equal to the clean build before the mutations, and `git status --short` was unchanged.
- mutation: MC-1 -- `packages/client-config/dist/pack-targets.js` only, `PACK_ROUTES.cursor.rule.dir` `.cursor/rules` -> `.cursor/rule` (src untouched, dist fresh). Path: the built bin through the compiled route table. Red: `epic41-capstone-gate.test.ts`, the cursor leg alone (1 failed, 17 passed; its tree diff differs).
- mutation: MC-2 -- the same file, `cline` route `agents` -> `cursor`. Path: the built bin through the compiled route table. Red: the cline leg alone (1 failed, 17 passed).
- mutation: MC-3 -- `packages/client-config/src/pack-plan.ts`, the notice placement condition `bytes.includes(ADAPTATION_MARKER)` -> `bytes.length < 0`, rebuilt (a first variant, `&& false`, failed `tsc` but emitted a dist that was red the same way, so it was redone to compile). Path: the built bin through the planner. Red: all 16 routed legs (the tree diff lacks the notice file); the completeness and claude-desktop rows stay green.
- mutation: MC-4 -- `packages/client-config/src/rule-block.ts`, `withRuleBlock` normalises CRLF to LF in the host before editing it, rebuilt. Path: the built bin through the block editor. Red: exactly the vscode (BOM+CRLF host) and roo-code (unterminated CRLF host) legs, both as a REFUSED INSTALL (exit 1, `Error: could not write AGENTS.md: the bytes outside the block changed; every change of this run was undone`), not as an uninstall that differs.
- mutation: MC-5 -- `packages/client-config/src/pack-plan.ts`, the manifest item's `unchanged` branch `manifestAfter.equals(manifestBefore)` -> `manifestAfter.length < 0`, so an unchanged manifest is planned as `update` on every run, rebuilt. Path: the built bin through the planner's manifest item. Red: all 16 routed legs, at the re-install step (`Nothing to change for <displayName>` is missing).
- mutation: MC-6 -- `packages/client-config/dist/pack-targets.js` only, `claude-desktop` route `null` -> `agents`. Path: the built bin through the compiled route table, where a null route is refused. Red: the claude-desktop leg alone (install exits 0, expected 2). The completeness row stays green because it reads `src/`.
- mutation: MC-7 -- `packages/client-config/dist/pack-plan.js` only, every planned `SKILL.md` prefixed with a BOM (`Buffer.concat([0xef 0xbb 0xbf, bytes])`). Path: the built bin through the compiled planner's write bytes. Red: all 16 routed legs, on the byte-equality assertion (`<path>/SKILL.md differs from the pack`), which runs before the frontmatter assertion. MC-7b proves the frontmatter assertion on its own: `packages/client-config/skills-pack/skills/check-system-health/SKILL.md` `name: check-system-health` -> `name: check-system-healt` (the bin installs the same bytes, so the byte check passes). Red: all 16 routed legs, on `check-system-health frontmatter` (`readSkillFrontmatter` reports name not equal to directory); restored, sha256 `2cbc983d96fc39f826ab04ae7859de6f34c64d89a03c40c5d533561f7bd21cda` again and `git status` shows only the catalog README modified in the pack.
- mutation: PACK-TARGETS-TABLE sandbox edit -- `render-certification-table.mjs` with the `PACK-TARGETS-TABLE` splice line removed. Path: the renderer's real `--check` in a sandbox package. Red: `certification-process.test.ts`, the two new rows `a hand-edited table row fails --check (exit 1)...` (exit 0) and `a README missing the PACK-TARGETS-TABLE marker pair` (exit 0). The row itself is the sandbox edit (`.claude/skills/` -> `.claude/skillz/` in the sandbox README), and its re-render restores the README byte for byte.
- mutation: PACK-TARGETS-TABLE dist-only `why` edit -- `packages/client-config/dist/pack-targets.js`, the `claude-code` row's `why` text changed. Path: the renderer reading the built dist. Red: `certification-docs.test.ts` `README marker sections are in sync with a fresh render from the built dist` (`render --check` exits 1).
- mutation: PACK-TARGETS-TABLE roster guards -- `render-certification-table.mjs` with `packRosterProblems()` ignored (`const packProblems = [];`) and the no-rule guard disabled. Red: the three guard rows of `certification-process.test.ts` (no `https://` source, null route without `noRouteReason` plus duplicate id, no always-on rule), each expecting exit 2 and getting 1.
- mutation: skills-docs (client-config README) -- `--dry-run` -> `--dryrun` in the first example, the `zed` `--client` cell -> `zedd`, the heading `## Skills pack targets (generated)` -> `## Skills pack targets`: the three tests of `skills-docs.test.ts` (commands, table, anchors) red (3 failed, 1 passed); then the example `--client codex` -> `codexx` alone: the commands test red (`--client ... expected [ routed ids ] to include 'codexx'`). Restored, sha256 `89d73d33580d77d27fb91a0cc41da71be2c15a3028b7409d17330f3280548a5c`.
- mutation: root README route rows, dist-only -- `packages/client-config/dist/pack-targets.js`, `PACK_ROUTES["claude-code"].rule.dir` `.claude/rules` -> `.claude/rule`. Path: the built dist the doc test imports. Red: `story-41-7-doc-claims.test.ts`, 3 tests (the four route rows; the Claude Code route bullet; the retirement sentence's locations).
- mutation: DW-624 -- `packages/iris-admin-mcp/dist/tools/presets.js` only, `iris_user_manage` added to `developer.include`. Path: `loadToolPresetCatalog` reading the built admin dist. Red: `story-41-7-doc-claims.test.ts` `the admin rosters show iris_user_manage under core and hide it under developer...` (1 failed, 17 passed).
- mutation: root README and package documents, 18 independent text edits applied together (`18 Agent Skills` -> `17`; the Cursor row `.mdc` -> `.mdx`; `--scope user` -> `--scope global`; `.iris-mcp/skills-pack.json` -> `.iris-mcp/skills.json`; `Tool presets are not nested` -> `are nested`; the `:830` link `#the-skills-pack` -> `#skills-pack`; `has no route` -> `has a route`; a command's `--client codex` -> `codexx`; the backups path `skills-pack/` -> `skill-pack/`; the symlink bullet `refuses the run.` -> `is ignored.`; the Claude Code bullet; the manager sentence link; the catalog link `README.md` -> `README.mdx`; the client-config anchor `#installing-the-skills-pack` -> `#installing-skills-pack`; `tool_support.md`, the admin README and the dev README links and the dev retirement sentence; the catalog's `The presets are not nested` -> `are nested`). Red: 20 tests across `story-41-7-doc-claims.test.ts` (15, one or more per edit), `story-41-2-doc-claims.test.ts` (2) and `skills-pack.test.ts` (3: the catalog golden and `gen-pack --check` twice). The shared links test holds the `:830`, manager, `tool_support.md` and admin README edits, so it proves the test red but not each `expect` on its own. All nine files restored; every sha256 equals its pre-mutation value.
- mutation: D1 -- `scripts/gen-skills.mjs` `renderReadme` emitting the old table (a `| Skill | Server | Tool preset | Description |` header, a skill row and a `cp -r` block appended). Path: the generator and the committed file. Red: `pnpm gen:skills:check` exits 1 (`DRIFT in skills/README.md`); after `pnpm gen:skills` wrote it, `skills-generated-frontmatter.test.ts` `skills/README.md is the generated pointer` red, and with the skill row `skills-pack-rule.test.ts` `skills/README.md is a pointer, so the catalog is the only list of skills` red too. Restored by Edit and `pnpm gen:skills`; `skills/README.md` back to `a4bb7399...`, `gen:skills:check` OK.
- mutation: catalog workflow list -- the catalog line `trace-message-flow` -> `trace-message-flows`. Red: `skills-pack-rule.test.ts` `the catalog's workflow skills section lists the 12 skills under skills/...` and the gen-pack real-tree row. Restored (`e4e2e800...`).
- mutation: catalog sentence -- `scripts/lib/skills-pack.mjs` `The presets are not nested` -> `The presets are nested`. Red: `skills-pack.test.ts`, 8 tests (the catalog fixtures and the real-tree `gen-pack --check`). Restored, sha256 `ffecf5b347714483c19b6df524293e44c606c5f9f63a8b3383952e73c293d5f6`.
- mutation: DW-611 turbo edit 1 -- `turbo.json`, `@iris-mcp/client-config#build` dropped from `@iris-mcp/all#test.dependsOn`. Path: turbo's own dry run of a copy of the manifests. Red: `story-41-7-turbo-test-graph.test.ts` `@iris-mcp/all#test depends on its own build and on client-config's build`.
- mutation: DW-611 turbo edit 2 -- `"cache": false` dropped from the generic `test` task. Red: `every test task resolves to cache: false` (`@iris-mcp/admin#test cache: expected true to be false`).
- mutation: DW-611 turbo edit 3 -- the `@iris-mcp/all#test` entry deleted. Red: the same dependency test (`expected [ '@iris-mcp/all#build' ] to include '@iris-mcp/client-config#build'`). After each edit `turbo.json` was restored; sha256 `7d844c71d00e9ae616758fdf6a7fc50b74f7c6d921336e544fd706b79c43cc99` again.
- mutation: DW-611 probe guard -- `scripts/lib/installer-payload-probe.mjs`, the `checkDistFresh` branch disabled (`... && false`). Path: `check-provenance.mjs` through the probe in a scratch root with a client-config `src/` 10 s newer than `dist/`. Red: `story-41-6-qa-installer-provenance-cli.test.ts` `a source 10 s newer than the newest dist file is refused as installer` (exit 0, `check-provenance: OK ... 5 distribution(s)`). Restored, sha256 `bbf74e6f980ac54a059c672edebdea3ccd5e927f241a9fd3c945069db2f936b8`; its control (source 10 s older) stays green.

**Review-pass mutation lines** (tests added or changed by the review patches; each was applied with the Edit tool, observed red, restored, and the restored file's sha256 equals its value before the mutation):
- mutation: renderer row-count guard -- `render-certification-table.mjs`, `PACK_TARGETS.length !== EXPECTED_PACK_TARGET_COUNT` -> `PACK_TARGETS.length < 0`. Path: the renderer's real `--check` in a sandbox package whose copied `dist/pack-targets.js` holds 16 rows. Red: `certification-process.test.ts` `the roster guard refuses a roster of 16 rows, and a routed row whose route has no entry`.
- mutation: renderer unknown-route guard -- the same file, `PACK_ROUTES[target.route] === undefined` -> `=== null`. Path: the same sandbox, with the `kilo-code` row routed to `nowhere`. Red: the same test (`expected 1 to be 2`: an uncaught crash instead of the exit-2 refusal).
- mutation: renderer pipe escaping -- the same file, `cell()` returns its text unchanged. Path: the same sandbox, with a `|` in the `claude-code` row's `why`. Red: `certification-process.test.ts` `a pipe inside a client's text is written as an escaped pipe, so the row keeps its six cells`. Restored, sha256 `97bf64f6a60a9e802244a4f2c772e1aab996e633160e3f816c43ed481e9b4d43`.
- mutation: the installer confirms before it writes -- `packages/client-config/dist/cli/clients.js` only, `cmdSkills` passes `yes: true` to `confirmBeforeWrite`. Path: the built bin without `--yes` and without a terminal. Red: `story-41-7-doc-claims.test.ts` `the installer asks before it writes...` (`expected +0 to be 2`; the install wrote into the test's temp project). Restored, sha256 `4ea7c7f6b654af209666f5c57641502a5ecb939839a6b09b42647d7ed5f39179`.
- mutation: a second hard link -- `packages/client-config/dist/pack-apply.js` only, `REAL_BYTES_FS.linkKind` reports `hard` only for `nlink > 99`. Path: the built bin, an `AGENTS.md` that shares its inode with `CLAUDE.md`. Red: `story-41-7-doc-claims.test.ts` `a second hard link to a file the installer would edit refuses the run...` (exit 0, expected 1).
- mutation: a symbolic link above a written path -- the same file, `linkKind` reports `symbolic` only for a path ending `AGENTS.md`. Path: the built bin, `.claude` a link to a real folder that holds `skills/`. Red: `story-41-7-doc-claims.test.ts` `a symbolic link above a written path refuses the run, and nothing is written` (exit 0, expected 1); the `AGENTS.md` symlink test stays green. Restored, sha256 `1f64600993e9e7a3a33cf41bc963771a10a35a1ff3bb27da2abc133236dd4936`. (A first attempt, ignoring ancestors in `firstLinkOn`, left the test green: the planner also checks each ancestor folder as a path of its own.)
- mutation: the pointer's links -- `scripts/gen-skills.mjs`, the root README link `../README.md#the-skills-pack` -> `./README.md#the-skills-pack`, then `pnpm gen:skills`. Path: the generator and the committed `skills/README.md`. Red: `skills-generated-frontmatter.test.ts` `skills/README.md is the generated pointer...` (the links differ from the two expected ones). Restored by Edit and `pnpm gen:skills`: `scripts/gen-skills.mjs` `5d4fc43b...` and `skills/README.md` `a4bb7399...` again.
- mutation: the capstone's completeness row -- `packages/client-config/src/pack-targets.ts`, the `cursor` row `route: "cursor"` -> `route: "agents"`, then a rebuild (so the legs and the bin agree). Red: `epic41-capstone-gate.test.ts` `completeness: 17 unique ids, every route used...` alone (17 other tests pass). Restored; `src/pack-targets.ts` `d5ce4b0c...`, and after deleting `dist/` and `tsconfig.tsbuildinfo` and rebuilding, `dist/pack-targets.js` `529411d2...` and the sorted hash of `dist/` outside `__tests__` equal their pre-mutation values.
- mutation: the capstone's uninstall step (MC-8) -- `packages/client-config/dist/pack-apply.js` only, `removeFile` skips a path ending `.mdc`. Path: the built bin's uninstall. Red: the `cursor` leg alone, at the uninstall step (`added .cursor/rules/iris-mcp-objectscript-pre-write.mdc` is left behind). Restored, `pack-apply.js` `1f646009...`.
- mutation: the turbo non-vacuity test (rewritten to compare the test tasks with every package under `packages/`) -- `pnpm-workspace.yaml` gains `- "!packages/iris-ops-mcp"`. Path: turbo's own dry run of a copy of the manifests. Red: `story-41-7-turbo-test-graph.test.ts` `the set of test tasks is not vacuous...` alone. (The earlier `toBeGreaterThanOrEqual(8)` could not go red: turbo lists a `test` task for a package whose `test` script is removed.) Restored, sha256 `0fb360452b0231d114d0b0ad6cc76bb48fe528382f55827cf93739bf64ec79e1`.
- mutation: the turbo build-stays-cacheable test -- `turbo.json`, `"cache": false` added to `build`. Red: `story-41-7-turbo-test-graph.test.ts` `build tasks stay cacheable...` (`@iris-mcp/admin#build cache: expected false to be true`). Restored, `turbo.json` `7d844c71...`.

**AC 41.7.3, the implement stage's part** (steps 2 and 5, in a scratch directory under the session scratchpad, a temp `HOME` and `USERPROFILE`, `--project <scratch>/proj`, the built bin; `claude` was never run, no hook or `mcp.json` file was written, and the scratch directory was deleted afterwards): `proj/.claude/settings.json` was the only file before. Step 2, `skills install --client claude-code --project <scratch>/proj --yes`: exit 0, `21 to create ... Done: 21 path(s) changed for Claude Code.`, 18 directories under `proj/.claude/skills/` plus the rule `proj/.claude/rules/iris-mcp-objectscript-pre-write.md`; it also writes the notice beside `iris-mcp-objectscript-sql/SKILL.md` and `proj/.iris-mcp/skills-pack.json` (the 21 paths). Step 5, `skills uninstall --client claude-code --project <scratch>/proj --yes`: exit 0, `21 to remove ... Done: 21 path(s) changed`, and `proj/` held only `.claude/settings.json` again; the 21 backups went under `<scratch>/home/.iris-mcp/client-manager/backups/skills-pack/`. The procedure text needed no correction.

**Live check (AC 41.7.3)** -- the lead appends the record here at smoke, per the Design Notes procedure. Record: the `claude --version`; the commands run, with no secret; the init `skills` excerpt of each leg (positive: all 18 names; contrast: none); the reduced hook log (positive: an `InstructionsLoaded` with `file_path` ending `/proj/.claude/rules/iris-mcp-objectscript-pre-write.md` and `load_reason` `session_start`, earlier by `t` than, and in the same `session_id` as, the `PreToolUse` for `mcp__iris-dev__iris_doc_put` with a `tool_input.name` ending `.cls`; contrast: neither the `InstructionsLoaded` nor any skill, while the `.cls` `PreToolUse` still fires); `total_cost_usd` per leg (each at most 1); which oracle decided (the hook log, or the quote oracle if `InstructionsLoaded` never fired in either leg); and the cleanup (`<S>` deleted, `iris_doc_list` for `Probe417` returns `[]`). The oracle is false for the positive leg if the `InstructionsLoaded` is missing, later than the `PreToolUse`, carries `path_glob_match`, or comes from a path outside `<S>/proj`; it is void if the contrast leg logs it too. Not run by the implement stage.

**Live check record (the lead, 2026-10-20, at smoke): PASS. The hook log decided.**

- **Environment.**
  - CLI `2.1.296 (Claude Code)`.
  - `<S>` = `<lead scratchpad>/s417-live`, holding `proj/` (no `CLAUDE.md`; `proj/.claude/settings.json` registering `InstructionsLoaded` and `PreToolUse` (matcher `*`) command hooks that run `node <S>/log-hook.mjs`), `home/`, `mcp.json` (only `iris-dev`, built dist, `IRIS_HOST=127.0.0.1 IRIS_PORT=9`, dummy `live417` credentials), `log-hook.mjs` (it appends `{t, ...event}` and denies every `mcp__iris-dev__*` call with exit 2) and `check.mjs`.
  - Everything was written with the file tools. Client-config and every dist were rebuilt first (`turbo run build`, 7/7).
- **Step 2.** `HOME=<S>/home USERPROFILE=<S>/home node packages/client-config/dist/cli/clients-cli.js skills install --client claude-code --project <S>/proj --yes`: exit 0, `Done: 21 path(s) changed for Claude Code.`, 18 directories under `proj/.claude/skills/` and `proj/.claude/rules/iris-mcp-objectscript-pre-write.md`.
- **Step 4, the positive leg.** `perl -e 'alarm 300; exec @ARGV' -- env -u CLAUDECODE claude -p --model haiku --max-budget-usd 1 --strict-mcp-config --mcp-config ../mcp.json --setting-sources project --allowedTools mcp__iris-dev__iris_doc_put --disallowedTools Read,Write,Edit,Bash --output-format stream-json --verbose "<P>"`, with `<P>` as in Design Notes: exit 0, result `success`, `total_cost_usd` 0.0100.
  - **Init `skills`:** 40 entries, of which all 18 pack names: `audit-security-posture`, `check-system-health`, `deploy-and-test-class`, `diagnose-slow-query`, `edit-and-test-class`, `find-patient-messages`, `iris-mcp-interoperability`, `iris-mcp-objectscript-error-handling`, `iris-mcp-objectscript-gotchas`, `iris-mcp-objectscript-sql`, `iris-mcp-objectscript-unit-tests`, `iris-mcp-system-classes`, `promote-environment-change`, `provision-project-environment`, `recover-stuck-production`, `resend-failed-messages`, `run-external-backup` and `trace-message-flow`. The other 22 are built-ins.
  - **Hook log:** one `InstructionsLoaded` for `<S>/proj/.claude/rules/iris-mcp-objectscript-pre-write.md`, with `load_reason` `session_start` and no `path_glob_match`, at t=1792462877236 in session `70ea8ab2…`. The `PreToolUse` for `mcp__iris-dev__iris_doc_put` with `tool_input.name` `ExecuteMCPv2.Temp.Probe417Live.cls` came 10.0 s later in the same session.
  - **Denied.** The call was denied by the hook ("blocked by the live check"), and there was no `Read`/`Write`/`Edit`/`Bash` `PreToolUse`.
- **Step 5.** `skills uninstall --client claude-code --project <S>/proj --yes`: exit 0, `Done: 21 path(s) changed`, and `proj/` held only `.claude/settings.json`.
- **Step 6, the contrast leg.** The same command: exit 0, result `success`, `total_cost_usd` 0.0032.
  - **Init `skills`:** 22 entries, the built-ins only, with none of the 18.
  - **Hook log:** no `InstructionsLoaded` at all. The `.cls` `iris_doc_put` `PreToolUse` still fired (session `7187bd1b…`) and was denied, and there was no local-tool call.
- **Step 7.** `check.mjs` reported `ORACLE skills=PASS rule=PASS cost=PASS no_local_tools=PASS`. Total cost: USD 0.0132.
- **Step 8, cleanup.** No IRIS contact; the closed port and the hook deny meant the fallback (step 9) was not needed. `iris_doc_list` (`server:"default"`, `namespace:"HSCUSTOM"`, filter `Probe417`, `generated:true`) returned `[]`, and `<S>` was deleted.

**Containment.** At the end, `git status --short --ignored` lists only this story's files and the ignored `.turbo/`, `_bmad/custom/config.user.toml`, `_bmad/render/bmad-build-auto/`, `irislib/` and `irissys/` entries that existed before; the real `.claude/` (1066 files, all tracked, none modified in the session), `CLAUDE.md` (sha256 `9a4a8a54274766987cb5da19d65f365e5836cc7c218d9ae24e8d25b5479e8865`, same as at the start) and the repository root hold no `.agents/`, `.cursor/`, `.iris-mcp/`, `AGENTS.md` or `GEMINI.md`; `~/.iris-mcp/` and `~/.iris-mcp/client-manager/backups/skills-pack` do not exist. No IRIS call was made.

### QA-stage record (2026-10-19)

**Tests added (QA).** All three are in the default suites (`vitest list` shows them), need no IRIS, write only under temp directories they remove, and pass in either order (shuffle seeds 11 and 22).
- (QA) `packages/client-config/src/__tests__/qa-41-7-capstone-safety.test.ts` -- 17 tests: for each of the 16 routed clients, on the built bin, the install backs up an existing `AGENTS.md`/`GEMINI.md` byte for byte and takes no other backup, the uninstall backs up every file it removes (one backup per path, byte for byte), every file under the temp home is inside the backup directory after the install and after the uninstall, and the three plain host shapes the capstone never block-edits (`lf`, `crlf`, `bom+lf`) rotate through the 14 block routes. Plus one row that the rotation reaches all three shapes.
- (QA) `packages/client-config/src/__tests__/qa-41-7-generated-table-gate.test.ts` -- 2 tests: `render --check` runs only after `assertBinFresh` (the renderer reads `dist/`, so a `src/` edit with no rebuild must not leave the gate green), and the committed table has a header, a delimiter row and 17 body rows with six cells each, split the way GFM splits (on unescaped pipes), in `PACK_TARGETS` order.
- (QA) `packages/iris-mcp-all/src/__tests__/qa-41-7-doc-links.test.ts` -- 11 tests: every relative link and anchor of the nine changed documents that carry links resolves to a file or a GitHub-slug heading (nine rows), a checker self-row that must report a missing file and a missing anchor, and a stale-exemption row for the pre-existing broken links listed in the runtime checks below.

**Gaps found in the capstone, by mutation on `dist/` (restored afterwards, each file's sha256 equal to its value before).** Values are the capstone's result, then the rest of the client-config suite.
- mutation: S1 -- `dist/pack-apply.js`, the uninstall deletes without `backup(...)`. Capstone 18/18 GREEN (gap); `qa-41-6-routes-process` (cursor, gemini) and `qa-41-6-safety-process` (the allowed-file control) go red. After the new file: `qa-41-7-capstone-safety` 16 of 17 red (`<path>: backups taken: expected [] to have a length of 1`).
- mutation: S3 -- `dist/pack-apply.js`, the install edits an existing host without backing it up. Capstone GREEN (gap); 5 41.6 tests red. New file: 14 red (the block routes), the two file-rule routes and the rotation row stay green.
- mutation: S2 -- `dist/pack-apply.js`, every full uninstall writes `~/.iris-mcp/client-manager/uninstall-last-run.txt`. Capstone GREEN (gap); 3 41.6 tests red. New file: 16 red (`is outside the backup directory`).
- mutation: C1 -- `dist/rule-block.js`, a BOM-less CRLF-terminated host is normalised to LF before the block is appended (the byte shape the capstone gives only to file-rule routes). Capstone GREEN (gap); `qa-41-6-byte-fixtures-process` 6 red (codex, gemini). New file: the five legs that received `crlf` red (cline, codex, goose, pi, agents).
- mutation: C2 -- `dist/pack-plan.js`, the notice written at the skills root for the `gemini` route only. Capstone RED on the gemini leg alone (17 pass): a wrong notice placement for another route IS caught.
- mutation: table freshness -- `packages/client-config/src/pack-targets.ts`, the `claude-code` `why` edited, no rebuild. Path: the renderer reading the stale `dist/`. `certification-docs.test.ts` stays GREEN (5/5, the gap); `qa-41-7-generated-table-gate` row 1 RED (`src/ has been modified more recently than its dist/`), row 2 green. Restored by Edit (sha256 `d5ce4b0c...`), then `touch dist/index.js`.
- mutation: table structure -- `packages/client-config/README.md`, a bare `|` inserted in the `agents` row. Red: `qa-41-7-generated-table-gate` row 2 (`row 17 (agents): ... 7 cells`), and row 1 (`--check`). Restored, sha256 `89d73d33...`. The structure row is the oracle that is independent of the renderer's own escaping (no real `PACK_TARGETS` text holds a pipe today).
- mutation: doc links -- root `README.md`, `## Workflow Prompts & Agent Skills` renamed to `... and ...`. All 28 other files with `doc` in the name (613 tests) stay GREEN: no other test pins the four `#workflow-prompts--agent-skills` links. `qa-41-7-doc-links` 7 red (README, `tool_support.md`, the four server READMEs, the checker self-row). Restored, sha256 `cd842e54...`.

**Runtime checks of the docs (built bin, temp `HOME`, a temp cwd that links `packages/client-config`, bare `iris-mcp-clients` through a temp shim, a pty for the confirmation).** No test files; recorded here.
- Every command line of the root README section and the four example lines of the client-config README ran as written. The three non-dry install lines refuse with exit 2 and the plan printed when there is no terminal (by design); under a pty, answering `n` exits 1 and writes nothing, answering `y` installs (`Done: 21 path(s) changed for <client>`). The paths written equal `PACK_ROUTES`: `claude-code` -> `.claude/skills/` + `.claude/rules/iris-mcp-objectscript-pre-write.md`; `cursor` -> `.agents/skills/` + `.cursor/rules/...mdc`; `gemini` -> `.agents/skills/` + a block in `GEMINI.md`; `codex` and the other 12 ids of the "Every other client" row (the list equals the `PACK_TARGETS` agents-route ids) -> `.agents/skills/` + a block in `AGENTS.md`. The record is `.iris-mcp/skills-pack.json`; uninstall backups land under `<home>/.iris-mcp/client-manager/backups/skills-pack/`. After the four installs into one project and the four uninstalls, the project that held nothing is empty again.
- The five known limits hold on the bin: `--scope user` exits 2 (`skills supports only --scope project`), `claude-desktop` exits 2 with the refusal, a symlinked `AGENTS.md` -> `CLAUDE.md` gives exit 1 with a conflict and both files byte-identical, an edited installed file is `keep`-ed on install and uninstall, and `--include-modified` removes it after a backup (`SKILL.md.<stamp>`).
- Root README `:240` ("It also installs the skills pack into a project"): `apply --client claude-code --servers iris-dev-mcp --scope project --yes` in a temp project wrote `.mcp.json` only, and `cmdApply` never calls `preparePackChange`/`executePackPlan`. The sentence is wrong as read (the antecedent of "It" is `apply`); reported, not edited.
- Relative links: 349 links in 11 changed documents; every one the story added or relies on resolves. 4 pre-existing links fail (`#read-only-mode-point-it-at-production-with-one-environment-variable` at `README.md:81,391` and `packages/iris-dev-mcp/README.md:45,197`; the heading holds an em dash, so its slug keeps two hyphens).

**DW-611 on the real tools.** `turbo run test --filter=@iris-mcp/all --dry-run=json` (turbo 2.9.4): `@iris-mcp/all#test` has `dependencies ["@iris-mcp/all#build","@iris-mcp/client-config#build"]`, and `resolvedTaskDefinition.cache` is `false` on every `test` task (`@iris-mcp/client-config#test` is `vitest run`). On a scratch workspace with the repo's `turbo.json` byte for byte and `echo` scripts, real runs: pre-41.7 config, run 2 and run 3 (after a one-byte change under `skills-pack-src/`) print `cache hit, replaying logs` with the same hash `1c7543c81e3fe551` (a stale green replayed); with the 41.7 `turbo.json` every run prints `cache bypass, force executing` and executes (the hash is unchanged by the byte, the cache is not consulted). `node scripts/check-provenance.mjs` on the real tree: OK when `dist/` is newer, and with `touch packages/client-config/src/index.ts` exit 1 `[distribution] installer: ... client-config's dist is not fresh`; back to OK after `touch packages/client-config/dist/index.js`.

**Generated docs.** On a scratch copy of the package (renderer, results, `dist/adapters.js`, `dist/pack-targets.js`, rule stems, README): baseline `--check` exit 0; a changed `why` in the scratch dist with the README untouched exits 1 (`OUT OF SYNC`), a re-render fixes one row and `--check` exits 0; a `|` in a `why` (also inside a code span) is written `\|`, the row keeps six cells and `--check` exits 0; a duplicate id exits 2 on `--check` and on write. The real 17-row table has six cells in the header, the delimiter row and each body row, in `PACK_TARGETS` order, and no escaped pipe (no real text holds one).

### Code-review record (2026-10-20)

**Mutation lines** (each applied with the Edit tool or, for the freshness guards, `touch`; observed red; restored; every restored file's sha256 equal to its value before, `git status --short` unchanged):
- mutation: CR-1, the manager pointer -- `README.md:240` back to "It also installs the skills pack into a project". Path: the committed README the doc test reads. Red: `story-41-7-doc-claims.test.ts` `` `### The skills pack` is one heading, and every document that points at it holds the link ``.
- mutation: CR-2, the read-only-mode anchors -- `README.md:81` back to `#read-only-mode-point-...` (one hyphen). Path: the committed README the link checker resolves, with no exemption left. Red: `qa-41-7-doc-links.test.ts` `README.md: no relative link is broken`.
- mutation: CR-3, the client-config known limits (text) -- the `--project ~` bullet deleted from `packages/client-config/README.md`. Red: `skills-docs.test.ts` `` `--project` is not compared with the home directory... ``. (CR-1 to CR-3 were applied together; each turned exactly its own test red: 2 of 31 and 1 of 11.)
- mutation: CR-4, the client-config known limits (bin) -- `packages/client-config/dist/cli/clients.js` only, `cmdSkills` refuses a project equal to `$HOME`. Path: the built bin. Red: the same `skills-docs.test.ts` row (`Error: MUTATION: the home directory is refused`), 1 of 11.
- mutation: CR-5, the ZIP claim -- `packages/client-config/dist/pack-targets.js` only, `CLAUDE_DESKTOP_REFUSAL` "upload skills as a ZIP" -> "as an archive". Path: the built dist the doc test imports. Red: `story-41-7-doc-claims.test.ts` `states that Claude Desktop has no route...`, 1 of 21. Restored, `dist/pack-targets.js` `529411d2...` and `dist/cli/clients.js` `4ea7c7f6...` again.
- mutation: CR-6, the admin freshness guard -- `touch packages/iris-admin-mcp/src/tools/presets.ts`. Path: `beforeAll`'s `checkDistFresh` on the admin package. Red: `story-41-7-doc-claims.test.ts` fails in `beforeAll` (`@iris-mcp/admin's src/ has been modified more recently than its dist/`, 21 skipped). Restored by `touch packages/iris-admin-mcp/dist/tools/presets.js`.
- mutation: CR-7, the client-config freshness guard -- `touch packages/client-config/src/index.ts`. Red: the same file fails in `beforeAll` (`@iris-mcp/client-config's src/ ...`). Restored by `touch packages/client-config/dist/index.js`; the file is 21/21 green again.
- mutation: CR-8, package-level turbo config -- a new `packages/iris-ops-mcp/turbo.json` (`{"extends":["//"],"tasks":{"test":{"cache":true}}}`). Path: turbo's own dry run of the copied manifests. Red: `story-41-7-turbo-test-graph.test.ts` `every test task resolves to cache: false...` (`@iris-mcp/ops#test cache: expected true to be false`). Restored by deleting the file; 4/4 green.
- mutation: CR-9, the epic back-compat AC (the prompt wire) -- `packages/iris-ops-mcp/dist/prompts/checkSystemHealth.js` only, one character added to the prompt's description. Path: the built ops server over stdio. Red: `story-41-2-qa-prompts-stdio-wire.test.ts` `iris-ops-mcp: prompts/list hashes to its golden value` (`f10c8595...` is not `a8a37a4e...`), 1 of 35. Restored, sha256 `9ecfc3d2...` again; 35/35 green.
- The helper moves (`ancestors`, `ageAllFiles`, `mtimes`, `filesOutsideBackups`, `markdownHeadingSlugs`) change no assertion, so the capstone's MC-1 to MC-8 lines and the link rows' QA lines stand.

**Runs after the patches** (tool output): `@iris-mcp/client-config` test 37 files, 1008 passed; its `type-check` and `lint` clean. `@iris-mcp/all` in three slices (`IRIS_HOST=127.0.0.1 IRIS_PORT=1`): 42 + 42 + 42 = 126 files, 913 + 584 + 928 = 2425 passed, 279 + 178 + 192 = 649 skipped (live gates), 0 failed. `gen:skills:check` 13 files, `gen:pack:check` 23 files, renderer `--check` in sync, `check:provenance` 1 row / 40 agent files / 12 distributions, `validate:prompts` 52 sources, `gen:governance-baseline:check` OK, `gen:tools-list-snapshot:check` 115 entries unchanged. Shuffle seeds 11 and 22 on the changed files: client-config 4 files / 52 tests, iris-mcp-all 4 files / 69 tests, green in both orders. No IRIS call; `claude` never run; the installer ran only under temp homes and temp projects.

## Auto Run Result

Status: done
Blocking condition: none

**Summary.** Story 41.7 documents the skills pack installer and gates the epic.
- The root README gains `### The skills pack` (the four routes, the preview-then-install commands, the not-nested presets paragraph and five known limits). The retirement sentence, the `:830` bullet, the manager-section pointer, the four server READMEs' Agent Skills line and `tool_support.md` point at it.
- `render-certification-table.mjs` generates a 17-row `Skills pack targets` table in the client-config README, with a roster guard (exit 2) and `--check`.
- `skills/README.md` is a generated pointer, and the catalog says the presets are not nested (DW-624).
- `epic41-capstone-gate.test.ts` (client-config's default suite) drives the built bin for all 17 client ids: 16 routed legs (install, aged re-install, uninstall) and the Claude Desktop refusal, plus a completeness row.
- DW-611: every turbo `test` task is uncacheable, `@iris-mcp/all#test` depends on `@iris-mcp/client-config#build`, and the installer probe fails closed on a client-config dist older than its `src/`.
- AC 41.7.3 is the lead's: the procedure, both oracles and what would prove each false are in Design Notes; the record placeholder is under `## Verification`.

**Files changed.**
- Docs and generated: `README.md`, `tool_support.md`, `CHANGELOG.md`, `.changeset/story-41-7-skills-pack-docs-and-capstone.md` (new, `patch`), `packages/client-config/README.md`, `packages/client-config/skills-pack/README.md` (generated), `skills/README.md` (generated), the dev, admin, interop and ops package READMEs.
- Generators: `scripts/gen-skills.mjs`, `scripts/lib/skills-pack.mjs`, `packages/client-config/scripts/render-certification-table.mjs`.
- DW-611: `turbo.json`, `scripts/lib/installer-payload-probe.mjs`.
- New tests: `packages/client-config/src/__tests__/epic41-capstone-gate.test.ts`, `skills-docs.test.ts`, `packages/iris-mcp-all/src/__tests__/story-41-7-doc-claims.test.ts`, `story-41-7-turbo-test-graph.test.ts`.
- Changed tests: `certification-process.test.ts`, `story-41-2-doc-claims.test.ts`, `skills-generated-frontmatter.test.ts`, `skills-pack-rule.test.ts`, `skills-pack.test.ts`, `story-41-6-qa-installer-provenance-cli.test.ts`.

**Review findings.** 34 findings from four layers: high 0, medium 6, low 28 (counted mechanically from the triage log).
- Patches applied, in 7 entries (5 medium, 2 low): the link-limit pins (a link above a written path, a second hard link); Rule 19 evidence (the turbo non-vacuity test rewritten so it can fail, lines for the completeness row, the build-cacheable test and the capstone's uninstall step); the capstone reuses `readProjectFile`, `packRuleForms` and `packNotice` (Rule 2); the renderer's row-count, unknown-route and pipe-escaping rows; the `skills/README.md` link pin; the "asks before it writes" pin; the turbo child's environment.
- Deferred, 2 items (both low, new `deferred:` entries 2 and 3): the Cursor and VS Code `why` text, and the stale `package.json` description of client-config. The npx item from planning stays.
- Rejected, 22 rows, each with its reason in the triage log. Most are spec-bound golden text or decided D1-D8.

**Follow-up review recommended: true.** Five medium entries were patched (the rule is two or more). The unverified risk is that the patch code, 3 new sandbox rows, 3 new doc-claims tests, the rewritten turbo test and the capstone helper swap, has had a mutation proof for each pin but no independent review pass.

**For the lead.**
- The root README `:240` sentence ("It also installs the skills pack into a project") reads as if `apply` installs the pack. Three layers flagged it. It is the D3 golden text, so it was kept; a one-clause fix ("`iris-mcp-clients skills install` also installs ...") would need a golden change.
- The probe guard is conditional on `packages/client-config/src` existing in the checked root, which is how existing scratch roots stay unchanged (the matrix row).
- `BOOTSTRAP_VERSION` is unchanged at `5296a1c836f4`. The catalog moved from 11859 bytes (sha256 `00004f56...`) to 12210 bytes (sha256 `e4e2e800...`), 49 lines either way.

**Verification performed.** Every `## Verification` command ran on the final tree, with `IRIS_HOST=127.0.0.1 IRIS_PORT=1` on every `@iris-mcp/all` run.
- (loop) lines were re-run after the last patch; `gen:skills --check` (13 files), `gen:pack --check` (23 files), the renderer `--check`, the client-config tests (59 in the four files), the iris-mcp-all tests (300 in the ten files), `check:provenance` (1 row, 40 agent files, 12 distributions) and `validate:prompts` (52 sources) all pass.
- (once) lines ran once, after the last patch: `@iris-mcp/client-config` test 982, type-check and lint clean; `@iris-mcp/all` three slices 2415 passed and 649 skipped (live gates), 0 failed; the five server `index.test.ts` files; the tools-list snapshot (115) and governance baseline (141) checks; the shuffle seeds 11 and 22 in both packages.
- Mutation lines for every pinning test, including the review patches, are under `## Verification`; each restore was confirmed by sha256.
- Containment: `git status --short --ignored` shows only this story's files; the real `.claude/`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.agents/`, `.cursor/` and `.iris-mcp/` are unchanged; `~/.iris-mcp` does not exist. No IRIS call was made and `claude` was never run.

**Residual risks.** AC 41.7.3 (the live Claude Code check) is not run. The documented `iris-mcp-clients ...` lines of the client-config README run through the built bin path, not as the bare string. The per-client table reflects the client documentation read on 2026-10-19.
