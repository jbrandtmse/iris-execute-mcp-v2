---
title: 'Story 44.2: VS Code Copilot MCP Configuration Targets'
type: 'bugfix'
created: '2026-11-22'
status: 'ready-for-dev'
baseline_revision: '171f1535f71baba17e669195751edbd9fd2573cd'
baseline_commit: '171f1535f71baba17e669195751edbd9fd2573cd'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
deferred:
  - summary: 'The launcher extension''s mcpServerDefinitionProvider servers reach a Copilot-harness session without connection settings or credentials'
    evidence: 'The provider returns McpStdioServerDefinition(label, command, args, {}) and adds IRIS_* only in resolveMcpServerDefinition (extensions/iris-mcp-launcher/src/extension.ts:660-700). VS Code 1.147.0 forwards the provided launch as is: the forwarding classifier (workbench.desktop.main.js, function qls) projects r.launch (env copied verbatim, function PVn) and never calls the collection''s resolveServerLanch, which runs only on a Local start (registry start path). Docs: "Don''t rely on an interactive resolver running during background forwarding to Copilot" (code.visualstudio.com/api/extension-guides/ai/mcp, fetched 2026-11-22). A fix needs extension code (provide-time non-secret env plus IRIS_SERVER_MANAGER=auto) and so a new vsix, which ships only through DW-720''s manual step.'
    location: 'extensions/iris-mcp-launcher/src/extension.ts:660-700'
    severity: 'med'
---

<intent-contract>

## Intent

**Problem:** The `vscode` client adapter writes `.vscode/mcp.json` and the profile `mcp.json` (root `servers`, `${env:VAR}`, an `inputs` password prompt). These are files of the deprecated Local harness, which VS Code removes in February 2027. The Copilot harness (the default since VS Code 1.143) does not forward the adapter's entries even today: a profile entry with any variable is skipped, and a `.vscode/mcp.json` entry with `${input:…}` is skipped (DW-721; probes V3-V5).

**Approach:** Move the adapter's write targets to the files the Copilot harness reads itself: user `~/.copilot/mcp-config.json` (`$COPILOT_HOME/mcp-config.json`) and the workspace-root `.mcp.json`, both keyed `mcpServers`, with `${VAR}` expansion and no `inputs`. The workspace `.mcp.json` is also Claude Code's project file, so add the AD-30 shared-file rule. Keep reading the old files so `status`/`doctor` show old installs, and let the next `apply` move owned entries out of them. No IRIS, tool, governance key or publish is involved.

## Boundaries & Constraints

**Always:**
- Every write, the migration included, follows the AD-30 / FR141 protocol: validate, timestamped backup, edit, re-parse, restore on failure, diff preview. Only owned entries are written or removed. Foreign content (other entries, comments, `inputs`, other root keys) is preserved byte for byte, proven on non-canonical fixtures (Rule #58).
- The `vscode` adapter, its targets and its format:
  - user scope `~/.copilot/mcp-config.json` on every OS, with `envOverride: { var: "COPILOT_HOME", pathSuffix: "mcp-config.json" }`;
  - project scope `.mcp.json`;
  - `format: "json"`, `rootKey: "mcpServers"`, `envExpansion: "claude"` (`${VAR}`).
  The env override uses `COPILOT_HOME` only when it is set and non-empty, as VS Code does (probe V1). `XDG_CONFIG_HOME` is never consulted.
- Entry shapes:
  - a project entry in `.mcp.json` is synthesized exactly as the `claude-code` project entry for the same server, mode and profile (the `standard` shape), so the two clients' writes are identical;
  - a user entry in `mcp-config.json` is `{type:"stdio", command, args, env, tools:["*"]}`, the shape VS Code's own Copilot-Global writer uses (probe V8).
  Neither shape ever carries `inputs`, `envFile`, `cwd`, `dev` or `${env:…}`.
- No secret is written as a literal by default:
  - `env-reference` writes `"IRIS_PASSWORD": "${IRIS_PASSWORD}"`;
  - `server-manager` writes no secret;
  - only `explicit` (typed confirmation) writes a literal (AD-9).
- **Shared files (AD-30 "Shared files", refined in Design Notes D-2).** An adapter scope whose resolved path equals another adapter scope's path is shared. For `.mcp.json` that is `claude-code` and `vscode`.
  - A write for client X under a canonical name proceeds as today when X alone owns the entry. X owns it alone when its ledger records the entry and no other sharing client's ledger does; for `claude-code`, an entry no client records also counts (AD-15).
  - Otherwise, an entry equal as a JSON value to what X would write is adopted: X's record is added and nothing is written. Any other entry is a conflict: exit 1, the reason names the file and the other client, and nothing is written.
  - A `disable` or `remove` for X in a shared file proceeds and says that the other client reads the same file.
  - `detect`, `status` and `doctor` show the file under both clients and never count or check it twice.
- **Old files are read-only sources.** They are `.vscode/mcp.json` and the profile `mcp.json` (`VSCODE_USER_ROOT`), JSONC with root `servers`.
  - `status` and `doctor` report owned entries still in them.
  - `apply --client vscode --scope S` writes the new target first. Then, in the same run, it removes the owned entries for the applied servers from scope S's old file, through the protocol. The old file is never edited before the new write has re-parsed clean. Its `inputs` array is left byte-identical.
  - `remove --client vscode` also removes owned old-file entries.
- Back-compat (AC 44.2.8): the other 14 adapters' data, `CLIENT_DISPOSITIONS`, the CLI exit codes (0/1/2) and the `{ok, command, data, error?}` envelope stay unchanged. `claude-code` behavior on a `.mcp.json` that no `vscode` record touches is byte-identical to before. New output fields are additive only.

**Never:**
- No publish: no `npm`/`pnpm publish`, `changeset version`, `pnpm run version`, `vsce`, `ovsx`, IPM or `mcp-publisher`. No regeneration of the IPM tree. No IRIS or container use.
- Never read or write the developer's real `~/Library/Application Support/Code`, `~/.copilot`, `~/.claude` or keychain. Tests and certify runs use a scratch `HOME`/`COPILOT_HOME`/`USERPROFILE`.
- No new client adapter. The adapter count stays 15. No new CLI command: the migration is part of `apply`/`remove`.
- No change to the launcher extension's provider code (the deferred item above), and no new vsix in this story.
- Never write a literal secret without `explicit` mode's confirmation. Never write `${input:…}`/`${command:…}`.
- No edit of the spine, `epics.md`, `deferred-work.md`, `sprint-status.yaml` or `.claude/rules/*`: amendments go to the lead (Design Notes).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| User write, default | `apply --client vscode --scope user --server iris-dev-mcp` (env-reference); `COPILOT_HOME` unset | `~/.copilot/mcp-config.json` gains `mcpServers.iris-dev-mcp` `{type:"stdio",command:"npx",args:[…@1],env:{IRIS_HOST:"${IRIS_HOST}",…,IRIS_PASSWORD:"${IRIS_PASSWORD}"},tools:["*"]}`; no `inputs`; `inputsMerged: []` | none |
| COPILOT_HOME | same, with `COPILOT_HOME=/x` (and again with `COPILOT_HOME=""`) | writes `/x/mcp-config.json`; empty value falls back to `~/.copilot/mcp-config.json` | none |
| Project write | `apply --client vscode --scope project` in project P | `P/.mcp.json` entry equal to what `apply --client claude-code --scope project` writes for the same inputs | none |
| Adopt | `.mcp.json` holds the claude-code entry (recorded for claude-code); vscode apply, same mode | no file edit; vscode record added; result says adopted and shared with claude-code | none |
| Conflict | same, but different mode/profile (or an unrecorded different canonical entry, for vscode) | exit 1; reason names `.mcp.json` and claude-code; file and state unchanged | refusal |
| Claude-only back-compat | claude-code apply/disable/remove on `.mcp.json` with no vscode record | byte-identical files, results and exit codes to pre-story | as today |
| Shared disable/remove | vscode `disable` or `remove` of an entry claude-code also records | proceeds; result text and preview say Claude Code reads the same file | none |
| Status/detect/doctor | both clients configured on one project | `.mcp.json` listed under both rows with a `sharedWith` marker; any file total counts it once; parse and drift checks run once; `unrecorded-entries` never fires for an entry the other sharing client records | none |
| Old install visible | owned entries in `.vscode/mcp.json` and the profile `mcp.json`, new files absent | `status` lists them under vscode as old-location entries; `doctor` reports a finding naming each file and `apply --client vscode` as the fix (exit 1) | none |
| Migration | the above, then `apply --client vscode --scope project` | `.mcp.json` written and re-parsed; the owned entry is removed from `.vscode/mcp.json`; foreign entries, comments and `inputs` there stay byte-identical; `diff` previews both files | the new write fails: old file untouched. The old-file edit fails: old file restored from its backup, the new entry kept, the result says the entry is still in the old file |
| Old stash | a vscode stash recorded before the move (holds `${env:`/`${input:`) | `enable` refuses, naming the entry and `apply` as the fix; the stash is kept; doctor reports it | refusal |
| Non-canonical shared file | `.mcp.json` compact, 4-space, CRLF, with a BOM, or with comments | a vscode write behaves exactly as a claude-code write does on that fixture today (pinned from pre-story claude-code behavior); every foreign byte is preserved | as claude-code today |
| Strict JSON user file | `mcp-config.json` with comments or a trailing comma | refused at validate (VS Code parses it with `JSON.parse`, probe V8); nothing written | refusal |
| Home project | project dir resolves to the home directory | refused before the protocol, as today (`home-guard.ts`) | refusal |

</intent-contract>

## Code Map

- `packages/client-config/src/adapters.ts` -- `vscode` (:158-203; rootKey `servers`, `format:"jsonc"`, `envExpansion:"vscode"`, user `${VSCODE_USER_ROOT.*}/mcp.json`, project `.vscode/mcp.json`, detection incl. `appDir` Code dirs, `restartHint`, `docsUrl`). `claude-code` (:35-81) is the model: `envOverride` `CLAUDE_CONFIG_DIR` (:49), project `.mcp.json` (:53-60). `VSCODE_USER_ROOT` (:23-27) stays (cline :214-234, roo-code :250-280 use it). `ADAPTER_DATA_VERSION` (:19, `"2026-11-21.1"`). `CLIENT_DISPOSITIONS` (:662).
- `packages/client-config/src/types.ts` -- `ClientAdapter` (:99-112), `ScopeDef` (:37-57; `fallbacks` unused), `EntryShape` (:60), `EnvExpansion` (:73; doc :69), the `rootKey` comment (:103), `CANONICAL_SERVERS` (:128-134).
- `packages/client-config/src/paths.ts` -- `resolveScopePath` (:61-87), `resolveScopeCandidates` (:90-112): env override when set and non-empty, then template; `join(envValue, pathSuffix)`.
- `packages/client-config/src/synthesize.ts` -- `synthesizeEntry` (:146), `baseEntry` (:137), `referenceForm` (:130-135, the only `${env:` producer), the vscode `inputs` branch (:204-222), `VSCODE_PASSWORD_INPUT_ID` (:93), `VscodeInput` (:85-90).
- `packages/client-config/src/engine.ts` -- `resolveTarget` (:117), `isCanonicalName` (:148), `ownershipRefusal` (:159), `persistState` (:199), `apply` (:331), `enable` (:372), `disable` (:424), `remove` (:467), `restore` (:537), `ensureInputs` (:661-753; vscode-only, it becomes unreachable for the roster).
- `packages/client-config/src/state.ts` -- the ledger is keyed `(client, scope, name)` with no path (`sameSlot` :123, `isManagerCreated` :129, `recordManaged` :135, stash :159-187). `StashRecord` (:41-48) holds the raw entry.
- `packages/client-config/src/diff.ts` -- surgical edits, never jsonc `modify()`: `removalEdits` :635, `insertionEdits` :826, `insertIntoContainer` :864, `replacementEdits` :950, `detectEol`/`detectIndentUnit` :755/:772, `diff()` :544.
- `packages/client-config/src/write.ts` -- `executeNativeEdit` :101, `applyWrite` :333 (pre-parse, backup `backupPathFor` :313 per client, re-parse, restore), `restoreBackup` :488.
- `packages/client-config/src/readers.ts` -- parsing with duplicate-key refusal :261-390.
- `packages/client-config/src/detect.ts` (:44, :68), `status.ts` (`buildStatusMatrix` :98, scopes :117) -- per-adapter iteration, no path dedup today.
- `packages/client-config/src/home-guard.ts` -- `samePath` :19 (the one path-equality helper; reuse it for shared-file detection), `homeGuardReason` :34-56.
- `packages/client-config/src/cli/clients.ts` -- exit codes :16-21, `emitJson` :414-425, help text with `${env:VAR}` :460, `cmdDetect` :651, `cmdStatus` :708, apply planning :912-937, `cmdDiff` :996, default mode env-reference :1010/:1089, `cmdApply` :1075 (`ensureInputs` call :1170-1177, `inputsMerged` :1153/:1188/:1202), `cmdToggle` :1215, `cmdDoctor` :1374-1857 (env-references :1493-1575 with the `${env:`/`${input:` branch :1539-1568, unrecorded-entries :1706 keyed by client, orphaned-stashes :1631-1671), `runCli` :2048-2089.
- Fixtures: `src/__tests__/fixtures/golden/vscode*`, `vscode/user.jsonc`, `drift/wrong-shape.jsonc`, `sandbox-home/.config/Code/User/mcp.json`, `sandbox-project/.vscode/mcp.json`, and `sandbox-project/.mcp.json`. The last is the claude-code project fixture, shared with claude-code tests, so edit it with care. Non-canonical inline fixtures are in `byte-preservation.test.ts:56-90`, CRLF/BOM in `e2e.test.ts:466-515`.
- Tests that pin the old vscode shape and must move (AC 44.2.6 lists verdicts): `adapters.test.ts` :23 (count 15 stays), :80-91, :212; `home-guard.test.ts` :150-159, :297-308; `golden.test.ts` :60, :106, :209-222; `byte-preservation.test.ts` :53, :294-345; `clients-cli.test.ts` :557-569, :1050-1065; `clients-cli-process.test.ts` :147-155, :664; `qa-33-5-process.test.ts` :116-134, :696-708; `engine-e2e.test.ts` :333-399; `e2e.test.ts` :256, :361-364, :467-469, :549-552; `readers.test.ts` :27, :45, :96, :104, :249-257, :456, :502, :522; `diff.test.ts` :309-310, :696; `qa-33-5-unit.test.ts` :65-96; `synthesize.test.ts` :83-104 (the sweep :260/:287 stays); `status.test.ts` :34, :95-99; `detect.test.ts` :142-144; `helpers.ts` :40.
- `packages/client-config/scripts/certify.mjs` -- `run <client> --real-config [--skip-agent]`. It writes the config under `HOME`/`USERPROFILE` (:196, :386) and so must only run with a scratch `HOME`. vscode uses explicit mode with `DUMMY_PASSWORD` (:61, :486-488) and a file-level verifier (:277-280); it notes `inputs` are not rolled back (:481-483).
- `packages/client-config/scripts/certification-results.json` (vscode :56-86, `humanOnly` with `markedOn`), `packages/client-config/scripts/certify-record.mjs` (`humanOnlyProblem` :38), `scripts/render-certification-table.mjs` (`--check`; reads `../dist/adapters.js`; writes the three marked tables in `packages/client-config/README.md`). `certification-docs.test.ts` :76, :149-152 (`BASELINE_CERTIFIED_LIVE_DIGESTS.vscode`: a re-certified record carries `against` and leaves the pin); `qa-42-9-certification-gate.test.ts` :99/:117/:137; `qa-41-7-generated-table-gate.test.ts`.
- Docs: `packages/client-config/README.md` (generated tables + hand text :288, :347-350, :400, :418); `docs/client-config/README.md` (hand-written: row :80, VS Code section :161-183); `extensions/iris-mcp-launcher/README.md` (:126-142 coverage, :255-264 mode table "VS Code prompts instead"); root `CHANGELOG.md` (top is `## [Unreleased] — Story 44.1: …`); `.changeset/`.
- Extension: `extensions/iris-mcp-launcher/src/clientsEngine.ts` (:25/:155-156 npx `@1` spec; `inputsMerged` :519; modes :83-84, :626-637); `clientsView.ts`/`clientsPanel.ts` (no hard-coded paths; paths come from the CLI); `src/__tests__/clientsEngine.test.ts` :352/:362 mirror the CLI help text; `clientsView.test.ts` :84 (a profile path in a detect fixture); `extension.ts` :660-700 and `serverDefinitionProvider.ts` :367-368/:634-646 (the provider, read-only here).
- `packages/client-config/skills-pack/.mcp.json` -- the plugin's server file, not a client config. Exclude it from `.mcp.json` sweeps.

## Tasks & Acceptance

**Execution:**
1. `packages/client-config/src/__tests__/adapters-44-2-backcompat.test.ts` (new) + `src/__tests__/fixtures/adapters-pre-44-2.json` (new) -- FIRST, before any source edit, build the package and capture `JSON.stringify` of `CLIENT_ADAPTERS` minus `vscode`, plus `CLIENT_DISPOSITIONS`, from the pre-edit `dist`. Record the capture command in the test header. Pin with `toEqual`. Also capture the pre-story claude-code results on the shared-file fixtures (task 6) as the oracle for the non-canonical matrix row (Rule #36).
2. `packages/client-config/src/types.ts` -- add optional `ScopeDef.entryShape?: EntryShape` (per-scope shape override) and optional `ClientAdapter.legacyScopes?: LegacyScopeDef[]`. `LegacyScopeDef` is `{scope, paths, format, rootKey, envExpansion}`, read-only. Add `EntryShape` `"copilot"` (`{type:"stdio",command,args,env,tools:["*"]}`). Fix the `rootKey`/`EnvExpansion` comments. Absent fields leave the other adapters' data unchanged (task 1's pin).
3. `packages/client-config/src/adapters.ts` -- the new `vscode` definition per Boundaries. `detection`: config probes of the new scopes plus the existing Code `appDir`. `legacyScopes`: the old user (`VSCODE_USER_ROOT`) and project (`.vscode/mcp.json`) files, `jsonc`, `servers`, `vscode` expansion. `restartHint` names a new Copilot chat session or a window reload, and restarting VS Code from an environment that has the `IRIS_*` variables. Bump `ADAPTER_DATA_VERSION` to the build date (`"YYYY-MM-DD.1"`).
4. `packages/client-config/src/synthesize.ts` and `diff.ts` -- honor the per-scope shape. `copilot` renders `type`, `command`, `args`, `env`, `tools`, reusing the `standard` renderer (extend it, Rule 2). With no adapter on `vscode` expansion, no `inputs` are synthesized. Keep `referenceForm`'s `${env:` branch only if a legacy path still needs it; otherwise delete it with the inputs branch and note that in the Spec Change Log.
5. `packages/client-config/src/shared-files.ts` (new) -- `sharedScopes(adapter, scope, ctx)` (`samePath` over every adapter's resolved scope paths) and `soleOwner` / `adoptOrConflict` per Boundaries. Callers: `engine.ts` (`ownershipRefusal`, `apply`, `disable`, `remove`, `enable`) and the status/detect/doctor builders (dedup by resolved path; a `sharedWith` field). Unit-test every matrix row.
6. `packages/client-config/src/__tests__/shared-mcp-json.test.ts` (new) -- the shared-file rows on non-canonical `.mcp.json` fixtures (compact, 4-space, CRLF, BOM, comment-bearing): adopt, conflict, claude-only back-compat (`toEqual` task 1's oracle), shared disable/remove text, status/doctor once-only, and foreign-byte preservation. Fixtures are self-contained temp dirs.
7. `packages/client-config/src/engine.ts`, `cli/clients.ts`, `status.ts`, `detect.ts` -- old-file reporting (status: additive `legacy` per scope; doctor: a check named `vscode-local-harness-entries`, one finding per file), the apply migration and the remove sweep, the old-stash `enable` refusal (also reported by the same doctor check), the shared-file results, and the help text (`${VAR}`, no `${env:VAR}`). `inputsMerged` stays in the envelope (`[]`).
8. `packages/client-config/src/__tests__/vscode-copilot-targets.test.ts` (new) -- the matrix rows for writes, `COPILOT_HOME` (set and empty), migration (both failure branches by injected write failure), old stash, strict-JSON refusal, and the no-literal-secret default. Then update every test in the Code Map list to the new shape. Old-format fixtures stay and are read through `legacyScopes` ("a reader of an old file still parses it").
9. `packages/client-config/src/__tests__/clients-cli-process.test.ts` -- Integration AC: spawn the built CLI with scratch `HOME`/`USERPROFILE`/`COPILOT_HOME`. Assert `apply --client vscode` writes `$COPILOT_HOME/mcp-config.json`, `status --json` lists the shared `.mcp.json` once per client with `sharedWith`, exit codes are 0/1/2 as before, and the envelope keys are `{ok, command, data[, error]}`.
10. `packages/client-config/scripts/certification-results.json`, `packages/client-config/README.md` -- run `node packages/client-config/scripts/certify.mjs run vscode --real-config --skip-agent` with `HOME`/`USERPROFILE` set to a fresh scratch dir and `COPILOT_HOME` unset (never the real home; verify the printed paths before the run). Keep `humanOnly` with `markedOn` set to the run date and the AC 44.2.7 check text, and set `against`. Then rebuild and run `render-certification-table.mjs`. Update `certification-docs.test.ts`/`qa-42-9-certification-gate.test.ts` only where they pin the old paths.
11. Docs -- `packages/client-config/README.md` (hand text), `docs/client-config/README.md`, and `extensions/iris-mcp-launcher/README.md` (mode table, Copilot coverage, the provider-path limitation). Cover:
    - the new targets and the Windows path `%USERPROFILE%\.copilot\mcp-config.json`;
    - `COPILOT_HOME`;
    - the shared `.mcp.json`;
    - migration;
    - credentials: `${IRIS_*}` resolves from the environment VS Code was launched with, and `server-manager` mode (OS keychain) replaces the password prompt;
    - that old entries are not forwarded to Copilot sessions.
    Update `extensions/iris-mcp-launcher/src/__tests__/clientsEngine.test.ts:352,362` to the new help text.
12. `CHANGELOG.md` (an `[Unreleased] — Story 44.2: …` section with "Fixed" and "Changed" entries naming DW-721), `.changeset/story-44-2-vs-code-copilot-mcp-configuration-targets.md` (`"@iris-mcp/client-config": patch`; the lead may raise it to minor). The story record names the release must-carry (AC 44.2.9).
13. `_bmad-output/implementation-artifacts/spec-44-2-vs-code-copilot-mcp-configuration-targets.md` (D-5) -- AC 44.2.6: at the end of the build, re-run the D-5 greps:
    - `\.vscode/mcp\.json`, `Code/User`, `Application Support/Code`, `"servers"`, `\$\{env:`, `\$\{input:` and `\binputs\b`;
    - over `packages/client-config`, `extensions/iris-mcp-launcher`, `docs` and the root `*.md`.
    Every hit takes its recorded verdict. Any new hit gets a verdict, added to D-5 with the date.

**Acceptance Criteria:**
- AC 44.2.1: Given the probe results (Design Notes D-1, dated and sourced), when the implement stage builds, then it builds on them. Any claim it finds wrong is added with its evidence and reported in `## Auto Run Result`.
- AC 44.2.2: Given a scratch home, when `apply --client vscode` runs at user and at project scope in each env mode, then the files, root key, shapes and `${VAR}` references are as in Boundaries, and no non-explicit mode writes a literal `IRIS_PASSWORD` or any `inputs` (the `synthesize.test.ts` sweep stays green). `ADAPTER_DATA_VERSION` has moved, and `render-certification-table.mjs --check` passes.
- AC 44.2.3: Given each non-canonical shared `.mcp.json` fixture, when `apply`, `disable`, `remove`, `status` and `doctor` run through the CLI for `vscode` and for `claude-code`, then:
  - adopt, conflict and the shared disable/remove text behave as in the matrix;
  - the file is listed once per client and checked once;
  - every foreign byte is preserved;
  - claude-code's results are `toEqual` the pre-story oracle.
  The pins are `shared-mcp-json.test.ts` and, for the listing, task 9.
- AC 44.2.4: Given owned entries in both old files, when `status`/`doctor` run, then they are reported. When `apply` runs, then they move through the protocol with foreign bytes intact, and both failure branches leave no entry lost.
- AC 44.2.5: Given the edited docs, when a reader looks for the VS Code targets, then every VS Code-specific text names the new targets. The provider-path limitation is documented, and the story record says no vsix is needed for the fix: the CLI change reaches the MCP Clients view through the npm `@1` release, and the README text reaches the Marketplace with the next vsix (DW-720).
- AC 44.2.6: Given D-5, when the build ends, then every listed hit carries a verdict and the build-time re-run found no unlisted hit.
- AC 44.2.7: Given a scratch-home certify run, when it passes, then the vscode record is re-dated with the human-only Copilot-session row marked with that date, and the D-6 runbook is handed to the owner.
- AC 44.2.8: Given task 1's capture, when the back-compat pins run, then the 14 other adapters, `CLIENT_DISPOSITIONS`, exit codes and envelope are unchanged, and the old-format fixtures still parse.
- AC 44.2.9: Given the CHANGELOG and changeset, when the release is planned, then they name `@iris-mcp/client-config` as the must-carry package and publish nothing.
- DW-721 (action item `epic-42-retro-item-11-charter-a-story-due-before-february-2027`): closed in delivery by tasks 2-12. The item itself closes at the Epic 44 retrospective, with the owner's confirmation.

## Spec Change Log

## Review Triage Log

## Design Notes

**D-1 Probe results (AC 44.2.1; 2026-11-22).** Sources:
- VS Code 1.147.0, commit `8a14f0cc1b08d531eb83255ea3764ae22aa932b5` (2026-11-17), the installed app bundle: `out/vs/platform/agentHost/node/agentHostMain.js` (AH), `out/vs/workbench/workbench.desktop.main.js` (WB), `out/nls.messages.json` (NLS);
- the docs, all fetched 2026-11-22: [CFG] code.visualstudio.com/docs/agents/reference/mcp-configuration (11/18/2026); [MIG] …/docs/agent-customization/migrate-customizations; [API] …/api/extension-guides/ai/mcp; [146] …/updates/v1_146; [CHG] github.blog changelog 2026-11-16; [GHCMD]/[GHDIR] docs.github.com Copilot CLI command and config-dir references.

No live Copilot-harness session was possible: it needs a signed-in Copilot user. No VS Code GUI was launched, because Electron's macOS `safeStorage` can touch the real login keychain.

- **V1 User file / Windows.** AH `nW(userHome, env) = env.COPILOT_HOME || join(userHome, ".copilot")`. `userHome` is the OS home, so on Windows the file is `%USERPROFILE%\.copilot\mcp-config.json`. An empty `COPILOT_HOME` falls back (`||`). No XDG lookup (confirmed by [GHDIR] "COPILOT_HOME replaces the entire ~/.copilot path"). Windows is from source only; not testable here.
- **V2 What is removed.** [146]: Local is "deprecated and will be removed in three months (February 2027)". The docs give no day. Local stays selectable until then ([MIG]).
- **V3 Forwarding, by source kind** (WB `qls`):
  - workspace `.mcp.json` and the Copilot-home file are `runtimeDiscovered`: the harness reads them itself;
  - `.vscode/mcp.json` entries are resolved first (`${env:X}` from VS Code's own environment), then forwarded, unless they need `${input:}`/`${command:}` (`requiresUserInteraction`, not delivered);
  - profile `mcp.json` entries are checked unresolved, so any variable (`${env:}` included) means `unresolvedConfiguration`, not delivered;
  - extension definitions are forwarded as provided, env verbatim (`PVn`). The resolver (`resolveServerLanch`) runs only on a Local start, so credentials added in `resolveMcpServerDefinition` are not forwarded (also [API]);
  - `envFile`, `dev` and sandbox are dropped. `cwd` is "not portable" but is forwarded.
  Docs agree ([CFG]: "the harness doesn't read those files directly"; "Configurations requiring `${input:...}` or `${command:...}` are rejected before variable resolution"). After February 2027 the docs say nothing about forwarding. It is not documented as temporary, so the story treats it as not guaranteed.
- **V4 The adapter's entries today.** User entries (`${env:…}` + `${input:iris-password}`) and project entries (`${input:}`) are therefore not delivered to Copilot sessions even now. Only `explicit`-mode user entries (literals) are.
- **V5 `${input:}` / password prompt.** There is no prompt and no secret bridge: [CFG] "no built-in MCP configuration option to forward a `${input:...}` secret"; [MIG] "Setting `password: true` on an input does not change this limitation". VS Code's own migration excludes password inputs (NLS 12179). The replacements are `${IRIS_PASSWORD}` from the environment the Agent Host inherits ([MIG]: restart the client after changing it), or `server-manager` mode (the server reads the OS keychain itself, AD-9). Neither writes a secret.
- **V6 Workspace `.mcp.json` with `chat.mcp.workspaceRootConfig.enabled` off.** It is still read:
  - the setting (default `true`, experimental) is used only by the Add-Server target picker (WB `A1.rootEnabled`, add-target code);
  - AH's `.mcp.json` discovery (`vse`/`GS`) has no setting check;
  - NLS 14933 and [CFG] say "Existing `.mcp.json` files remain available when this setting is off";
  - it inherits Workspace Trust ([MNG]).
- **V7 Name conflicts.** Not statically determinable for the whole chain:
  - across multiple roots, the first root's `.mcp.json` wins (AH `_mergeRootDefinitions`);
  - forwarded definitions are registered as session config (`sdkRegistration: "sessionConfig"`);
  - the Copilot CLI documents `.mcp.json` over `~/.copilot/mcp-config.json` ([GHCMD]);
  - VS Code's own registry disables lower-priority duplicates (`chat.mcp.collisionBehavior`, default `disable`).
  The design does not depend on precedence: the migration removes the old entry after the new one is verified, and status/doctor report a server present in both old and new files. D-6 has the human check.
- **V8 Formats.** AH validates the Copilot-Global file with `JSON.parse` (strict). Its stdio keys are `type`, `command`, `args`, `env`, `cwd`, and `${input:` is refused (NLS 4768-4773). VS Code's Copilot-Global writer emits `{type:"stdio",command,args,tools:["*"],env}` (AH `ru`). [GHCMD] marks `tools` required for local servers. AH's `.mcp.json` reader accepts entries without `type` (command means stdio) and tolerates trailing commas. VS Code's own `.mcp.json` add form rejects `cwd`, `inputs` and `${…}`, but reading does not.

**Corrections for the lead (Rule #42; the epic text is not edited here).**
1. AC 44.2.8: there are 15 adapters, so "the other 15" is "the other 14" (`adapters.test.ts:23`).
2. AC 44.2.1 "What it forwards": profile `mcp.json` entries with any unresolved variable (`${env:}` included) are not forwarded, not only `${input:}`/`${command:}` ones (V3). Extension definitions are forwarded without what `resolveMcpServerDefinition` adds.
3. AC 44.2.5: the extension's provider path loses its connection settings and credentials under the Copilot harness. That is recorded as `deferred` (a vsix fix, DW-720), not fixed here.

**D-2 Shared-file rule (AC 44.2.3), as refined.** The draft AD-30 text read literally ("any other entry under that name is a conflict") would turn a Claude-Code-only user's re-apply with a new mode from a replace into a refusal. AD-15 "Unused features" forbids that, so it selects the sole-owner reading in Boundaries. Equality is as a JSON value rather than byte-for-byte, so a hand-reformatted identical entry is adopted rather than refused (a superset of byte-identical; nothing is written either way). **For the lead (Rule 20), the AD-30 "Shared files" bullet's replacement text:**
> - **Shared files** *(Story 44.2)*. When two adapters target one file (a workspace-root `.mcp.json` is both Claude Code's and VS Code Copilot's project file), entries are owned per server name, not per client. A write for one client updates an entry as before only when that client alone owns it (its ledger records it and no other sharing client's does; for an adapter that already wrote the file before it was shared, an unrecorded canonical entry also counts). Otherwise an entry equal as a JSON value to the one it would write is adopted without a write, and any other entry under that name is a conflict that refuses the write. A disable or remove for one client warns that the other client reads the same file. `detect`, `status` and `doctor` show the file under both clients without counting it twice.

**D-3 Governing ADs (Rule 6).**
- AD-30: the protocol, ownership, shared files, home guard.
- AD-9: the credentials rule (no literal without FR141's confirmation); the Server Manager keychain channel replaces the prompt.
- AD-15: unused features byte-identical, additive fields, `toEqual` pins.
- AD-29: the `@1` pin; no publish; the vsix is lockstep and its store release is outside this story.
- AD-2: client-config stays dependency-free of the servers; the extension keeps its literal `@1` copy.
- Conventions: Probes and references, TypeScript files, Turbo test tasks, Logging.
No AC contradicts an AD's Rule. D-2 refines AD-30's draft bullet, which the proposal (§4.3e) expressly allows.

**D-4 Integration ACs / Consumes / Consumed-by (Rules 1-2).** `shared-files.ts` and `legacyScopes` are new shared components.
- Consumers in this story:
  - the `iris-mcp-clients` CLI process (task 9, a real child process against the built dist);
  - the extension's MCP Clients view, which renders the CLI's JSON paths (no extension code change; its mirror test is updated).
- Consumes: the `claude-code` adapter's project scope; VS Code's Copilot-harness file contract (D-1).
- Consumed-by: the AC 44.2.7 owner certification (D-6), and the epic's end-of-epic release (`@iris-mcp/client-config`).

**Extend, don't copy (Rule 2).** The vscode user/project scopes extend the `claude-code` `envOverride` pattern. `copilot` reuses the `standard` renderer. Shared-path detection reuses `home-guard.ts` `samePath`. The old-file readers reuse the existing JSONC reader and the `vscode` doctor branch. The migration reuses `remove`'s removal edits. No copy is planned.

**D-5 Enumeration (AC 44.2.6, exhaustive as of 2026-11-22; excludes `node_modules`, `dist`, `.git`, `irislib`, `irissys`, `_bmad*`, `.claude`).** Verdict key: **M** = move to the new target/shape; **L** = keep as an old-file (legacy) fixture or reader; **D** = doc edit; **H** = history, leave as is; **U** = unrelated.
- `.vscode/mcp.json`: `adapters.ts:176-178` M (to `legacyScopes`); `home-guard.test.ts:304,307` M; `packages/client-config/README.md:309` M (regenerated); `docs/client-config/README.md:80,163` D; `fixtures/sandbox-project/.vscode/mcp.json` L.
- Profile `mcp.json` / `Code/User`:
  - M: `adapters.ts:197` (detection keeps `appDir`); `golden.test.ts:106` (cline `:107` U); `byte-preservation.test.ts:53` (`:52` cline U); `clients-cli.test.ts:560,564,1056,1060`; `clients-cli-process.test.ts:149-155`; `qa-33-5-process.test.ts:116,134`; `README.md:309-311,400,418`;
  - L: `adapters.ts:24-26` (also U, kept for cline/roo-code); `detect.test.ts:142-143`; `clientsView.test.ts:84`;
  - certify: `certification-results.json:76` is re-certified (`:107` cline U);
  - U: `docs/client-config/README.md:209` (cline); `clients-cli.test.ts:532`; and the `settings.json` hits in `README.md:178`, `packages/shared/src/profiles.ts`, `server-discovery.ts` and their tests.
- `servers` root key:
  - M: `adapters.ts:162`; `types.ts:103` (comment); `adapters.test.ts:81,87`;
  - L: `readers.test.ts:456`; `clients-cli-process.test.ts:664`; `byte-preservation.test.ts:298-335`; `e2e.test.ts:552`; `qa-33-5-unit.test.ts:96`; `clients-cli.test.ts:561,1057`; the `golden/vscode*`, `drift/wrong-shape.jsonc`, `vscode/user.jsonc` and sandbox fixtures (each test is re-pointed at a legacy read or a new-shape golden; the implement stage records which);
  - U: `status.ts:141` and the extension `irisMcpLauncher.servers` setting hits.
- `${env:`:
  - M: `synthesize.ts:12,131,134`; `types.ts:69`; `cli/clients.ts:460`; `synthesize.test.ts:6,83,85`; extension `clientsEngine.test.ts:352,362`;
  - L: `cli/clients.ts:1543,1557` (the doctor's old-file branch).
- `${input:`:
  - M: `synthesize.ts:14,206`; `synthesize.test.ts:86,103`; `engine-e2e.test.ts:380-398`; `clients-cli.test.ts:568`;
  - L: `cli/clients.ts:1546,1566`; `golden/vscode/stage-1,3`; `vscode/user.jsonc:17`;
  - D: `packages/client-config/README.md:288`; extension `README.md:260`; `docs/client-config/README.md:177`;
  - H: `CHANGELOG.md:44`.
- `inputs`:
  - M: `engine.ts` `ensureInputs` (unreachable; keep or delete, recorded); `cli/clients.ts` apply/preview lines;
  - L: `byte-preservation.test.ts:294-345`; the `sandbox-project/.vscode/mcp.json` and `vscode/user.jsonc` fixtures;
  - D: `certify.mjs:481-483` and `README.md:347-350` (the not-rolled-back note);
  - kept: extension `clientsEngine.ts:519` (`inputsMerged` stays);
  - U: `diff.ts`, `state.ts`, `governanceEngine.ts`, `diff.test.ts`, `qa-33-5-unit.test.ts`, `readers.test.ts`;
  - H: `docs/bugs-2026-08-14.md`.
- `mcp-config.json` / `COPILOT_HOME` / `.copilot`: no hits before the story.
- Certification rows: the vscode record is M (AC 44.2.7); the cline/roo-code records are U.

**D-6 Owner runbook (human-only, AC 44.2.7; pair it with `epic-43-decision-sheet-item-1-…`).**
1. Setup:
   - VS Code ≥ 1.146, signed in to Copilot, the Copilot harness selected (the default);
   - a throwaway IRIS (`node scripts/throwaway-iris.mjs up …`), never shared data;
   - a throwaway project folder, trusted.
2. From the built repo, run `node packages/client-config/dist/cli/clients-cli.js apply --client vscode --scope project --server iris-dev-mcp --mode server-manager`, or `--mode env-reference` with `IRIS_*` exported in the shell that then runs `code .`. Open a new Copilot chat. Expect `iris_*` tools listed and one `iris_server_info` call to succeed.
3. Repeat with `--scope user` and `COPILOT_HOME` unset. Expect `~/.copilot/mcp-config.json` (Windows: `%USERPROFILE%\.copilot\mcp-config.json`). Expect the same result.
4. Precedence (V7): put `iris-dev-mcp` in both files with different `IRIS_NAMESPACE`, call `iris_server_info`, and record which namespace answers.
5. Forwarding (V3/V4): put an old `${input:}` entry in `.vscode/mcp.json` and an old `${env:}` entry in the profile `mcp.json`. Expect both absent from the Copilot session.
6. Provider (deferred item): enable the launcher's servers. Record whether they connect.
7. Record the outcome, dated, in the vscode record of `packages/client-config/scripts/certification-results.json`: clear `humanOnly` on a pass, or keep it with the failure in `residualRisk`. Rebuild, then run `node packages/client-config/scripts/render-certification-table.mjs`. Expected per source: steps 2-3 pass, step 5 shows both absent, step 6 fails to connect.

**Release handoff (AC 44.2.9).** The end-of-epic release must carry `@iris-mcp/client-config` (the CLI the MCP Clients view runs through `npx -y -p @iris-mcp/client-config@1`). The fixed version group carries the others. A new vsix is not needed for the fix. The changed extension README reaches the Marketplace only with the next vsix (DW-720, out of scope).

## Verification

**Commands:**
- (loop) `pnpm turbo run build --filter @iris-mcp/client-config` (timeout 600000) -- expected: success.
- (loop) `pnpm --filter @iris-mcp/client-config exec vitest run src/__tests__/adapters-44-2-backcompat.test.ts src/__tests__/shared-mcp-json.test.ts src/__tests__/vscode-copilot-targets.test.ts src/__tests__/synthesize.test.ts src/__tests__/adapters.test.ts src/__tests__/home-guard.test.ts` (timeout 600000) -- expected: green.
- (loop) `pnpm --filter @iris-mcp/client-config exec vitest run src/__tests__/clients-cli-process.test.ts src/__tests__/byte-preservation.test.ts src/__tests__/golden.test.ts` (timeout 600000) -- expected: green.
- (loop) `node packages/client-config/scripts/render-certification-table.mjs --check` -- expected: exit 0.
- (once) `pnpm --filter @iris-mcp/client-config test` (timeout 600000) -- expected: green.
- (once) `pnpm --filter iris-mcp-launcher test` (timeout 600000) -- expected: green.
- (once) `pnpm --filter @iris-mcp/all test` (timeout 600000; split by file if it does not finish) -- expected: green.
- (once) `pnpm run lint`, `pnpm run type-check`, `pnpm gen:governance-baseline:check`, `pnpm run gen:ipm:check` (one command each) -- expected: pass; baseline unchanged at `1e62c5ad5bf7`/141; IPM tree unchanged.

**Mutations (Rule 19; the implement stage writes each `mutation:` line):**
- AC 44.2.2: `envExpansion` back to `vscode` -> `vscode-copilot-targets.test.ts` default-write row red.
- AC 44.2.3: drop the sole-owner check -> the conflict row red; make claude-code conflict on an unrecorded entry -> the claude-only `toEqual` red.
- AC 44.2.4: remove the old entry before the new write -> the "new write fails" branch red.
- AC 44.2.8: edit one other adapter's `restartHint` -> `adapters-44-2-backcompat.test.ts` red.
- Integration (task 9): skip the `sharedWith` dedup -> the process test red.

**Shared surfaces:**
- the `CLIENT_ADAPTERS` vscode record and `ADAPTER_DATA_VERSION`;
- the generated README tables;
- `scripts/certification-results.json` (vscode) and `BASELINE_CERTIFIED_LIVE_DIGESTS`;
- the `golden/vscode*` and sandbox fixtures, including `sandbox-project/.mcp.json`, which claude-code tests read;
- the CLI help text (mirrored by the extension test);
- doctor check names;
- the status/detect output (`sharedWith`, `legacy`);
- the `CHANGELOG.md` `[Unreleased]` sections (the 44.1 doc-claims test finds its section by title).

Standing criterion: every test added or changed passes on a fresh environment, in either order.

## Auto Run Result

Status: ready-for-dev
Blocking condition: none

Plan stage (2026-11-22): the spec meets the READY FOR DEVELOPMENT standard and the run halted after planning, as instructed. Nothing was implemented or committed.

For the lead:
- the AD-30 "Shared files" replacement text (D-2, Rule 20);
- three epic-text corrections (D-1, "Corrections for the lead");
- one `deferred:` item (the extension provider path) to harvest;
- the owner runbook (D-6).
