---
title: 'Story 42.9: Install Docs and Client Re-Certification'
type: 'feature'
created: '2026-11-21'
status: 'done'
baseline_revision: '915703e5b98ab7f80c71aa11c62467a2b558314e'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-42-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-42-8-claude-code-plugin-and-registry-listings.md'
warnings:
  - multiple-goals
  - oversized
deferred:
  - summary: >-
      VS Code now calls the files the `vscode` adapter writes (`.vscode/mcp.json`, the profile `mcp.json`) "deprecated Local harness"
      files, removed in February 2027. New Copilot configurations belong in `~/.copilot/mcp-config.json` (or `$COPILOT_HOME`) and a
      workspace-root `.mcp.json`, both with the `mcpServers` key.
    evidence: >-
      code.visualstudio.com/docs/agents/reference/mcp-configuration, fetched 2026-11-21: "For new Copilot configurations, use these
      native destinations, not .vscode/mcp.json or profile mcp.json. Those files use the deprecated Local harness". The old files are
      still forwarded today, except configurations that use ${input:} or ${command:}. The `agents` skills route that vscode uses has
      the same exposure.
    location: 'packages/client-config/src/adapters.ts vscode entry; extensions/iris-mcp-launcher (server definitions)'
    severity: medium
  - summary: >-
      Kilo Code documents MCP (`~/.config/kilo/kilo.json[c]` / `./kilo.json[c]` or `./.kilo/kilo.jsonc`, top-level `mcp` key), but its
      entries use an OpenCode-style shape (`type:"local"`, `command` as an array, `environment`, `enabled`). That needs a new entry
      shape in the engine, so the client stays on the roadmap with the verified facts.
    evidence: 'kilo.ai/docs/automate/mcp/using-in-kilo-code, fetched 2026-11-21; adapters.ts says drift is fixed by patching adapter data, never engine code.'
    location: 'packages/client-config/src/adapters.ts CLIENT_DISPOSITIONS kilo-code'
    severity: low
  - summary: >-
      Devin Desktop (formerly Windsurf) has its own MCP files: `~/.config/devin/mcp_config.json` (`%APPDATA%/devin` on Windows) and
      `.devin/mcp_config.json`. It reads the legacy `~/.codeium/windsurf/mcp_config.json` only through an import that is on by default
      and that the user can switch off. The adapter keeps the legacy file, so earlier installs stay findable. Retargeting it is a candidate.
    evidence: 'docs.devin.ai desktop/devin-local/customizations and cli/reference/configuration/read-config-from, fetched 2026-11-21; that Devin Local reads the import is inferred, not probed live.'
    location: 'packages/client-config/src/adapters.ts windsurf entry'
    severity: low
  - summary: >-
      Roster completeness (Rule #56): this story reviews the 16 existing client ids plus Antigravity CLI. It does not disposition other
      MCP clients that now document setup, such as GitHub Copilot CLI (`~/.copilot/mcp-config.json`), OpenCode, Continue and Amp.
    evidence: 'DW-626 scoped the review to the stale rows. No search for clients missing from the roster was run.'
    location: 'packages/client-config/src/adapters.ts CLIENT_ADAPTERS / CLIENT_DISPOSITIONS'
    severity: low
---

<intent-contract>

## Intent

**Problem:** The install docs still describe the pre-publish state.
- Clone-and-build instructions, `node …/dist/index.js` entries and "not yet published" caveats appear in about 35 places.
- The client adapter data is stale against the clients' current docs as read on 2026-11-21:
  - three clients that now document MCP are listed as excluded or roadmap;
  - some clients were renamed or archived;
  - one documentation link is dead;
  - Goose's Windows path is wrong.
- The certification table is dated 2026-07-28 and was taken against unpublished code.
- A project-scope write made from the home directory silently lands in the user's global config (DW-702).
- A Claude Code plugin user with older `iris-*-mcp` entries gets every tool twice, and nothing tells them (DW-706).

**Approach:**
- Rewrite the install docs for the state at `v1.1.0`. The user installs Node 22 and runs one command, with one path per client:
  - **Claude Code:** the plugin;
  - **VS Code:** the extension;
  - **every other client:** `npx -y -p @iris-mcp/client-config@1 iris-mcp-clients apply …`.
- Move clone-and-build to Contributing, and fix the routed doc defects.
- Re-disposition the adapters, and add a dated `humanOnly` marker to certification records.
- Add the home-directory guard and a `doctor` duplicate check to `@iris-mcp/client-config`.
- Align the CHANGELOG and the PRD with what shipped.
- The re-certification against the published packages is a lead step after npm `1.0.0` is live.

## Boundaries & Constraints

**Always:**
- **One documented path per client** (AC 42.9.1; epic UX):
  - **Claude Code:** `/plugin marketplace add jbrandtmse/iris-execute-mcp-v2`, then `/plugin install iris-mcp@iris-mcp`.
  - **VS Code:** the `iris-mcp.iris-mcp-launcher` extension from the Marketplace or Open VSX.
  - **Every other client:** the clients CLI. The CLI is also the documented fallback on 1.0.x.
- **Version availability** (DW-707). The plugin and the extension are documented as available "from 1.1.0", and the docs never tell anyone to install either before that.
- **Pins and floors.** Every documented `npx` spec carries `@1`, and every bin is reached through the `-p` form, as `npx-pin.test.ts` enforces. The Node floor is `>=22.17.0`.
- **The IRIS claim.** The docs state "2023.1 or later, best effort below the oldest CI-tested image". The tested range is 2026.1 to 2026.2, from the CI images in `scripts/throwaway-iris.mjs` (spine Stack).
- **Counts and measurements are mechanical (Rule #51).** Tool counts come from `fixtures/tools-list-snapshot.json`, payload bytes from `node scripts/measure-tools-payload.mjs`, and skills counts from the pack.
- **The DW-702 guard (decision #100).** A project-scope write is refused when the project directory resolves to the home directory. Both paths go through `realpath`, and on darwin and win32 they are compared case-insensitively.
  - It covers `apply`, `diff`, `enable`, `disable`, `remove`, `restore` with `--scope project`, and `skills install|uninstall`.
  - Reads are unaffected: `detect`, `status`, `doctor`.
  - It is an operational refusal: exit 1, nothing written, the reason in the `--json` envelope's `error`.
  - The text follows the convention "`<what happened>. <what to do>.`" and names both paths. Example: `refusing to write the project scope of cursor: the project directory /Users/u is your home directory, so the project file /Users/u/.cursor/mcp.json is the user file /Users/u/.cursor/mcp.json. Open a project folder (or cd into one), or use --scope user.` When the two paths differ, it says "is a user-level location (<user path>)".
- **Writes go only to owned content** (AD-30). Every new or changed adapter's fixtures include non-canonical variants (Rule #58).
- **Error text and source text.** Error messages follow the `<what happened>. <what to do>.` convention. Source code writes non-ASCII as escapes (Rule 14). Never generate file content through a heredoc (Rule #55).

**Never:**
- **No publish-shaped command, ever.** No `npm`/`pnpm publish`, `changeset version`/`publish`, `pnpm run version` on the real tree, `npm login`/`trust`, `vsce`/`ovsx`, `mcp-publisher`, `git tag`/`push`, or `gh` other than GET.
- **No real client config and no shared instance.**
  - No stage touches the real `~/.claude`, `~/.claude.json` or any real client config. Process tests use a temporary `HOME` and `CLAUDE_CONFIG_DIR`.
  - No certify run happens in implement or QA.
  - No IRIS calls, and no docker outside `scripts/throwaway-iris.mjs`.
- **Nothing outside the docs and client-config surfaces.**
  - No ObjectScript, REST route, frozen golden or governance baseline edit (`1e62c5ad5bf7`/141).
  - `BOOTSTRAP_VERSION` does not move.
  - No tool or tool count change.
  - No edit to generated files except through their generators (`render-certification-table.mjs`, `gen:pack`).
- **No re-certification records are fabricated.** A `certified-live` row is written only by `certify.mjs` (the lead's run). Implement and QA never hand-edit evidence or dates into a `certified-live` record.
- **No adapter behind an undocumented path.** For Kilo Code (new entry shape) and Antigravity CLI (detection collides with Gemini's `~/.gemini`), only disposition rows are added.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Home guard: alias (DW-702) | `HOME=cwd=<tmp>`; `apply --client cursor --servers iris-dev-mcp --scope project --yes --json` | exit 1; envelope `error` names `<tmp>/.cursor/mcp.json` twice and says to open a folder or use `--scope user`; no file created | refusal |
| Home guard: every aliasing adapter | same, for `codex`, `gemini`, `kimi-code` (no `KIMI_CODE_HOME`), `jetbrains-junie` | the same refusal, one test row each | refusal |
| Home guard: non-aliasing adapter | same, for `vscode` (`~/.vscode/mcp.json` vs `…/Code/User/mcp.json`) | refused: "is a user-level location" | refusal |
| Home guard: symlink or case | `cwd` is a symlink to `HOME`; or on darwin `cwd` differs from `HOME` only in case | refused | refusal |
| Home guard: subfolder | `cwd=<tmp>/proj`, `HOME=<tmp>` | project write proceeds as today | — |
| Home guard: skills | `skills install --client claude-code` with project equal to `HOME` | exit 1, the same refusal form, nothing written under `~/.claude/` | refusal |
| Home guard: reads | `status --json` / `doctor` with `cwd=HOME` | unchanged output, exit as today | — |
| Doctor duplicates (DW-706) | `<CLAUDE_CONFIG_DIR>/settings.json` `{"enabledPlugins":{"iris-mcp@iris-mcp":true}}`; `~/.claude.json` top-level `mcpServers.iris-dev-mcp` | finding `claude-code-plugin-duplicates`: `[claude-code/user] iris-dev-mcp is also served by the Claude Code plugin iris-mcp (enabled in <file>): every tool appears twice. Remove it: npx -y -p @iris-mcp/client-config@1 iris-mcp-clients remove --client claude-code --server iris-dev-mcp --scope user`; exit 1 | — |
| Doctor, plugin off | same entries; key absent or `false` (highest file wins) | no such finding | — |
| Doctor, project scope | plugin on; `<cwd>/.mcp.json` holds `iris-ops-mcp` | finding names `claude-code/project` and `--scope project` | — |
| Certification `humanOnly` | a record with `"humanOnly":{"check":"…","markedOn":"2026-11-21"}` | the table cell shows `human-only (marked 2026-11-21): <check>`; `--check` is in sync | malformed `humanOnly` (missing field, bad date) → render exits 2 naming the client |
| Integration: extension view | the launcher's `clientsEngine` real-CLI wrappers (`resolveClientsCli` → `runClientsCli` → `mapJsonResult`) run the alias row against a sandbox `HOME` | the view's error text contains the refusal reason, not "see stderr" | — |

</intent-contract>

## Code Map

**Rule #56 caveat inventory (exhaustive as of 2026-11-21).**

Search (repo root):
```
git ls-files '*.md' | grep -Ev '^(_bmad/|_bmad-output/|\.claude/|irislib/|irissys/|sources/)|node_modules'
```
That gives 83 files. They were grepped with `-nEi 'not yet published|not published|until (it is |they are )?published|before (the )?publish|unpublished|git clone|clone the repo|build from source|pnpm install && pnpm build|pnpm (run )?build|local path|dist/index\.js|\bbeta\b|from 1\.1\.0|coming soon|once published|after publish|not yet (on|available)|pre-release|prerelease'`, then with `'until then|1\.1\.0|\b1\.0\.0\b|future release|marketplace|from this checkout|from a clone|cloning|pnpm install'`, then for `"command": ?"node"`. Package `description` fields and `scripts/lib/skills-pack.mjs` `PLUGIN_README_SECTION` were also checked; neither has a caveat. Verdicts:

| Where | Text | Verdict |
|---|---|---|
| `README.md:3` | "has not yet been published to npm or IPM. Install by cloning" | remove |
| `README.md:25` | "Once published, `@iris-mcp/all` installs…" | rewrite (no "Once published") |
| `README.md:52-61` | "Until packages are published…", `### 1. Clone and Build` | rewrite as the published install; clone-and-build moves to `## Contributing` |
| `README.md:151-159` | "not yet on any Marketplace. Build a VSIX" | rewrite: store install, from 1.1.0 |
| `README.md:176-179, :197, :201-204, :221` | "Not yet published to npm… invoke it directly with `node`" for the credentials and governance CLIs | rewrite: `npx -y -p @iris-mcp/shared@1 iris-mcp-credentials` / `iris-mcp-governance` |
| `README.md:225` | "Claude Code plugin (from 1.1.0)… rewritten in Story 42.9" | keep "from 1.1.0"; drop the story sentence |
| `README.md:227, :233-239, :262-327` | `node` + local `dist/index.js` entries; "Not yet published" clients CLI | rewrite to `npx … @1`; the entry-point path table moves to Contributing |
| `README.md:349` | "published to the IPM registry from the first release (`1.0.0`)" | rewrite: from 1.1.0 (IPM's first channel release) |
| `README.md:921-929` | "the package is not yet published to npm", `node …clients-cli.js skills` ×6 | rewrite to `npx -y -p @iris-mcp/client-config@1 iris-mcp-clients skills …` |
| `README.md:1141` | "first store release is the next release after `1.0.0`" | keep: true (Releasing, contributor docs) |
| `README.md:1090-1143` | Contributing, CI, Releasing | keep: contributor docs |
| `docs/client-config/README.md:8-9, :121` | "Not yet published to npm…", "`npx -y @iris-mcp/dev@1` will fail" | remove |
| `docs/client-config/README.md:132-284` (9 snippets) | `node …/dist/index.js` client snippets | rewrite to `npx … @1` |
| `docs/client-config/{claude-code,claude-desktop,cursor}.md:6` | "(Not yet published to npm — until then: `node …`)" | remove |
| `docs/client-config/{claude-code:214,231-232; cursor:212,229-230}` | `/path/to/…/dist/index.js` governance-file examples | rewrite to `npx` |
| `docs/client-config/{claude-code:249, claude-desktop:216, cursor:247}` | "Pre-release: the suite is not published to npm yet" | remove |
| `packages/client-config/README.md:22-23` | "(Not yet published to npm — until then run the built bin" | remove (moves the `certification-docs.test.ts:86-92` pin) |
| `packages/client-config/README.md:315-317` | "Re-run it after the first npm publish" | rewrite: the re-certification procedure (`certify.mjs`, published packages) |
| `packages/client-config/README.md:349, :436` (inside `CERTIFICATION-TABLE`) | "@iris-mcp/dev was unpublished as of 2026-07-28" | keep as dated evidence; the lead's certify re-run replaces the three `iris-mcp-all` records |
| `extensions/iris-mcp-launcher/README.md:8-9, :65-77` | "published on the Marketplace and Open VSX" | keep (true from 1.1.0, the extension's first store release); add "(from 1.1.0)" to :8 |
| `extensions/iris-mcp-launcher/README.md:41, 77, 153, 184, 320, 392` | development mode, `npm run package` | keep: contributor docs |
| package READMEs "Breaking (pre-release)" (`iris-admin-mcp:823, 895`; `iris-data-mcp:171, 542`; `tool_support.md:140, 341`) | historical schema notes | keep (history) |
| `docs/bugs-*`, `docs/known-bugs-*`, `docs/epic-summary.md:24`, `CHANGELOG.md` history | historical records | keep |

**Install docs**
- Root `README.md` (1,143 lines):
  - Quick Start :50-358 becomes the install.
  - Pinned headings that must survive or be moved together with their pins:
    - `### Meta-package` (`meta-package-docs.test.ts:100-127`);
    - `` `iris-mcp-governance` CLI `` (`docs-governance-cli-recipes.test.ts:105`);
    - the IPM subsection "exactly once, directly after `### 4. Verify`" and the text "from the first release (`1.0.0`)" (`story-42-4-doc-claims.test.ts:58-139`, :91);
    - the two `/plugin` commands, the "N skills" counts and the "installs only the rule" sentences (`story-42-8-doc-claims.test.ts:93-126`);
    - `story-43-4-*` and `transport-rejection-gate.test.ts` text;
    - `### Releasing` (`story-42-5/6/7/8-doc-claims`).
  - The IRIS claim is at :45. CI's tested floor is at :1098.
  - `IRIS_ACCEPT_LANGUAGE` is at :77. The `IRIS_USERNAME` row is at :73.
  - The payload table is at :798-810.
- `docs/client-config/README.md` (the 13-client index) and `docs/client-config/{claude-code,claude-desktop,cursor}.md`:
  - The canonical command is already at :4: `npx -y -p @iris-mcp/client-config@1 iris-mcp-clients apply --client <id> --servers iris-dev-mcp`.
  - DW-631: the anchors at `claude-code.md:306`, `claude-desktop.md:273` and `cursor.md:304` should be `#read-only-mode--point-it-at-production-with-one-environment-variable`. No page mentions `skills install`.
- DW-664, `IRIS_USERNAME` "No | `_SYSTEM`" rows (10 in all; the code makes it required, `packages/shared/src/config.ts:107, :162-169`):
  - `README.md:73`;
  - `packages/iris-{admin,data,dev,interop,ops}-mcp/README.md:31`;
  - `packages/iris-mcp-all/README.md:72`;
  - `docs/client-config/claude-code.md:36`, `claude-desktop.md:35`, `cursor.md:36`.
- DW-633:
  - `README.md:77`, `tool_support.md:21` and the comment at `packages/shared/src/http-client.ts:203-213` describe a per-worker message table. The real model is per request: `irislib/%CSP/REST.cls:148-150` sets `%response.Domain` and calls `%response.MatchLanguage()` on every request.
  - The `Utils` prefix stripping is `src/ExecuteMCPv2/Utils.cls:212` `StripErrorPrefix`, which covers the instance's message languages (Story 41.8).
- DW-690:
  - `src/ExecuteMCPv2/Setup.cls:103-119` `Uninstall` deletes only the web application, and nothing on the IPM path calls it.
  - `ipm/module.xml:49-51` (generated, `gen-bootstrap.mjs:289-291`) has three invokes and no Unconfigure.
  - The manual cleanup runs in `%SYS` after `zpm "uninstall iris-execute-mcp-v2"`:
    - `Do ##class(Security.Applications).Delete("/api/executemcp/v2")` (`irissys/Security/Applications.cls:428`);
    - `Do ##class(Config.MapPackages).Delete("%ALL","ExecuteMCPv2")` (`irissys/Config/CommonMapMethods.cls:72`), only when no namespace still uses the suite.
  - The README section is at :341-356; the generated packaging README is `scripts/lib/release-core.mjs:679-696` `ipmReadme()`.

**Client adapters and certification (`packages/client-config/`)**
- `src/adapters.ts`:
  - `ADAPTER_DATA_VERSION` :19 is `"2026-07-28.1"`. Bump it to `"<implementation date>.1"`, for example `"2026-11-21.1"`.
  - `CLIENT_ADAPTERS` (13 entries). `CLIENT_DISPOSITIONS` :579-601 holds pi (`excluded-not-mcp-capable`), jetbrains-junie and kilo-code (both `roadmap`).
  - Siblings for new entries: `cursor` :116-154 (standard `mcpServers` JSON) and `kimi-code` :522-572 (`envOverride`, which Pi's `PI_CODING_AGENT_DIR` mirrors).
- DW-626 re-dispositions, from the current docs read 2026-11-21 (URLs under Design Notes):

| id | Change |
|---|---|
| `pi` | New adapter (Orchestrator decision 1): user `~/.pi/agent/mcp.json` (`envOverride` `PI_CODING_AGENT_DIR`), project `.pi/mcp.json`, `mcpServers`, JSON; docsUrl `https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/mcp.md`; remove from `CLIENT_DISPOSITIONS` |
| `jetbrains-junie` | New adapter, display "JetBrains Junie": user `~/.junie/mcp/mcp.json`, project `.junie/mcp/mcp.json`, `mcpServers`, JSON; docsUrl `https://junie.jetbrains.com/docs/junie-cli-mcp-configuration.html`; remove from dispositions |
| `kilo-code` | Stays `roadmap`; reason rewritten to the verified facts (deferred item) |
| `antigravity` | New `roadmap` disposition: "documents MCP at `~/.gemini/config/mcp_config.json` and `.agents/mcp_config.json`; detection would collide with Gemini CLI's `~/.gemini`; no Windows path documented" |
| `windsurf` | Display "Devin Desktop (formerly Windsurf)"; docsUrl `https://docs.devin.ai/desktop/devin-local/customizations`; path unchanged (deferred item) |
| `goose` | win32 path and appDir `%APPDATA%/Block/goose/config/config.yaml`; docsUrl `https://goose-docs.ai/docs/getting-started/using-extensions/` |
| `gemini` | docsUrl `https://geminicli.com/docs/tools/mcp-server/` |
| `kimi` | Display "Kimi CLI (archived)", notes point to `kimi-code`; adapter kept so existing entries can be found and removed |
| `roo-code` | Display "Roo Code (discontinued)"; docsUrl `https://roocodeinc.github.io/Roo-Code/features/mcp/overview/`; adapter kept |

- `src/pack-targets.ts`:
  - DW-629, the `why` texts: cursor :158-160 gains "Cursor reads `.agents/skills/` natively"; vscode :170-173 gains "Copilot's local sessions also read `.agents/skills/`".
  - The pi row :298-311 ("configures no MCP") is corrected.
  - An `antigravity` row on the `gemini` route is added: `.agents/skills/` plus `GEMINI.md`/`AGENTS.md`, verified. That takes the row count from 17 to 18 (`certification-process.test.ts:416+`).
- `src/paths.ts:115-126` (`resolveScopeTemplate` / `joinScope`), `src/engine.ts:130` `resolveTarget` (the write choke point), `src/cli/clients.ts`:
  - `:166` sets `projectDir` from `cwd`.
  - `:868` is `planApply`; its exit-2 usage error drops the reason under `--json`, so the guard must not raise there as a usage error.
  - `:1820-1865` is `cmdSkills`, with `SKILLS_USER_SCOPE_REFUSAL` and `--project`.
  - `:1230-1234` is the engine-refusal envelope.
  - `src/types.ts:153` `HostContext`: core never reads `os.homedir()`, so the CLI layer computes the comparison and passes it in.
- `doctor`, `src/cli/clients.ts:1360` `cmdDoctor` (checks listed at :1285; text output :1775-1806):
  - It reads Claude Code's user (`~/.claude.json` top-level `mcpServers`) and project (`<cwd>/.mcp.json`) scopes through `buildStatusMatrix`. It never reads the local scope in the `projects` map; state that limit in the docs.
  - Reuse `detectClaudeCodePlugin` (`src/claude-plugin-detect.ts:91`, whose only caller is `cmdSkills` :1869).
  - The installer's keys are `iris-*-mcp` (`types.ts:128-134`); the plugin's are `dev|admin|data|interop|ops`.
- `scripts/certify.mjs`:
  - The run command is at :27/:160-162.
  - It launches the local `dist/cli/clients-cli.js`. Only `HOME`/`USERPROFILE` are overridden (:188), so a scratch `HOME` isolates it.
  - The record is built at :517-525.
  - `VERIFIERS` :218-275 cover claude-code (`claude mcp list`), kimi-code (`~/.kimi-code/bin/kimi`), and vscode and cline (file-level).
- `scripts/certify-record.mjs:23-28` merges records and preserves the `note`/`sharing`/`ac3344` fields. Add `humanOnly`.
- `scripts/render-certification-table.mjs`:
  - It writes three marker pairs in `packages/client-config/README.md`: `ADAPTER-TABLE` (:277-297), `CERTIFICATION-TABLE` (:325-442) and `PACK-TARGETS-TABLE` (:141-163).
  - Its guards are at :64-74.
- `scripts/certification-results.json` (13 records, all 2026-07-28):
  - The kimi-code `ac3344` text at :175 must carry the new `ADAPTER_DATA_VERSION` (`certification-process.test.ts:764`).
- Tests:
  - `adapters.test.ts`, `paths.test.ts`, `clients-cli.test.ts`, `clients-cli-process.test.ts:699`, `certification-docs.test.ts:30-92`, `certification-process.test.ts`, `certify-record.test.ts`, `pack-targets.test.ts`, `skills-cli*.test.ts`, `qa-41-7-generated-table-gate.test.ts`, `golden.test.ts`.

**Cross-package doc tests (`packages/iris-mcp-all/src/__tests__/`, Rule #45)**
- `qa-41-7-doc-links.test.ts` (DW-632):
  - Today it checks 11 files: `CHANGED_DOCS` :26-39, `KNOWN_BROKEN` :45-47, `brokenLinks` :66-92.
  - Widen it to the inventory's 83-file set.
  - Slugs come from the shared `pack-fixture.ts:71-100` `markdownHeadingSlugs` (reuse it).
  - Guard `decodeURIComponent` (it throws on `%SY`).
- The broken links today:
  - the three DW-631 anchors;
  - `packages/shared/README.md:112` (it should be `#server-manager-connections-optional`);
  - `docs/known-bugs-2026-05-29-mapping-subscript.md:46-48` (`Config.cls#L…` line anchors into a non-md file);
  - `docs/known-bugs-2026-04-20.md:252, :255` (targets in the gitignored `irissys/`).
- The payload pins:
  - `story-40-4-doc-claims.test.ts:219-220` holds the exact "Last re-measured at Story 40.4" string and the dev row;
  - `story-39-1-doc-claims.test.ts:154`, `story-39-4-doc-claims.test.ts:149` and `story-39-5-doc-claims.test.ts:188` use `(39|40)` regexes;
  - `story-38-6:309` accepts any story;
  - `docs-visibility-roster-sync.test.ts` checks the counts.
  - The measurement script is `scripts/measure-tools-payload.mjs`. It needs the built dists of shared and the 5 servers, and no IRIS.
- Pattern for the caveat guard: `story-42-7-doc-claims.test.ts:145-146` (`not.toMatch(/not yet published/i)`).
- `npx-pin.test.ts` (`scripts/lib/npx-pin-scan.mjs`) already scans the doc set.

**Changelog and PRD**
- Root `CHANGELOG.md`:
  - `[1.0.0] — 2026-11-20` :57-95 says npm only, which is true.
  - The new section `## [Unreleased] — Story 42.9: Install Docs and Client Re-Certification` goes above 42.8's (:5).
  - Pins: `changelog-bootstrap-move.test.ts:32-33` (this story moves no marker), `docs-visibility-roster-sync.test.ts:305`.
- `.changeset/`: one is pending (42.8, client-config minor). Add `story-42-9-install-docs-and-client-re-certification.md`, `"@iris-mcp/client-config": minor`.
- `_bmad-output/planning-artifacts/prd.md`:
  - DW-655: `:44`, `:58`, `:86` and `:95` say 86 tools.
  - The real figures, from `fixtures/tools-list-snapshot.json` `entryCount` (`story-42-10-snapshot-ledger-parity.test.ts:147`): 110 package tools, plus `iris_server_profiles` on each of the 5 servers, makes 115 entries. The per-server counts are dev 33, admin 27, interop 25, ops 22 and data 8.
  - `### Installation & Distribution` :200-220. The counts at :203-207 and `npm install -g` at :212 diverge from what shipped. `@iris-mcp/client-config` is missing. The channels carry no "from 1.1.0". There are five registry listings, not one.
  - The epic headings (:348-389) and :46/:188/:224/:679 are history: keep them.

## Tasks & Acceptance

**Execution:**
1. `packages/client-config/src/paths.ts`, `src/engine.ts`, `src/types.ts`, `src/cli/clients.ts` -- the DW-702 home-directory guard per Boundaries:
   - The CLI layer computes `projectIsHome` with `fs.realpathSync.native` (falling back to `path.resolve` when a path does not exist) and a case-insensitive comparison on darwin and win32, then passes it through `HostContext`.
   - The engine's project-scope resolution for writes and `planApply`'s write path refuse with the operational form (exit 1, envelope `error`). `cmdSkills` refuses after `--project` resolution.
   - Reads stay unchanged. Probe first (Rule #14): record under `## Verification` what `realpathSync.native` returns on this Mac for a case-variant path.
   -- decision #100.
2. `packages/client-config/src/__tests__/` (new `home-guard.test.ts`, plus process rows in `clients-cli-process.test.ts` and `skills-cli-process.test.ts`) -- one row per matrix "Home guard" row, run with a temporary `HOME` and cwd. Every aliasing adapter (`cursor`, `codex`, `gemini`, `kimi-code`, `jetbrains-junie`) gets a row, and so do `vscode`, the subfolder case and the reads. Each row asserts that the bytes of the temporary home are unchanged -- DW-702.
3. `packages/client-config/src/cli/clients.ts` `cmdDoctor` plus `src/__tests__/clients-cli.test.ts` -- a new `claude-code-plugin-duplicates` check that reuses `detectClaudeCodePlugin` and the status matrix. Fixtures use the real `enabledPlugins` and `~/.claude.json` shapes (Rule #54). Rows: plugin on with a user entry, plugin on with a project entry, plugin off, and a local file that overrides to `false`. The help text and the README doctor section list the check -- DW-706.
4. `packages/client-config/src/adapters.ts`, `src/pack-targets.ts`, the regenerated README tables (`node packages/client-config/scripts/render-certification-table.mjs`), `src/__tests__/adapters.test.ts`, `pack-targets.test.ts`, `golden.test.ts` fixtures -- the DW-626 table and the DW-629 `why` texts. Bump `ADAPTER_DATA_VERSION`. The new adapters get detect, status and apply fixtures, including non-canonical ones: compact, CRLF, BOM, 4-space indentation. Add a test that pins the Goose win32 path -- DW-626, DW-629.
5. `packages/client-config/scripts/certify-record.mjs`, `certify-record.d.mts`, `render-certification-table.mjs`, `certification-results.json`, `src/__tests__/certification-*.test.ts`, `certify-record.test.ts`:
   - Add an optional `humanOnly: {check, markedOn}` field. It survives a merge, is rendered as in the matrix, and a malformed value makes the renderer exit 2.
   - Add a record for each new adapter (`fixture-only-with-residual-risk`, today's date).
   - Mark `humanOnly` on the rows the lead lists under Design Notes, dated the implementation date.
   - Update the `ac3344` text to the new `ADAPTER_DATA_VERSION`.
   - Leave every `certified-live` record untouched.
   - Add a `certify.mjs` `against` field: the harness resolves `npm view <entry spec> version` (a read) and records `@iris-mcp/dev@1 → <version>` in the record and the table. A failed lookup records `unresolved`.
   -- AC 42.9.2, DW-440, DW-442.
6. `extensions/iris-mcp-launcher/src/__tests__/clientsEngineRealCli.test.ts` -- extend this sibling, which already drives the built CLI through `resolveClientsCli` → `buildClientsCliEnv` → `runClientsCli` against a sandbox `HOME` (Rule 2):
   - Add the integration row: an `apply --scope project` for cursor with `cwd` equal to the sandbox `HOME`. Assert that the refusal reason, not "see stderr", reaches the typed wrapper's error string, and that the sandbox is byte-unchanged.
   - Update its `detect --json` `dispositions` pins: Pi is no longer `excluded-not-mcp-capable`, and the roadmap rows change. Search `clientsView`/`clientsPanel` tests for the same pins.
   - No extension source change -- Rule 1.
7. Root `README.md` -- the install rewrite per Boundaries:
   - Prerequisites: Node `>=22.17.0`; IRIS 2023.1+, best effort, tested 2026.1-2026.2.
   - Install per client: the plugin (from 1.1.0), its rule pointer and the DW-706 "remove old `iris-*-mcp` entries" step with the CLI and `claude mcp remove` commands; the extension (from 1.1.0); and the clients CLI `apply` for the rest, linked to `docs/client-config/`.
   - Verify, the IPM route (from 1.1.0) and its uninstall cleanup (DW-690).
   - Clone-and-build and the local entry-point table move to `## Contributing`.
   - Apply every caveat-inventory verdict; DW-664 :73; DW-633 :77.
   - Re-measure the payload table (`node scripts/measure-tools-payload.mjs` after rebuilding shared and the five servers), write "Last re-measured at Story 42.9", and state that the dev row is test-pinned (DW-661).
   - Move every pinned heading and sentence together with its test in task 10.
   -- AC 42.9.1, DW-661, DW-664, DW-633, DW-690, DW-706.
8. `docs/client-config/README.md`, `docs/client-config/{claude-code,claude-desktop,cursor}.md`, `packages/client-config/README.md`, `packages/iris-*-mcp/README.md`, `packages/iris-mcp-all/README.md`, `packages/shared/README.md`, `extensions/iris-mcp-launcher/README.md`:
   - Apply the inventory verdicts. The client index gains the new adapters and the renamed and discontinued rows.
   - Fix the DW-631 anchors, and add a `skills install` pointer to each page.
   - DW-664 rows; the `packages/shared/README.md:112` anchor.
   - Document the doctor check and the home guard in the client-config README.
   -- AC 42.9.1, DW-631, DW-632, DW-664.
9. `tool_support.md:21`, `packages/shared/src/http-client.ts:203-213` (a comment only; rebuild shared), `docs/known-bugs-2026-05-29-mapping-subscript.md:46-48`, `docs/known-bugs-2026-04-20.md:252, :255` -- DW-633 against the per-request model, after re-reading `irislib/%CSP/REST.cls` and `Utils.cls:212` (Rule #16). The known-bugs links become plain code text or repository URLs -- DW-633, DW-632.
10. `packages/iris-mcp-all/src/__tests__/`:
    - `qa-41-7-doc-links.test.ts`: widen it to `git ls-files '*.md'` minus the inventory's excluded roots, delete `KNOWN_BROKEN`, and make decoding safe.
    - New `story-42-9-doc-claims.test.ts`:
      - no "not yet published" / "until … published" / "Once published" / "Pre-release:" wording, and no `node …/dist/` launch outside `## Contributing` and the extension's development sections, over the same doc set, with history files allowlisted by name and reason;
      - the plugin and extension "from 1.1.0" lines;
      - the IRIS claim and the tested range, equal to the `scripts/throwaway-iris.mjs` image tags;
      - "Last re-measured at Story 42.9" and the measured dev row;
      - the DW-706 removal step;
      - `IRIS_USERNAME` required in all 10 rows;
      - the DW-690 cleanup commands.
    - Move or relax the existing pins: `story-40-4` (the payload pins move to 42.9), `story-39-1/4/5` (accept any story at or after their own, numerically), `story-42-4:91` (1.1.0), `meta-package-docs`, `story-42-8-doc-claims`, `certification-docs.test.ts:86-92` (now asserts the caveat is absent).
    -- AC 42.9.1, DW-632, DW-661.
11. Root `CHANGELOG.md`, `.changeset/story-42-9-install-docs-and-client-re-certification.md`, `_bmad-output/planning-artifacts/prd.md`:
    - Check the `[1.0.0]` section against the shipped facts (8 packages, npm only, Node floor, SDK pin `2.4.0`, `BOOTSTRAP_VERSION` move) and correct any mismatch.
    - Add the 42.9 `[Unreleased]` section, user-facing, naming the guard, the doctor check and the adapter changes.
    - PRD: DW-655 (:44, :58, :86, :95 → 110 tools, plus `iris_server_profiles` on each server) and rewrite `### Installation & Distribution` :200-220 to the shipped channels, names, versions and counts.
    -- AC 42.9.3, DW-655.

**Acceptance Criteria:**
- **Install docs (AC 42.9.1).**
  - Given the story tree, when a reader follows the root README's install section, then each client has exactly one path: the plugin for Claude Code, the extension for VS Code, and `npx -y -p @iris-mcp/client-config@1 iris-mcp-clients apply` for the rest. The plugin and extension paths say "from 1.1.0", and the CLI is named as the 1.0.x route.
  - Given the inventory's doc set, when `story-42-9-doc-claims.test.ts` runs, then no publication or clone-and-build caveat remains outside the allowlisted history and contributor sections.
  - Given the same set, when the widened link test runs, then no relative link or anchor is broken.
- **Re-certification (AC 42.9.2), implement scope.** Given the regenerated `packages/client-config/README.md`, when `render-certification-table.mjs --check` runs, then:
  - there is one record per adapter (15);
  - the adapter table reads the new `ADAPTER_DATA_VERSION`;
  - every row listed as human-only under Design Notes shows `human-only (marked <date>): <check>`;
  - every `certified-live` record is byte-identical to the baseline.
- **Re-certification (AC 42.9.2), lead scope, after npm `1.0.0` is live.** Given a harness throwaway IRIS and a scratch `HOME`, when the lead runs `certify.mjs run` for claude-code, vscode and cline with `--server iris-dev-mcp`, then each record is `certified-live`, dated that day, with `against` naming the published version, and the regenerated table is committed. The story closes on these rows and the recorded human-only rows.
- **Release notes and PRD (AC 42.9.3).** Given `CHANGELOG.md` and `prd.md`, when they are compared with the shipped facts listed in task 11, then every count, channel, name and version agrees, and the tool counts equal the snapshot's `entryCount` breakdown.
- **The guard (DW-702).** Given each "Home guard" matrix input, when the real built CLI runs it, then the outcome is that row's expected one. Given the same alias input through the launcher's real-CLI wrappers, when it runs, then the view's error string carries the refusal reason verbatim.
- **Doctor (DW-706).** Given each "Doctor" matrix input in a sandbox `HOME`, when `iris-mcp-clients doctor` runs, then the finding appears exactly as that row says, or does not appear.

### Review Findings

Code review 2026-11-21 (frozen diff `915703e..edf7450`, 42.9 files only): 0 high, 8 medium, 26 low; every medium patched. The findings, dispositions and fix-risk are in `## Review` at the end of this file.

## Spec Change Log

- **2026-11-21, decision #123 (owner ruling relayed by the Planner), added during implement; binding.** The install docs lead with the automatic install of the server-side classes (bootstrap deploys and upgrades them on first connect) and present IPM only as the fallback where that cannot run. The cases are those the code shows (`packages/shared/src/bootstrap.ts`: `Deploy failed` / `Compile failed` errors; the web application needs `%Admin_Manage`, reported as `configured: false` with manual instructions), plus a change-control policy that forbids client deployment. The consequence is stated (decision #67, AD-14 Ownership): with `ExecuteMCPv2.InstallGuard` present bootstrap writes nothing, so upgrades also go through `zpm`; `zpm "uninstall iris-execute-mcp-v2"` plus a server restart hands the namespace back (the bootstrap warning says the same). The docs do not describe how IPM reaches the registry (decision #122). Pinned by `story-42-9-doc-claims.test.ts` ("the automatic install leads and IPM is the fallback"); `mutation: the "Skip this section unless the automatic install cannot run." sentence replaced by "Optional." in README.md -> the "IPM section is the fallback" test red, README restored byte-identically`. Not changed: `ipmReadme()` in `scripts/lib/release-core.mjs` (42.8 code; decision #122 redesigns that route).

## Review Triage Log

### 2026-11-21 — Review pass
- verdicts: 41 findings — high 0, medium 2, low 35, false 4, maybe-false 0 (18 patched: 2 medium, 16 low; 23 rejected: 4 false, 19 low; none deferred)
- findings:
  - Blind Hunter
    - `[low]` `patch` IRIS for Health range overstated (CI tests Health on 2026.2 only) — README now reads "IRIS Community 2026.1 to 2026.2 and IRIS for Health 2026.2", and the doc-claims row derives each product's tag from `scripts/throwaway-iris.mjs`.
    - `[low]` `patch` Payload prose says only the dev row is test-pinned, the test pinned all five — the test now pins the dev row only (the spec's pin), so another server's description change cannot break it.
    - `[low]` `patch` Caveat guard header claims "after publish" wording that the regex does not match — the header is corrected; the stale "after the first npm publish" text lives in dated certification records that the lead's re-run replaces (reject for that part: generated from `certification-results.json`, not worth a hand edit).
    - `[false]` `reject` "Client re-certification produced no new live evidence" — the live re-run is the lead's step after npm 1.0.0 (spec AC 42.9.2 lead scope); implement scope forbids fabricating `certified-live` rows.
    - `[low]` `reject` `goose|pi|junie mcp list` check commands may not exist — the spec's Design Notes give them as "`<cli> mcp list` (or the client's equivalent)"; they are check prompts for a person, and Pi's reversal is sourced in the spec (decision #112). reopen_if: a person finds the subcommand absent.
    - `[low]` `reject` Pi evidence inconsistent between docs.pi.dev and the GitHub docs URL — both are cited by the spec; implement re-read them on 2026-11-21 and found no difference (Verification, adapter paths).
    - `[low]` `reject` Windsurf `restartHint` still says "Restart Windsurf" — the spec changes display name and docs URL only; a hint change moves goldens for no behavioral effect.
    - `[low]` `reject` The home guard blocks `remove`/`restore`/`diff` from the home directory — spec-bound: decision #115 refuses every project-scope write and `diff`; user scope remains available. by-design.
    - `[low]` `reject` The guard is opt-in for library callers (`projectIsHome` set at the CLI boundary) — spec-bound (core never reads `os.homedir()`, `HostContext`); every shipped surface goes through the CLI. by-design.
    - `[low]` `reject` Governance-CLI doc pin echoes a literal — a test-hardening wish with no user-reachable failure; not worth the fix.
    - `[low]` `patch` `doc-set.ts` depends on untracked files and the working tree — it now lists tracked files only (the spec's `git ls-files '*.md'`) and drops entries that no longer exist.
    - `[low]` `patch` `formatAgainst` takes the last array element, not the highest semver — now sorted by semver; a row with 1.1.0 listed before 1.0.9 and 1.0.10 pins it.
    - `[false]` `reject` PRD "half updated": the 86-tool lines :194 and the scope table :884 are planning-time history the spec tells us to keep (:46/:188/:224/:679 and the epic headings); the four listed lines are updated.
    - `[low]` `reject` Windows `npx` needs `cmd /c` — unverified for the clients named, and the installer's own entry shape is unchanged by this story; reopen_if: a Windows client fails to launch a documented `npx` entry.
    - `[low]` `patch` The VS Code extension paragraph still sends Claude Code users to the Server Manager credential path — now points to the plugin or `iris-mcp-clients` and the step 2 options.
    - `[low]` `patch` Pack-target and renderer row-count comments double-count — both now read 15 adapters, 2 dispositions (`kilo-code`, `antigravity`) and `agents`.
  - Edge Case Hunter
    - `[medium]` `patch` Doctor prints a `remove --scope project` command the home guard refuses when run from the home directory — the finding now says to delete the entry from the file by hand in that case, with a row.
    - `[low]` `patch` `cmdSkills` carries a stale `projectIsHome` in the context for a `--project` elsewhere — it is set to false there (the home case returned earlier).
    - `[false]` `reject` Doctor falls back to the home directory when `deps.projectDir` is undefined — the CLI always sets `projectDir` from cwd (`clients.ts` deps resolution); no real input reaches it.
    - `[low]` `reject` `humanOnly.check` with a newline or `**` breaks the table — the data is the project's own JSON, and a guard adds a branch for an input nobody writes. reopen_if: a record is authored by a tool.
    - `[low]` `reject` Case fold wrong on a case-sensitive APFS volume — spec-bound (decision #100 compares case-insensitively on darwin and win32); `realpath` already normalizes real directories. by-design.
    - `[low]` `patch` A tracked file deleted in the tree breaks the doc scan — closed by the `doc-set.ts` change above.
    - `[low]` `patch` The spec says certified-live records are byte-identical, the diff adds `humanOnly` to three and rewrites the kimi-code `ac3344` — the AC is read as "evidence untouched", pinned by a baseline digest test (records that gain `against` leave it) and the comparison is recorded under Verification.
    - `[low]` `reject` Goose's old Windows path is no longer detected — that path is the defect (Goose does not read it), so entries there were never live. by-design.
  - Verification Gap
    - `[low]` `patch` The cwd-symlink and case rows cannot fail on the property they name — the titles now say what each proves; the HOME-symlink row pins realpath and the pure rows pin the case fold.
    - `[low]` `patch` Missing `mutation:` lines for the skills guard, the launcher row, the doctor negative rows, malformed `humanOnly`, the Pi and antigravity data, `samePath`, the doc pins — each mutation was applied, observed red and reverted; the lines are under Verification.
    - `[low]` `reject` `certify.mjs` `against` wiring is pinned by a source scan only — the harness acts on import; extracting it is more than a 15-line fix. reopen_if: the lead's post-publish run records a wrong or `unresolved` `against`.
    - `[medium]` `patch` No test pins "certified-live records unchanged" — added `BASELINE_CERTIFIED_LIVE_DIGESTS` in `certification-docs.test.ts`, with a mutation line.
    - `[low]` `patch` Doc-set tests depend on state they did not create — closed by the `doc-set.ts` change above.
    - `[low]` `patch` The "compact" fixture is not minified — a fully minified document and an empty object were added for both adapters (the engine preserved both).
    - `[low]` `patch` Doctor's local-scope limit has no test — a row with the entry in the `projects` map asserts no finding.
    - `[low]` `reject` The caveat regex misses "(pre-release)" notes and a caveat wrapped over two lines — the "(pre-release)" notes are dated schema history the inventory keeps; a squashed scan found no wrapped caveat. reopen_if: a wrapped caveat appears.
    - `[low]` `reject` `samePath` case fold is unreachable for existing directories — spec-bound (decision #100); harmless there and the pure row pins it. by-design.
    - `[low]` `reject` Process tests spawn the dist with no freshness check — the spec's loop rebuilds first (`checkDistFresh` is the project's gate for live suites).
  - Intent Alignment
    - `[low]` `reject` Tests exercise the workspace build, not the published `@1` artifact — the published run is the lead's step after the release; by design of the story split.
    - `[low]` `reject` The guard sits at the CLI boundary — same row as the library-caller finding above. by-design.
    - `[low]` `reject` The doctor check is reactive (a user must run `doctor`) — the spec's decision #114 is exactly that check plus the docs step.
    - `[false]` `reject` README keeps the `zpm "repo -r -n registry -reset-defaults"` sentence against decision #123(4) — that is the user's registry setup, not how the package reaches the registry; the story-42-4 pin requires it.
    - `[low]` `patch` The VS Code paragraph and the Claude Code route disagree — same patch as the Blind Hunter row.
    - `[low]` `reject` `humanOnly` markers read like verified — the rendered text is "human-only (marked <date>): <check>", and the row's disposition stays `fixture-only-with-residual-risk`.
    - `[low]` `reject` The node-launch exemption and the exact-string PRD assertions — spec-listed sections; the `>= 83` floor is the spec's inventory.

## Design Notes

**Governing ADs and conventions (Rule 6):**
- **AD-28:** Duplicates (the plugin versus the installer's entries, DW-706); names and endorsement (no new name implies endorsement); the plugin cannot carry rules (the README rule pointer).
- **AD-29:**
  - Pins: every documented `npx` carries `@1`.
  - Versions and channels: the extension and plugin first ship in `v1.1.0` (decision #95), and IPM and the MCP Registry also start at 1.1.0.
  - Node floor `>=22.17.0`.
- **AD-30:** client-config writes only what it owns. The home guard is a refusal before step 1 of the write protocol, and the new adapters keep foreign content byte for byte (Rule #58 fixtures).
- **AD-2:** the cross-package doc tests live in `iris-mcp-all`.
- **Conventions and Stack:**
  - Conventions: error text; configuration variables documented with their defaults (DW-664: `IRIS_USERNAME` has none); live testing on a shared instance (re-certification only against a harness throwaway).
  - Stack: the IRIS CI images (the tested floor 2026.1), the IRIS support claim 2023.1 best effort, Node.

**Why this shape:**
- **Docs for the `v1.1.0` state.** "From 1.1.0" is a permanent, accurate floor, not a "not yet published" caveat, and it honors DW-707: until then `main`'s marketplace pins `v1.0.0`, whose pack has no plugin.
- **The guard sits in the CLI and engine, not in the extension.** Decision #100 calls it a general client-config guard, so CLI users running in `~` are covered too. `planApply`'s usage-error path would hide the reason under `--json`, and the MCP Clients view needs it.
- **`humanOnly` is a field, not a new disposition.** A row's scripted half can be `certified-live` while its GUI half needs a person (vscode, cline, kimi-code). The field keeps both on the row, with the date.
- **Re-certification happens after publishing.** `certify.mjs` writes the pinned `npx -y @iris-mcp/dev@1` entry, and `claude mcp list` launches it. That proves the published package only once npm serves it.
- **Siblings (Rule 2):**
  - the doctor check reuses `detectClaudeCodePlugin` and `buildStatusMatrix`;
  - the guard follows the engine refusal envelope (`clients.ts:1230-1234`) and `SKILLS_USER_SCOPE_REFUSAL`;
  - the new adapters copy `cursor`'s data shape and `kimi-code`'s `envOverride`;
  - the caveat guard extends `story-42-7-doc-claims.test.ts:145`;
  - the link widening extends `qa-41-7-doc-links.test.ts` and reuses `pack-fixture.ts` slugs.

**Integration ACs (Rule 1):**
- The launcher's MCP Clients view (`clientsEngine.ts:583-603` `mapJsonResult`) reads the CLI's refusal envelope and shows the reason (task 6).
- The `doctor` user is the consumer of the new check (task 3).
- The lead's certify run consumes `humanOnly` and `against` (task 5).

**Consumes:**
- 42.8: `detectClaudeCodePlugin`, the plugin and its commands.
- 42.7: the extension's cwd fallback (decision #98), store ids.
- 42.6: the 1.0.0 facts.
- 41.6/41.7: the installer, `PACK_TARGETS`, the doc-link checker.
- 40.4: the payload measure.
- 33.4: the certify scripts.

**Consumed-by:** none in this epic. 1.1.0 ships these docs and checks. The epic burn-down story, if one is chartered, reads the `deferred:` items.

**Ledger inbox (Rule 17):**
- DW-440: task 5 (the kimi-code `humanOnly` row) and the lead rows.
- DW-441: AC 42.9.2 and the lead re-certification.
- DW-442: task 5 (the vscode `humanOnly` row) and the lead rows.
- DW-626: task 4 and the adapter table.
- DW-629: task 4.
- DW-631: task 8.
- DW-632: tasks 9 and 10.
- DW-633: tasks 7 and 9.
- DW-655: task 11.
- DW-661: tasks 7 and 10.
- DW-664: tasks 7 and 8.
- DW-690: task 7 (docs). Declined in part: wiring an Unconfigure invoke to `Setup.Uninstall` is not cheap:
  - `irislib/` has no IPM lifecycle class to verify an Unconfigure phase against;
  - it would touch the generator, the invoke-order pins (`ipm-manifest.test.ts:55-64`, `ipm-archive.mjs:319-338`) and CI's `ipm` job;
  - `Uninstall` would also have to remove the `%ALL` mapping, which edits a bootstrapped class and moves `BOOTSTRAP_VERSION`.
- DW-702: tasks 1, 2 and 6.
- DW-706: tasks 3 and 7.

**Decided at the spec gate (2026-11-21).** These are wave-8 orchestrator decisions #112 to #119. They follow the plan's recommendations 1 to 7 in order, plus the DW-690 decline, and are BINDING on the implement stage:
- #112: the DW-626 re-dispositions as tabled. Promoted rows (Pi, Junie) are fixture-certified and carry a human-only row until a person confirms them.
- #113: `humanOnly {check, markedOn}` plus `against` on the certification record.
- #114: the `doctor` finding `claude-code-plugin-duplicates` (DW-706), plus the install-docs instruction to remove old entries when switching to the plugin.
- #115: the DW-702 refusal covers every project-scope write, `diff`, and `skills install|uninstall`; realpath with case folding on darwin and win32; reads unaffected.
- #116: the Planner is advised to merge `epic42` to `main` only after npm `1.0.0` is live. No doc tells anyone to install the plugin, the extension, IPM or a registry listing before 1.1.0 (DW-707).
- #117: this story corrects `[1.0.0]` and adds its own unreleased section; the lead writes `[1.1.0]` at the version step.
- #118: the VS Code native MCP file deprecation is a `deferred:` item for the burn-down decision sheet; no change in 1.1.0.
- #119: DW-690 is docs only (the manual cleanup); no Unconfigure invoke.

The lead wrote the four spine drafts below into the spine: AD-28 Duplicates, AD-29 Versions, AD-30 (the home-directory refusal) and the Stack IRIS CI images row. `lint_spine.py` reports 0 findings.

The human-only rows go to the Planner after npm 1.0.0 is live (and after `v1.1.0` for the rows that install the extension). They block only the lead's post-publish phase, never the implement or QA stages.

The implement stage never pushes, tags, publishes or logs in, never installs a client, runs no docker outside the harness, never touches `~/.claude` or any real client config (scratch `HOME` and `CLAUDE_CONFIG_DIR` only), and never kills processes by pattern.

**Orchestrator decisions needed (planned around the recommendation):**
1. **Orchestrator decision needed: DW-626 re-dispositions — recommended: the adapter table in the Code Map** (promote Pi and Junie; Kilo and Antigravity stay roadmap rows; rename Windsurf, keeping its path; fix Goose's win32 path and documentation link; mark Kimi CLI and Roo Code archived or discontinued but keep their adapters).
   - Why:
     - Pi and Junie document standard `mcpServers` JSON at fixed paths, which is data the engine already supports.
     - Kilo needs a new entry shape (engine code).
     - Antigravity's detection collides with Gemini's.
     - Keeping the legacy Windsurf file keeps earlier installs findable, and Devin imports it by default.
     - Goose's win32 path is a real bug: the adapter writes a file Goose does not read.
   - Alternative: keep Pi and Junie as roadmap rows with corrected reasons (data only).
2. **Orchestrator decision needed: how human-only rows are marked (AC 42.9.2) — recommended: an optional `humanOnly {check, markedOn}` on the certification record, rendered in the table,** because a client's scripted and GUI halves differ.
   - Alternative: a fourth disposition `human-only`, which loses the scripted half.
3. **Orchestrator decision needed: DW-706 `doctor` — recommended: yes, a `claude-code-plugin-duplicates` finding (exit 1) over the user and project scopes, with the local scope documented as unread.**
   - The real input (Rule #54) is the `enabledPlugins` key written by `/plugin install` together with entries written by `apply` or `claude mcp add`.
   - Alternative: docs only.
4. **Orchestrator decision needed: the DW-702 guard's reach — recommended:**
   - every project-scope write and `diff`, plus `skills install|uninstall`;
   - not reads;
   - `realpath` plus case folding on darwin and win32;
   - because `skills install` in `~` writes Claude Code's user-level `~/.claude/skills`, which is exactly what `SKILLS_USER_SCOPE_REFUSAL` exists to prevent, and a `vscode` project write in `~` lands in VS Code's extensions root.
5. **Orchestrator decision needed: the epic-end merge timing — recommended: the Planner merges `epic42` to `main` only after npm `1.0.0` is live (42.6 B7),** because these docs make every install command an `npx … @1`, which returns 404 until then.
   - "From 1.1.0" covers the plugin and the extension.
6. **Orchestrator decision needed: the 1.1.0 release notes — recommended: this story corrects `[1.0.0]` and adds its own `[Unreleased] — Story 42.9` section, and the lead writes the consolidated user-facing `[1.1.0]` section at the version step** (`release-version.mjs` already prints that as a next step). The 42.8 review's `reopen_if` on the story and ledger ids in the CHANGELOG is satisfied there.
7. **Orchestrator decision needed: the VS Code native MCP destinations (deprecation in February 2027) — recommended: no change in 1.1.0; route the `deferred:` item to a story before February 2027,** because migrating changes the extension's and the CLI's write targets.

**Spine amendment drafts for the lead (Rule 20):**
- **AD-30 Rule, append:** "**Project scope is never the home directory.** A project-scope write (MCP entries, `diff` included, and the skills installer) whose project directory resolves (realpath; case-insensitive on darwin and win32) to the home directory is refused before the write protocol starts, naming the client's project and user paths, with exit 1 and the reason in the JSON envelope; reads are unaffected (Story 42.9, decision #100)."
- **AD-28 Duplicates, append:** "`iris-mcp-clients doctor` reports each `iris-*-mcp` entry in Claude Code's user or project scope while the plugin is enabled (Story 42.9, DW-706)."
- **Stack, IRIS CI images row:** replace "The oldest green tag is the tested floor that Story 42.9 states" with "The README states the tested range 2026.1 to 2026.2 (Story 42.9)."
- **AD-29 Versions, append:** "The install docs give one path per client (the plugin, the extension, the clients CLI); the plugin, the extension, IPM and the MCP Registry are documented from 1.1.0 (Story 42.9)."

**Planning-artifact edit:** task 11 edits `prd.md`, so the lead re-runs the epic-context pre-warm before any later plan spawn.

**Re-certification rows: who runs what (lead raises the human-only rows with the Planner):**
- **Lead, after npm `1.0.0` is live (42.6 B7)**, against a harness throwaway IRIS for Health. Never the shared instance, whose marker `0.0.2+2.244fe8623c76` would make a 1.x server redeploy there.
  1. Start it with `node scripts/throwaway-iris.mjs up --image <IRISHEALTH_COMMUNITY_IMAGE> --namespace HSCUSTOM --host-port 52792 --state <f>`.
  2. Export `IRIS_HOST=localhost`, `IRIS_PORT=52792`, `IRIS_NAMESPACE=HSCUSTOM`, `IRIS_USERNAME` and `IRIS_PASSWORD` set to the throwaway's, and `HOME=<scratch>` and `CLAUDE_CONFIG_DIR=<scratch>/.claude`.
  3. Rebuild client-config, then run, each with `--real-config --server iris-dev-mcp` (the scratch `HOME` is the "real" config here):
     - `node packages/client-config/scripts/certify.mjs run claude-code` (the agent CLI probe `claude mcp list`; if `claude` refuses under a scratch config, the row becomes human-only with the date);
     - `… run vscode` (file-level);
     - `… run cline` (file-level).
  4. Confirm each record's `against` reads `@iris-mcp/dev@1 → 1.0.0` (or 1.1.0 after that release).
  5. Run `render-certification-table.mjs`, then tear down the throwaway, remove the scratch directory, and commit `certification-results.json` and the README.
- **Human-only:** a person on their own machine, with the client installed, after the publish. Each person records the client version, the date, and pass or fail with a screenshot or the CLI output; the lead writes the record.
  - **VS Code Copilot Chat (DW-442):**
    1. Install the extension from the Marketplace (from 1.1.0), or `apply --client vscode`.
    2. In Copilot agent mode, the `iris_*` tools are listed and one read call (for example `iris_server_info`) succeeds.
    3. The same person can also do action item `epic-43-decision-sheet-item-1-vs-code-copilot-confirmation-dialog-run`.
  - **Kimi Code VS Code extension (DW-440):** the extension (`moonshot-ai.kimi-code`) lists the server from `~/.kimi-code/mcp.json`. The person exports `IRIS_PASSWORD`, because kimi-code does no env expansion. The Kimi Code CLI half needs `~/.kimi-code/bin/kimi`, which the scratch-`HOME` harness cannot reach, so it is human-only too.
  - **Cline:** the Cline panel shows `iris-dev-mcp` with its tools.
  - **Claude Desktop:** after `apply --client claude-desktop` and a restart, the tools menu lists the server, and one read call succeeds.
  - **Cursor:** Settings → MCP shows the server green with its tools.
  - **Devin Desktop (formerly Windsurf):** Devin Local shows the server from the legacy file. This also confirms the import.
  - **Zed:** the agent panel shows the context server as active.
  - **Codex CLI, Gemini CLI, Goose, Pi, Junie:** `<cli> mcp list` (or the client's equivalent) shows `iris-dev-mcp`. Installing any client on the lead's machine needs the Project Lead's approval (Story 33.4), so these stay `fixture-only-with-residual-risk` and are marked human-only.
  - **Kimi CLI (archived) and Roo Code (discontinued):** not re-certified. Their notes say so.
- **Not this story's rows:** the store installs (AC 42.7.3) and the plugin marketplace install (AC 42.8.4, 42.8 lead C1) close their own stories.

**What waits on a publish:**
- Nothing in implement or QA.
- **After npm 1.0.0 is live:** the lead's three certify runs and their regeneration.
- **After `v1.1.0`:** the human rows that install the extension. The docs' "from 1.1.0" lines become true.
- The story stays `in-progress` until the lead's rows are recorded, as 42.6 to 42.8 did.

**AC reinterpretations:**
1. **AC 42.9.2 "with the existing certify scripts":** the scripts are extended with an `against` field and `humanOnly`, not replaced. Clients without a verifier stay `fixture-only-with-residual-risk`, re-reviewed against the new adapter data.
2. **AC 42.9.1 "Every … caveat … removed":** "from 1.1.0" version floors and contributor build docs are kept, each with a verdict in the inventory.
3. **AC 42.9.3 "CHANGELOG `1.0.0` release notes":** this means the `[1.0.0]` section as it stands on `main` at `55ae0eb`, corrected where it diverges. The consolidated 1.1.0 notes belong to the version step (decision 6).

## Verification

**How to run:**
- Run from `/Users/jbrandt/git/iris-execute-mcp-v2`, one command per foreground call, with `timeout: 600000`. No IRIS calls. No real `HOME`: process tests set a temporary `HOME`, `USERPROFILE` and `CLAUDE_CONFIG_DIR`.
- `UNARMED` is `env -u IRIS_HOST -u IRIS_PORT -u IRIS_USERNAME -u IRIS_PASSWORD -u IRIS_NAMESPACE -u IRIS_REQUIRE_LIVE -u IRIS_THROWAWAY -u CLAUDE_CONFIG_DIR -u KIMI_CODE_HOME -u PI_CODING_AGENT_DIR CI=true`.

**Commands:**
- `pnpm --filter @iris-mcp/client-config build` (loop) -- expected: exit 0.
- `UNARMED pnpm --filter @iris-mcp/client-config exec vitest run src/__tests__/home-guard.test.ts src/__tests__/adapters.test.ts src/__tests__/pack-targets.test.ts src/__tests__/certification-docs.test.ts src/__tests__/certification-process.test.ts src/__tests__/certify-record.test.ts src/__tests__/clients-cli.test.ts` (loop) -- expected: all pass.
- `node packages/client-config/scripts/render-certification-table.mjs --check` (loop) -- expected: exit 0.
- `UNARMED pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-42-9-doc-claims.test.ts src/__tests__/qa-41-7-doc-links.test.ts src/__tests__/npx-pin.test.ts` (loop) -- expected: all pass.
- `cd /Users/jbrandt/git/iris-execute-mcp-v2/extensions/iris-mcp-launcher && UNARMED npx --no -- vitest run src/__tests__/clientsEngineRealCli.test.ts` (loop) -- expected: pass, not skipped. It needs the client-config dist, and the launcher is outside the pnpm workspace.
- `pnpm --filter @iris-mcp/shared build`, then build each of the five servers, one command per package (once) -- before `node scripts/measure-tools-payload.mjs` (once); the printed rows go into the README verbatim.
- `UNARMED pnpm --filter @iris-mcp/client-config test` (once); `UNARMED pnpm --filter @iris-mcp/all test` (once); `UNARMED pnpm --filter @iris-mcp/shared test` (once); in `extensions/iris-mcp-launcher`, `UNARMED npx --no -- vitest run` (once) -- expected: green. Only the existing unarmed live files may skip.
- `pnpm gen:pack:check`, `pnpm check:provenance`, `pnpm gen:listings:check`, `pnpm gen:governance-baseline:check`, `pnpm validate:prompts` (once, each its own call) -- expected: exit 0, and the baseline is unchanged.
- `pnpm --filter @iris-mcp/client-config lint`, `pnpm --filter @iris-mcp/client-config type-check`, and in `extensions/iris-mcp-launcher` `npm run type-check` (once) -- expected: clean.

**Shared surfaces:**
- `CLIENT_ADAPTERS` (13 → 15) and `CLIENT_DISPOSITIONS`;
- `ADAPTER_DATA_VERSION`;
- `PACK_TARGETS` (17 → 18);
- `certification-results.json` (one record per adapter);
- the three generated README tables;
- the doctor check list and help text;
- the doc-claims pins named in task 10;
- the `qa-41-7` doc set;
- the README payload table;
- `docs/client-config/README.md`'s client index;
- the launcher's `detect --json` `dispositions` pins (`clientsEngineRealCli.test.ts`, view and panel tests);
- `CHANGELOG.md` sections.

Search the test trees of client-config, iris-mcp-all and the launcher for each of these and update every assertion of the old shape. Every test added or changed passes on a fresh environment, in either order.

**Mutation evidence (Rule 19; the implement or QA stage writes each line as `mutation: <change> → <test red>`):**
- remove the guard call → the `home-guard.test.ts` alias rows;
- drop the realpath → the symlink row;
- delete the doctor check → its `clients-cli.test.ts` rows;
- revert the Goose win32 path → `adapters.test.ts`;
- drop the `humanOnly` render → `certification-docs.test.ts`;
- re-add "Not yet published to npm" to `docs/client-config/README.md` → `story-42-9-doc-claims.test.ts`;
- break an anchor in `packages/shared/README.md` → the widened `qa-41-7-doc-links.test.ts`;
- change one payload byte → `story-42-9-doc-claims.test.ts`.

**Manual checks:**
- `realpathSync.native` probe result (task 1).
- The new adapters' paths re-read against the cited docs on the implementation date. A difference stops the stage and is reported.

**Implement results (2026-11-21, macOS, Node 26.8.1):**
- `realpathSync.native` probe (Rule #14, task 1), on a temp directory `<tmp>/Home` that holds the real on-disk case: `native("<tmp>/Home")`, `native("<tmp>/home")` and `native("<tmp>/HOME")` all return `<tmp>/Home` (the on-disk case, on case-insensitive APFS); a symbolic link to `Home` returns `<tmp>/Home`; `native("/tmp/")` returns `/private/tmp`; a missing path throws `ENOENT` (so the guard falls back to `path.resolve` and the case-insensitive comparison). A second finding from the real-CLI integration row: on macOS a child process's `process.cwd()` is the physical path (`/private/var/...`) while `HOME` may carry the symlinked form (`/var/...`), so the refusal text names the project directory and the project file the way the user's own `HOME` writes them.
- Adapter paths re-read on 2026-11-21: Pi (`raw.githubusercontent.com/earendil-works/pi/.../docs/mcp.md`: `~/.pi/agent/mcp.json`, `.pi/mcp.json`, `mcpServers`; `PI_CODING_AGENT_DIR` is on `docs.pi.dev/latest/environment-variables`, not on the mcp page), Junie (`junie.jetbrains.com/docs/junie-cli-mcp-configuration.html`: `~/.junie/mcp/mcp.json`, `.junie/mcp/mcp.json`, no Windows path), Goose (`goose-docs.ai/docs/guides/config-files`: `%APPDATA%\Block\goose\config\config.yaml`) and the Antigravity row (`antigravity.google/docs/customization-discovery/`: `.agents/`, `AGENTS.md`, `GEMINI.md`). No difference from the spec. The Windsurf, Gemini, Roo Code and Kilo Code facts are the spec's own 2026-11-21 reads, not re-fetched.
- Measured payload (`node scripts/measure-tools-payload.mjs` on freshly built shared and five server dists; full / core / developer, count / bytes / ~tokens): dev `33 / 98,907 / ~24,727`, `15 / 45,835 / ~11,459`, `33 / 98,907 / ~24,727`; admin `27 / 48,808 / ~12,202`, `13 / 16,862 / ~4,216`, `11 / 16,222 / ~4,056`; interop `25 / 58,297 / ~14,574`, `12 / 39,355 / ~9,839`, `25 / 58,297 / ~14,574`; ops `22 / 30,811 / ~7,703`, `10 / 13,813 / ~3,453`, `10 / 14,264 / ~3,566`; data `8 / 12,643 / ~3,161` in all three.
- Commands: client-config build and `render-certification-table.mjs --check` OK; `UNARMED pnpm --filter @iris-mcp/client-config test` 42 files, 1,177 tests green; `UNARMED pnpm --filter @iris-mcp/all test` 220 files, 5,891 passed, 727 skipped (the unarmed live legs; the count equals the baseline run), 0 failed; `UNARMED pnpm --filter @iris-mcp/shared test` 86 files, 2,575 green; launcher `UNARMED npx --no -- vitest run` 32 files, 458 passed, 3 skipped (the existing unarmed live files); `clientsEngineRealCli.test.ts` 6 passed, none skipped; `pnpm gen:pack:check`, `check:provenance`, `gen:listings:check`, `gen:governance-baseline:check` (141 frozen keys all present) and `validate:prompts` exit 0; client-config `lint` and `type-check`, and the launcher `npm run type-check`, clean. No IRIS call, no docker, no real client config was touched; every process test ran with a temporary `HOME`, `USERPROFILE` and `CLAUDE_CONFIG_DIR`.
- `mutation: removed the body of homeGuardReason (it returns null) → 11 home-guard.test.ts rows red (all five alias rows, vscode, the HOME symlink row, the case row, the diff/enable/disable/remove/restore row, the pure-piece row)`
- `mutation: dropped realpathSync.native from realOrResolved in cli/host-probes.ts → home-guard.test.ts "HOME is a symbolic link to the directory the process runs in" red (the row where the process runs in a link to HOME stays green: a child's cwd is already the physical path)`
- `mutation: forced the claude-code-plugin-duplicates branch off in cmdDoctor (if (false && plugin.enabled)) → 5 clients-cli.test.ts doctor rows red`
- `mutation: reverted Goose's win32 path to %APPDATA%/goose/config.yaml in adapters.ts → adapters.test.ts "Goose reads %APPDATA%/Block/goose/config/config.yaml on Windows" red`
- `mutation: render-certification-table.mjs returns the cell without the humanOnly text → certification-docs.test.ts "README marker sections are in sync with a fresh render from the built dist" red`
- `mutation: put "not yet published to npm" back into docs/client-config/README.md → story-42-9-doc-claims.test.ts "no reader document outside the history files has a publication caveat or a development-only node launch" red`
- `mutation: pointed the anchor in packages/shared/README.md back at #server-manager-connections-iris_server_manager → qa-41-7-doc-links.test.ts "packages/shared/README.md: no relative link is broken" red`
- `mutation: changed one byte of the dev row of the README payload table (98,907 → 98,908) → story-42-9-doc-claims.test.ts "has the measured dev row of 2026-11-21" red`
- `mutation (review pass): the skills guard in cmdSkills disabled (if (false)) → home-guard.test.ts "skills install", "skills uninstall" and "skills install --project naming the home directory" rows red`
- `mutation (review pass): cmdApply's JSON error replaced by "see stderr (exit N)" → clientsEngineRealCli.test.ts "DW-702: a project-scope apply run from the HOME directory surfaces the CLI's refusal reason" red (and the apply alias rows of home-guard.test.ts)`
- `mutation (review pass): doctor's plugin branch made unconditional (if (true)) → the doctor rows "plugin set to false, or its key absent", "no settings file at all", "the highest settings file wins" and "not valid JSON" red`
- `mutation (review pass): the project-scope home hint disabled in cmdDoctor → "run from the home directory, the project-scope finding does not offer a remove command the home guard refuses" red`
- `mutation (review pass): humanOnlyProblem returns null for every record → certify-record.test.ts "rejects a missing field, a bad date, an impossible date, a pipe and a non-object" and certification-docs.test.ts "render refuses a malformed humanOnly marker (exit 2, naming the client)" red`
- `mutation (review pass): Pi's path in adapters.ts changed to ~/.pi/mcp.json → new-adapters-42-9.test.ts "pi: user ... project ...", "PI_CODING_AGENT_DIR moves the user file", the status row and every pi apply/remove row red`
- `mutation (review pass): the antigravity row of PACK_TARGETS renamed → pack-targets.test.ts "puts Antigravity CLI on the gemini route, with the sources read on 2026-11-21" and four more rows red`
- `mutation (review pass): the case fold removed from samePath (left === right) → home-guard.test.ts "resolvesToHome folds case on darwin and win32 and not on linux" and "samePath normalizes before comparing" red`
- `mutation (review pass): formatAgainst's semver comparator returns 0 → certify-record.test.ts "takes the highest semver of several matching versions, whatever order npm lists them in" red`
- `mutation (review pass): README.md edited in six places (the install table's "from 1.1.0", "2023.1" in the IRIS claim, the IRIS_USERNAME row given a _SYSTEM default, the DW-706 "remove the old entries first" lead, the DW-690 Security.Applications.Delete line, the per-request language sentence) → story-42-9-doc-claims.test.ts: the install table row, the IRIS claim row, "IRIS_USERNAME is required", the DW-706 removal step, the DW-690 cleanup and the DW-633 per-request rows red, one each`
- `mutation (review pass): the cline record's date changed to 2026-11-21 in certification-results.json → certification-docs.test.ts "every certified-live record that has not been re-certified equals its baseline digest" red (and the render --check row)`
- The baseline digests of the four certified-live records were captured from `git show 915703e5:packages/client-config/scripts/certification-results.json` and equal the current file's digests, so `vscode`, `cline`, `claude-code` and `kimi-code` differ from the baseline only by `humanOnly` and the kimi-code `ac3344` text. The spec's "byte-identical" is read as "evidence untouched" for that reason.
- Every mutation was reverted byte-identically (checked with `diff` against a copy) and the client-config dist rebuilt from the original source.
- `mutation (code review): the claude-code user scope's envOverride (CLAUDE_CONFIG_DIR -> .claude.json) removed in adapters.ts, dist rebuilt -> 14 rows red: clients-cli.test.ts (5 doctor rows incl. "with CLAUDE_CONFIG_DIR set, Claude Code reads $CLAUDE_CONFIG_DIR/.claude.json ..." and "... apply --scope user writes $CLAUDE_CONFIG_DIR/.claude.json ..."), new-adapters-42-9.test.ts "Claude Code: CLAUDE_CONFIG_DIR moves the user file ...", clients-cli-process.test.ts doctor row, qa-42-9-doctor-duplicates-process.test.ts 7 rows`
- `mutation (code review): ensureInputs' project-scope guard disabled (if (false && refusal !== null)) -> home-guard.test.ts "ensureInputs, the engine's other project-scope write, refuses too and writes nothing" red`
- `mutation (code review): hostContext drops projectDir when it resolves to home (status then lists no project scope) -> qa-42-9-home-guard-process.test.ts "status --json from the home directory lists cursor's project scope ..." red; the pre-review form of that row (stdout toContain the path) stayed GREEN on the same mutation`
- `mutation (code review): goose's humanOnly deleted from certification-results.json -> qa-42-9-certification-gate.test.ts "the human-only rows are exactly the clients the spec's Design Notes list ..." red (and the --check control row)`
- `mutation (code review): a simulated lead run (vscode gains against and date 2026-11-22) -> the pre-review qa-42-9-certification-gate.test.ts went red on "the certified-live set is the four clients of the 2026-07-28 runs ..."; the reviewed file stays green there (only the README --check control row is red until the lead re-renders, which is the lead's own step)`
- `mutation (code review): zed's record deleted -> qa-42-9-certification-gate.test.ts "there is exactly one record per adapter of the registry" red (AC 42.9.2, 15 records)`
- `mutation (code review): ADAPTER_DATA_VERSION set to 2026-11-21.2 -> adapters.test.ts "stamps the adapter data with the implementation date" red (AC 42.9.2, the adapter table's version)`
- `mutation (code review): the antigravity disposition id renamed, dist rebuilt -> clientsEngineRealCli.test.ts "detect --json carries the roster AND the sanctioned dispositions array ..." red (the launcher's dispositions pin)`
- `mutation (code review): prd.md "(26 tools, 27 advertised)" -> "(25 ...)" and "All 110" -> "All 109" -> story-42-9-doc-claims.test.ts "the suite totals ..." and "each package line gives that server's package tools ..." red (AC 42.9.3)`
- `mutation (code review): README's "from 1.1.0 \`pi\` and \`jetbrains-junie\`" reverted to the bare ids -> story-42-9-doc-claims.test.ts "the root README and the client index give the 1.1.0 floor ..." red`
- `mutation (code review): "From 1.1.0, " removed from the plugin line of skills-pack/README.md -> qa-42-9-doc-claims.test.ts "every instruction outside the history files is qualified ..." and story-42-9-doc-claims.test.ts "each install command sits in a paragraph ..." red (both exemptions are gone)`
- `mutation (code review): the launcher README's "which cannot resolve until the packages are published" restored -> qa-42-9-doc-claims.test.ts "every hit in a non-history reader document is reviewed" red (the widened inventory regex; the original one missed it)`
- `mutation (code review): the ../irislib/ link restored in docs/known-bugs-2026-05-29-mapping-subscript.md -> qa-41-7-doc-links.test.ts "docs/known-bugs-2026-05-29-mapping-subscript.md: no relative link is broken" red ("not in a clean checkout"); with the clean-checkout rule disabled the same document passes locally (the CI-only failure of run 44908546119) and the checker row "reports a link into the gitignored system-source snapshots" is red`
- Every code-review mutation was reverted (`cmp` against a copy) and the client-config dist rebuilt from the restored source; the client-config suite (45 files, 1,264 tests), the 51 iris-mcp-all doc files (1,370 passed, 30 skipped) and the launcher suite (458 passed, 3 skipped) are green afterwards.

**Lead re-certification record (AC 42.9.2, lead scope; 2026-11-22, after `v1.1.0`; decision #129).**

- **Published:** `release verify --version 1.1.0` exit 0: 8 packages with provenance, 5 MCP Registry servers, IPM `pending` (O-IPM), `npx -y @iris-mcp/dev@1` answered `initialize` with 1.1.0. (Its first run read E404 on `npx`: the `@iris-mcp/shared` 1.1.0 tarball was not yet served one minute after its publish; all 8 tarballs answered 200 at 02:21:47Z.)
- **Throwaway:** harness `up`, IRIS for Health 2026.2 (the pinned digest), `iris-mcp-throwaway-7a6c650b913e` on 127.0.0.1:52792, `HSCUSTOM`; `down` afterwards, no throwaway container left. The shared instance was not touched.
- **Runs:** scratch `HOME` and `CLAUDE_CONFIG_DIR`, `IRIS_*` set to the throwaway, client-config rebuilt; `certify.mjs run <client> --server iris-dev-mcp --real-config --residual-risk <text>` for claude-code, vscode and cline. Each `certified-live`, dated 2026-11-22, `darwin/arm64`, `against: @iris-mcp/dev@1 → 1.1.0`; each restore converged on the engine path, byte-exact.
  - claude-code (Claude Code 2.1.330): `claude mcp list → iris-dev-mcp: npx -y @iris-mcp/dev@1 - ✔ Connected`.
  - vscode and cline: file-level (the agent-side tool listing stays their human-only rows); cline's native `disabled` flag round-tripped (`present-disabled`).
  - Each run started from a seeded pre-existing config. A first claude-code pass from an absent config fell to the raw restore rung (byte-exact: the engine cannot restore "absent"); it was superseded by the seeded run.
  - The July `residualRisk` texts (an unpublished package, the `iris-mcp-all` entry, "re-run after the first npm publish") were replaced through `--residual-risk`.
- **Table:** `render-certification-table.mjs` regenerated the README; `--check` in sync. The QA 33.4 mutation rows anchored on the 2026-07-28 claude-code cell now read the rendered cell (`claudeCodeDispositionCell`), so a re-certification no longer moves them. client-config 45 files / 1,264 tests and the iris-mcp-all certification and doc files (172 tests, `npx-pin` 51) are green.
- **Ledger:** DW-441 resolved-by this story (the lead rows); DW-440 and DW-442 resolved-by this story per their routing (dated human-only markers); the person-run checks are raised with the Planner.
- **Status:** the lead rows and the human-only rows are recorded, so the story closes.

## Auto Run Result

Status: done
Blocking condition: none

**Summary.** The install docs describe the published install (one path per client, Node 22.17, IRIS 2023.1 best effort with the tested range, clone-and-build moved to Contributing), led by the automatic install of the server-side classes with IPM as the fallback (decision #123). `@iris-mcp/client-config` gains the home-directory guard (DW-702) and the `claude-code-plugin-duplicates` doctor check (DW-706); Pi and Junie are adapters, Goose's Windows path and the other DW-626 rows are corrected, `ADAPTER_DATA_VERSION` is `2026-11-21.1`; certification records carry optional `humanOnly` and `certify.mjs` records `against`; the CHANGELOG, PRD (110 tools plus `iris_server_profiles` on each server) and the widened doc-link and doc-claims tests agree. No version, tool, golden, governance baseline or `BOOTSTRAP_VERSION` change; no `certified-live` record was written (the lead's re-certification after npm 1.0.0 is the remaining AC 42.9.2 scope).

**Files changed.** `packages/client-config/` (`src/home-guard.ts`, `src/cli/clients.ts`, `src/cli/host-probes.ts`, `src/engine.ts`, `src/types.ts`, `src/adapters.ts`, `src/pack-targets.ts`, `scripts/certify*.mjs`, `scripts/render-certification-table.mjs`, `scripts/certification-results.json`, README and tests); `packages/iris-mcp-all/src/__tests__/` (`story-42-9-doc-claims.test.ts`, `doc-set.ts`, the widened `qa-41-7-doc-links.test.ts` and relaxed 39/40/41/42 pins); `extensions/iris-mcp-launcher/src/__tests__/` (real-CLI row, disposition pins); root `README.md`, `CHANGELOG.md`, `.changeset/story-42-9-install-docs-and-client-re-certification.md`, `docs/client-config/`, package READMEs, `tool_support.md`, two `docs/known-bugs-*` files, `_bmad-output/planning-artifacts/prd.md`; a comment in `packages/shared/src/http-client.ts`.

**Review.** 41 findings from four layers: 18 patched (2 medium, 16 low), 23 rejected with reasons (4 false, 19 low), 0 deferred; see the Review Triage Log. The patches: the doctor project-scope hint under the home guard, a certified-live baseline digest test, the IRIS for Health range, the dev-row-only payload pin, tracked-files-only doc set, semver ordering in `formatAgainst`, the VS Code paragraph, comment counts, the case and symlink row titles, minified and empty-object fixtures, a local-scope doctor row, and the mutation lines under Verification.

**Follow-up review recommendation.** `false`: the two medium patches (the doctor hint and the digest pin) were each proven red by a recorded mutation and the affected suites ran green afterwards.

**Verification.** client-config build, `render-certification-table.mjs --check` and `UNARMED pnpm --filter @iris-mcp/client-config test` (42 files, 1,188 tests), lint and type-check clean; `UNARMED pnpm --filter @iris-mcp/all test` 220 files, 5,894 passed, 727 skipped (unarmed live legs); shared 86 files, 2,575 (run before the review patches, which did not touch shared); launcher 32 files, 458 passed, 3 skipped, type-check clean; `gen:pack:check`, `check:provenance`, `gen:listings:check`, `gen:governance-baseline:check` and `validate:prompts` exit 0; `lint_spine.py` 0 findings. No IRIS call, no docker container, no image pulled.

**Residual risks.** The `ipmReadme()` text of the packaging repository (`scripts/lib/release-core.mjs`, Story 42.8 code, redesigned under decision #122) does not yet carry the "fallback only" framing of decision #123. The stale "after the first npm publish" residual-risk sentences live in the generated certification records until the lead's re-run replaces them. The `kilo-code` and `antigravity` roadmap rows, the human-only rows and the four `deferred:` items wait for the burn-down and the lead's post-publish phase.

## QA

QA stage, 2026-11-21 (macOS, Node 26.8.1). Build commit `1aa8b1f`, baseline `915703e`. No source, doc, record or generator file was changed; only tests were added. No IRIS call, no docker container, no real client config (every child process ran with a scratch `HOME`, `USERPROFILE`, `APPDATA` and `CLAUDE_CONFIG_DIR` inside `os.tmpdir()`, removed afterwards).

**Tests added (QA).** 83 tests in 4 files, all discoverable by the default suites (`vitest` `*.test.ts`, none excluded, none live-gated):
- `packages/client-config/src/__tests__/qa-42-9-home-guard-process.test.ts` (50 tests, the built bin as a child process). Gap closed: the implement-stage rows ran every write command against an EMPTY home, so a missing guard on `remove`/`disable`/`enable`/`restore` still exited 1 for another reason and "byte-identical" compared nothing. Here the home holds a real owned cursor user file (seeded by `apply --scope user`, then rewritten canonical / BOM+CRLF+4-space / minified, Rule #58) and the six project-scope commands are refused with the exact text; a control run proves `remove --scope user` DOES change the same bytes. Also: text mode (exit 1, empty stdout, reason on stderr); HOME spelled with a trailing slash, a `.` segment, a `..` segment, a symbolic link, a link with a trailing slash and (darwin/win32) a case variant; a sibling `home-2` is a project; every adapter of the registry with a project scope is refused (mechanical); `skills install|uninstall` with `--project` as `.`, `./`, trailing slash, `..` from a subfolder, a `..` segment, a link and a case variant, for every routed client of PACK_TARGETS, and a subfolder install is NOT refused; reads (`status`, `detect`, `doctor`) from home succeed and write nothing.
- `packages/client-config/src/__tests__/qa-42-9-doctor-duplicates-process.test.ts` (10 tests, the built bin on real files). Files have the shapes Claude Code writes: `~/.claude.json` with `numStartups`, `installMethod`, `projects` and `mcpServers` entries of the `claude mcp add` form (`type: "stdio"`, `command`, `args`, `env`); settings files with `enabledPlugins` beside another plugin, `extraKnownMarketplaces` and `permissions`, in canonical, BOM+CRLF+4-space and minified forms. Rows: user flag true then flipped to false on the same sandbox (finding and exit 1, then none and exit 0); an entry from the clone-and-build install (`node .../dist/index.js`) under the canonical name; project `.mcp.json` with project settings; precedence on disk (project true over user false; local false over project true); key absent; the local scope (`projects` map) unread; a truncated settings file; user scope fires from a cwd outside home.
- `packages/client-config/src/__tests__/qa-42-9-certification-gate.test.ts` (9 tests, the real renderer on a scratch copy). Gap closed: nothing proved `--check` is RED when the committed table drifts from the records. Rows: control (in sync, exit 0); a `humanOnly` check edited in the records; a `humanOnly` line hand-edited in the README; an `against` on the claude-code record reaches the adapter table and the details, and the regenerated README is then in sync; the four 2026-07-28 records carry no `against`; one record per adapter of the registry; the certified-live set is exactly claude-code, cline, kimi-code, vscode, all dated 2026-07-28, and every record dated 2026-11-21 is `fixture-only-with-residual-risk`; Pi and Junie records say what is unproven and carry a `humanOnly`.
- `packages/iris-mcp-all/src/__tests__/qa-42-9-doc-claims.test.ts` (14 tests). Rule #56: the spec's own (broader) inventory regex re-run over the doc set against a reviewed allowlist (each entry must still excuse a hit); the install-instruction matcher widened to every spelling the four not-yet-live channels use (`codium --install-extension`, `claude plugin ...`, `ext install`, `zpm "install`, store and registry URLs), each needing a `1.1.0` in its paragraph, section or heading, with a named-exception list that cannot rot; IPM only as the fallback (the only reader document with `zpm "install` is `README.md`, its first command comes after the "Skip this section unless" lead and inside a section that says from 1.1.0, no IPM mention in an install table before it); each case the IPM section lists is produced by `bootstrap.ts` / `Setup.cls` (`Deploy failed`, `Compile failed`, `configured: false`, `%Admin_Manage`, `Configure("<namespace>")`, the `InstallGuard` zpm text) and the two cleanup calls exist in `irissys/` when that snapshot is present; no reader document uses a reference-style link definition or an HTML `href`/`src` (the inline-link checker is blind to both).

**Mutations demonstrated (Rule 19; each reverted, `git status` clean afterwards, dist rebuilt from the original):**
- `mutation: the engine's project-scope guard in resolveTarget disabled (if (false)) -> qa-42-9-home-guard-process.test.ts: the three "leaves a REAL user file byte-identical" rows and the text-mode row red (remove/enable/disable/restore wrote or failed differently; the apply/diff guard in planApply stayed)`
- `mutation: realpathSync.native dropped from realOrResolved in cli/host-probes.ts -> qa-42-9-home-guard-process.test.ts: "HOME with a symbolic link", "HOME with a symbolic link with a trailing slash" and "--project naming a symbolic link to home" red (the last one wrote the whole skills pack into the link target)`
- `mutation: the claude-code-plugin-duplicates branch forced off (if (false)) -> qa-42-9-doctor-duplicates-process.test.ts 7 rows red; forced on (if (true)) -> 6 rows red (flag false, key absent, truncated file, local override, ...)`
- `mutation: renderer's --check never fails (if (false) around the out-of-sync exit) -> qa-42-9-certification-gate.test.ts 3 drift rows red; renderer drops the against text -> the "against reaches the adapter table" row red`
- `mutation: "codium --install-extension iris-mcp.iris-mcp-launcher" appended unqualified to docs/client-config/cursor.md, "The plugin is not yet available." appended to docs/client-config/claude-desktop.md, and the IPM lead sentence replaced by "Optional." in README.md -> qa-42-9-doc-claims.test.ts: the inventory row, the install-instruction row and the IPM lead-order row red; the implement-stage story-42-9-doc-claims.test.ts stayed GREEN for the first two (its regexes do not match them) and went red only for the IPM sentence`
- `mutation: a broken anchor and a missing file appended to docs/client-config/cursor.md -> qa-41-7-doc-links.test.ts "docs/client-config/cursor.md: no relative link is broken" red (the widened checker is red on a broken link in a document this story did not touch)`

**First-run failures (all test mistakes of mine, fixed):** `apply` has no `--dry-run` (the row was dropped; `diff` is the dry-run and is covered); doctor exits 1 for unresolved connection variables, so the read row passes explicit IRIS variables; two doc-claims rows had a sample that the spec's regex does not match ("Until packages are published", which only the implement stage's second regex catches) and an allowlist that was too tight; lint rejected a literal BOM and non-ASCII characters in the test sources (now escapes, Rule 14).

**Verification runs.** `UNARMED pnpm --filter @iris-mcp/client-config test`: 45 files, 1,257 tests green (was 42 files, 1,188 at the implement stage); `eslint` and `tsc --noEmit` clean for client-config; the four QA files green on their own. The full `@iris-mcp/all` suite was NOT run (the code reviewer is working on `release-*` tests in that package); `qa-42-9-doc-claims`, `qa-41-7-doc-links` and `story-42-9-doc-claims` were run alone.

**Adapter data against the clients' docs (read-only GETs, 2026-11-21).** All 15 `docsUrl` values return HTTP 200 (`curl -sL`). Pi `raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/mcp.md`: `~/.pi/agent/mcp.json`, `.pi/mcp.json`, `mcpServers` (matches). Junie `junie.jetbrains.com/docs/junie-cli-mcp-configuration.html`: `~/.junie/mcp/mcp.json`, `.junie/mcp/mcp.json`, `mcpServers` (matches). Goose `goose-docs.ai/docs/guides/config-files`: `%APPDATA%\Block\goose\config\config.yaml` (matches). Devin `docs.devin.ai/desktop/devin-local/customizations`: user `~/.config/devin/mcp_config.json`, project `.devin/mcp_config.json`, local `.devin/mcp_config.local.json` (consistent with the notes). `ADAPTER_DATA_VERSION` `2026-11-21.1` is pinned by `adapters.test.ts` (implement stage).

**Findings for the lead (not fixed; none is a regression of this story's ACs):**
1. `[medium]` DW-706 doctor reads the wrong user file when `CLAUDE_CONFIG_DIR` is set. Claude Code's docs (`code.claude.com/docs/en/claude-directory`, read 2026-11-21): "If you set `CLAUDE_CONFIG_DIR`, every `~/.claude` path on this page lives under that directory instead. The same applies to `.claude.json`, which otherwise sits at `~/.claude.json`." The claude-code adapter's user path is the fixed `~/.claude.json` (no `envOverride`), so with the variable set `doctor` reads (and `apply --scope user` writes) a file Claude Code does not read, and the duplicate check misses real duplicates. `detectClaudeCodePlugin` already honours `CLAUDE_CONFIG_DIR` for `settings.json`, so the two halves of the check disagree. Pre-existing adapter data, not introduced by 42.9; the fix is `envOverride: { var: "CLAUDE_CONFIG_DIR", pathSuffix: ".claude.json" }` on the claude-code user scope (the `kimi-code`/`pi` mechanism) plus fixtures. My process rows put `.claude.json` in the home directory, as the adapter reads it; they do not cover the variable-set case because it would assert a defect. Not in `deferred-work.md` (searched).
2. `[low]` The Devin Desktop import claim is stated as fact but is documented for a different product. `docs/client-config/README.md:304`, `packages/client-config/README.md:434` and the `windsurf` record's `note` say Devin "reads [the legacy `~/.codeium/windsurf/mcp_config.json`] through an import that is on by default". The only page that documents that import is Devin CLI's `cli/reference/configuration/read-config-from` (`~/.codeium/<channel>/mcp_config.json`); the Devin Desktop / Devin Local page does not mention an MCP import (it lists only `~/.config/devin/mcp_config.json`, `.devin/mcp_config.json`, `.devin/mcp_config.local.json`). The spec's own deferred item says "inferred, not probed live". The windsurf human-only check already tests it; the prose should say "Devin CLI documents ..., Devin Desktop is expected to do the same".
3. `[low]` `packages/client-config/skills-pack/README.md:43` (generated from `PLUGIN_README_SECTION` in `scripts/lib/skills-pack.mjs`) tells the reader to install the plugin with no "from 1.1.0". The implement stage's DW-707 guard exempts the file as `GENERATED`; decision #116 says no doc does that. In context it is the plugin's own README, reachable only from a release that has the plugin, so the risk is small. `qa-42-9-doc-claims.test.ts` names it in `KNOWN_UNQUALIFIED`; when the generator text gains the floor (and `story-42-8-doc-claims.test.ts` pins move with it) that entry must be deleted (the "each named exception still exists" row fails until it is).
4. `[low]` The spec's inventory regex does not match its own most common wording ("Until packages are published", which the second regex catches). The QA allowlist test uses the inventory regex verbatim; the implement stage's `CAVEAT` regex is the guard for that wording. No document currently has either.
5. `[info]` The doc set is 84 files today, the inventory says 83 (`>= 83` floors hold); the extra file is not a caveat carrier (all 84 were scanned).

## Review

Code review, 2026-11-21. Frozen diff: `git diff 915703e edf7450` limited to this story's files (5,886 lines), captured before any layer started (Rule #57). Review tier `full-opus`: Blind Hunter, Edge Case Hunter, Verification Gap and Acceptance Auditor all ran in the foreground and all delivered (12, 10, 9 and 9 findings; 40 rows). No layer changed the tree. Lead-routed: the QA `[medium]` and three `[low]` items, and the CI failure of run 44908546119 (sent mid-review). After grouping: **0 high, 8 medium, 26 low**. Every medium is patched with a regression test and a recorded mutation (`## Verification`). Outcome: NORMAL (all layers delivered). The story stays `in-progress` until the lead's post-publish certification rows (Design Notes), not because of a review finding.

**Medium (all patched; fix-risk low unless stated)**
- **M1. `CLAUDE_CONFIG_DIR` moves `.claude.json`, and the adapter ignored it** (QA finding 1; Blind, Edge, Verification Gap, Auditor). Verified before fixing (Rule #54) with a scratch probe of Claude Code 2.1.330 (scratch `HOME` and `CLAUDE_CONFIG_DIR`, removed after): `claude mcp add -s user` wrote `$CLAUDE_CONFIG_DIR/.claude.json`, `claude mcp get` did not see an entry in `~/.claude.json` while the variable was set and did see it once the variable was unset, and an `mcpServers` block in `settings.json` is not read at all. Fix: the claude-code user scope gets `envOverride: { var: "CLAUDE_CONFIG_DIR", pathSuffix: ".claude.json" }` (the kimi-code/pi mechanism). That moves `apply`, `status`, `remove`, `doctor` and `certify.mjs` (which reads the path from the engine) to the file Claude Code reads; it is consistent with the plugin detector and with the lead's certify recipe, which exports `CLAUDE_CONFIG_DIR=<scratch>/.claude` (before the fix that run would have written `<scratch>/.claude.json`, which `claude mcp list` then ignores). The test fixtures that put `.claude.json` in `HOME` next to `CLAUDE_CONFIG_DIR` (a layout Claude Code never produces) now put it under the variable; new rows pin the variable-set read, the variable-unset default layout and `apply --scope user`. Docs: the client index, `claude-code.md`, the client-config README, the CHANGELOG and the changeset. Fix-risk med (adapter data; it moves where existing users' user-scope writes land, which is the bug).
- **M2. The docs' preferred `claude mcp add` recipe made entries `doctor` never sees** (Blind, Edge, Auditor): `claude mcp add iris-dev ...` had no `--scope` (Claude Code's default is local, which `doctor` does not read) and a non-canonical name. Now `claude mcp add --scope user iris-dev-mcp ...` (probed in the scratch config). `claude-code.md` also told readers to put `mcpServers` in `~/.claude/settings.json`, which Claude Code does not read (probed): fixed to `~/.claude.json`.
- **M3. Two QA certification rows pinned a temporary state** (Blind, Verification Gap): the lead's own AC 42.9.2 step (a certify run that records `against` and a new date) would have turned them red. They now exempt records that carry `against`, and the drift row uses a sentinel version. Proven with a simulated lead run against the old and the new file.
- **M4. The README documented ids and behaviour that the published 1.0.0 lacks** (Auditor; confirmed with the published bin in a scratch `HOME`: `diff --client pi` answers `unknown client "pi"`). `pi`, `jetbrains-junie`, `antigravity` and the home-directory refusal now say "from 1.1.0" in the root README and the client index (`antigravity` points 1.0.x users at `gemini`). New pin in `story-42-9-doc-claims.test.ts`.
- **M5. AC 42.9.3 had no pinning test** (Verification Gap). New rows derive the PRD's totals and per-server lines from `fixtures/tools-list-snapshot.json`.
- **M6. Nothing pinned which records carry `humanOnly`** (Verification Gap). New row: the set equals the Design Notes list (12 clients) and each renders its marker.
- **M7. The "reads are unchanged" row could not fail on what it claims** (Verification Gap). It now asserts cursor's project scope in the parsed `status --json`; the old form stayed green on the mutation.
- **M8. CI red on `qa-41-7-doc-links` (lead-routed, run 44908546119).** `docs/known-bugs-2026-05-29-mapping-subscript.md:32` linked `../irislib/`, which is gitignored, so the check passed only on a machine with the snapshot. The reference is now plain text (and names the right snapshot, `irissys/Config/MapGlobals.cls`); a scan found no other link into `irislib/` or `irissys/` in any reader document. The checker now treats a target that a clean checkout does not have (not tracked, or gitignored) as broken, so a local run cannot pass where CI fails; a checker row and two mutations prove it.

**Low**
- Patched: the Devin Desktop import claim now says what is documented (Devin CLI documents the import; Devin Desktop's own page does not), in the client index and the `windsurf` record (lead-routed; Blind); the plugin README carries "From 1.1.0" via `PLUGIN_README_SECTION` and `gen:pack`, both exemptions deleted and the pack README golden re-pinned (lead-routed; Blind, Auditor); the QA inventory regex matches "until ... are published" (lead-routed), which found one real remaining caveat in the launcher README ("cannot resolve until the packages are published"), now removed, plus a `SECURITY.md` disclosure sentence allowlisted with its reason; the IPM cleanup now says both leftovers are instance-wide and to run both deletes only when no namespace still uses the suite (Blind); the payload paragraph no longer claims the dev-row pin re-measures anything (Blind); the `irissys/` API check is a `skipIf` row, so CI reports a skip, not a pass (Blind, Verification Gap); 1.0.x home-directory skills installs get a manual cleanup sentence (Blind); `home-guard.ts` and the client-config README say `diff` and `--dry-run` are refused too (Blind, Edge); the `qa-41-7` header says tracked files (Blind, Verification Gap); the windsurf restart hint names Devin Desktop (Blind; it reopens the earlier rejection, no golden pins it); `ensureInputs` refuses a home project write like `apply` (Edge); missing mutation lines for one-record-per-adapter, `ADAPTER_DATA_VERSION` and the launcher dispositions pin (Verification Gap); the IPM section's `configured: false` case now quotes what the server logs (Auditor); `claude-code.md` and the client index no longer contradict the one-path rule (Auditor); the PRD's 1.0.0 publish date is 2026-11-21, the registry's (Auditor).
- `decision-pending` DW-716 (owner `burndown`, `human=`): every package carries a public, non-deprecated `0.0.0-stage` (npm staged-publishing placeholder); whether to `npm deprecate` it is the owner's call (Auditor). The CHANGELOG `[1.0.0]` date (the version step's date) is left as is.
- `wontfix-accepted`: the plugin flag true in a project settings file while the plugin is not installed (Edge; the spec's signal is `enabledPlugins`, decision #114; `reopen_if` a user reports a duplicates finding with the plugin uninstalled); entries disabled by Claude Code's `disabledMcpServers` (Edge; `reopen_if` such a report); managed settings (Edge; 42.8's documented detector limit; `reopen_if` a managed-settings user reports a wrong finding); `against` from `npm view`, not from the launched server (Edge, Verification Gap; earlier rejection kept; `reopen_if` the lead's run records a wrong or `unresolved` `against`); the README Releasing section and the PRD still describe the IPM packaging-repository route (Auditor; that text is 42.8's and decision #122's rework owns it; `reopen_if` it survives that rework).
- `wontfix-theoretical`: an empty `HOME` makes every directory "home" (Edge; real only where `HOME=""`, where every user path is already wrong); bind mounts or UNC aliases of the home directory (Edge; real only if a home is reached through two different real paths).
- `by-design`: `doctor` not reading Claude Code's local scope (Edge; decision #3, documented). Rejected (fix is a spec edit): the AC 42.9.2 "byte-identical" wording (Auditor; the reading is recorded under Verification).

Patch commit: the review commit on `epic42` that carries this section. Re-review: not recommended (no high; each medium has a regression test and a recorded mutation, and the suites are green). Ledger: `new_dw=DW-716`, no occurrences.
