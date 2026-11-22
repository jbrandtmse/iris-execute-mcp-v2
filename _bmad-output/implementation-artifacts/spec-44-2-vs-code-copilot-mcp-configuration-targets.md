---
title: 'Story 44.2: VS Code Copilot MCP Configuration Targets'
type: 'bugfix'
created: '2026-11-22'
status: 'done'
baseline_revision: '05e37579f45f3dd0ba8d509b7dea04db95dffbe2'
baseline_commit: '05e37579f45f3dd0ba8d509b7dea04db95dffbe2'
review_loop_iteration: 1
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
  - summary: >-
      The changeset is `patch` but the change removes four public exports of `@iris-mcp/client-config` (`ensureInputs`, `presentInputIds`, `VscodeInput`, `VSCODE_PASSWORD_INPUT_ID`).
    evidence: |-
      `packages/client-config/src/index.ts` no longer exports them (Spec Change Log 3). No in-repo consumer remains, but an external importer breaks on a patch upgrade. Task 12 fixes `patch` and leaves a raise to `minor` to the lead; the package sits in a fixed version group, so a `minor` moves every server's version too.
    location: '.changeset/story-44-2-vs-code-copilot-mcp-configuration-targets.md'
    severity: medium
  - summary: >-
      `doctor`'s orphaned-stashes check resolves each stash's file from the current directory, not from the stash's recorded path, so a stash recorded for another project's `.mcp.json` is checked against this project's file.
    evidence: |-
      `cli/clients.ts` (check 4) calls `resolveScopePath(adapter, stash.scope, ctx, ...)` for every stash. Before the per-file records a slot held one stash for the same cross-project reading, so the behavior is not new; now that records carry `path`, the check can use it. Needs a decision on what a stash of a file that no longer exists should report.
    location: 'packages/client-config/src/cli/clients.ts:1731-1745'
    severity: low
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

### Review Findings

Code review 2026-11-22 (full mode, layers Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor; all four delivered). 28 rows (counted from this list): high 1, medium 8, low 18, false 1; 17 patched, 5 deferred to the ledger (1 escalated, 4 `wontfix-accepted`), 6 rejected. Each row: severity, fix-risk, footprint, disposition.

- [x] [Review][Patch] **HIGH** The MCP Clients view previews only `diff --json` `servers[].text`, so the old-file removal of a vscode apply was confirmed without its diff (AD-30 "diff preview before confirmation"; the AD binds the view) [packages/client-config/src/cli/clients.ts cmdDiff] — fix-risk low (CLI-only, additive text), in-story. Each old-location removal is now also appended to the text of the first server it removes, so the released vsix's view shows it through the npm `@1` CLI with no extension change; `legacy` stays in the envelope. (blind-hunter)
- [x] [Review][Patch] MED DW-732: the `patch` changeset removed four public exports [packages/client-config/src/index.ts] — fix-risk low, in-story. New `src/deprecated.ts` keeps `ensureInputs`, `presentInputIds`, `VscodeInput`, `VSCODE_PASSWORD_INPUT_ID` (and `EnsureInputsResult`) as working `@deprecated` exports; `SynthesisResult.inputs?` is back as a deprecated never-set field; changeset and CHANGELOG say "deprecated". Pinned by `deprecated-exports.test.ts`. Ledger DW-732 resolved. (acceptance-auditor+blind-hunter)
- [x] [Review][Patch] MED A pre-move vscode user stash with no `${env:`/`${input:` references (explicit or server-manager mode) was enabled into `~/.copilot/mcp-config.json` in the old `{command,args,env}` shape, with no `type` or `tools` [packages/client-config/src/engine.ts isPreMoveStash] — fix-risk low, in-story. `isPreMoveStash` also treats a user-scope stash without `type`/`tools` as pre-move: `enable` refuses it (stash kept), `apply` drops it, doctor reports it; the test that pinned the old behavior was replaced. (acceptance-auditor+blind-hunter+edge-case-hunter)
- [x] [Review][Patch] MED vscode was not detected from an old `.vscode/mcp.json` alone (no Code app folder, e.g. a remote host), so status and doctor reported nothing (AC 44.2.4) [packages/client-config/src/detect.ts detectionProbes] — fix-risk low, in-story. The adapter's legacy files are now config probes with an additive `legacy: true`. (verification-gap)
- [x] [Review][Patch] MED No test of a failed old-file sweep on `remove` (exit 1) [vscode-copilot-targets.test.ts] — fix-risk low, in-story. Test added. (verification-gap)
- [x] [Review][Patch] MED The apply confirmation gate's new terms (legacy-only edit; adopt-only) were untested [vscode-copilot-targets.test.ts] — fix-risk low, in-story. Two tests added; the legacy-only one drives an adopt plus an old-file removal so the term is isolated. (verification-gap)
- [x] [Review][Patch] MED "strict JSON at every stage" passed even if every operation refused [qa-44-2-shared-lifecycle.test.ts] — fix-risk low, in-story. Each stage now asserts `ok`, `changed` and the entry set, and `remove` runs too. (verification-gap)
- [x] [Review][Patch] MED Rule 2 near-copies: `previewLegacyRemoval` and `withLegacyRemoval` repeated the file-selection and parse code; `cli/clients.ts` `recordedByAny` repeated `shared-files.ts` `ownerClients`' filter [packages/client-config/src/engine.ts, src/cli/clients.ts] — fix-risk low, in-story. One `legacyTargets` step and one exported `recordingClients` now serve both sides (messages unchanged). (review lead)
- [x] [Review][Defer] MED DW-733 / path-less ownership ledger [packages/client-config/src/state.ts:123-135] — deferred: fix-risk high (a file path on records changes the spec §3.4 state shape pinned by `engine-e2e.test.ts`, plus per-file record/drop/stash semantics). Probed on the built CLI with a scratch HOME: a claude-code mode change in project B (VS Code never configured there) exits 1 "shared with vscode" because of a vscode record from project A; Edge Case Hunter adds pre-move vscode records from `.vscode/mcp.json` and a vscode sole-owner overwrite. The CHANGELOG claim is corrected with the limitation and the one-shot workaround (probed). Ledger DW-733 `escalated owner=burndown`, occurrence appended. (blind-hunter+edge-case-hunter)
- [x] [Review][Patch] LOW Strict-file refusal did not say why (QA finding 2) [packages/client-config/src/readers.ts] — patched: the error adds "this file is read with JSON.parse, so it must be strict JSON (no comments, no trailing commas)".
- [x] [Review][Patch] LOW Fix commands: doctor printed `--servers <the server names>`; the enable refusal printed a bare `iris-mcp-clients` and omitted `${command:` — patched (real names; the pinned `npx -y -p @iris-mcp/client-config@1` form; `${command:...}` named). (blind-hunter)
- [x] [Review][Patch] LOW `restore` of a shared `.mcp.json` rolls back the whole file without naming the other reader [packages/client-config/src/engine.ts restore] — patched: `sharedWith`/`sharedNote` on the same rule as disable/remove (claude-code silent until a peer has records). (edge-case-hunter)
- [x] [Review][Patch] LOW `~/.copilot/mcp-config.json` is also the GitHub Copilot CLI's config and the docs did not say so [docs/client-config/README.md] — patched (one sentence). (blind-hunter+edge-case-hunter)
- [x] [Review][Patch] LOW Duplicated path key and shared marker in the CLI (status count, doctor `firstVisit`, `cmdDetect`) [src/cli/clients.ts] — patched: `home-guard.ts` `pathKey` (shared with `samePath`), and `sharedMarker` reused. (blind-hunter)
- [x] [Review][Patch] LOW The old-file sweep removed any name in `names`, so a foreign non-canonical entry could go through the engine API (a cast past the `CanonicalEntry` type) [engine.ts legacyTargets] — patched: only canonical names are swept, matching what `status` reports. (edge-case-hunter)
- [x] [Review][Patch] LOW The QA "a second apply is a no-op" label overclaimed: a re-apply is an in-place update with a backup, exactly as for claude-code (probed) [qa-44-2-vscode-process.test.ts] — patched: asserts `.mcp.json` byte-identical and no further old-file backup; title corrected. (verification-gap)
- [x] [Review][Patch] LOW `certify.mjs run vscode` followed an exported `COPILOT_HOME` past the scratch HOME [packages/client-config/scripts/certify.mjs] — patched: the vscode pass refuses (exit 2) while `COPILOT_HOME` is set; probed with scratch dirs. (verification-gap)
- [x] [Review][Patch] LOW Mutation lines missing for the review-pass pins and misplaced for QA's (Rule 19) — closed in this pass: see `## Verification`. AC 44.2.8 keeps its one mutation (Rule 19 is one per AC). (verification-gap)
- [x] [Review][Defer] LOW BOM accepted in the strict user file (QA finding 1) — deferred: unverified whether the Agent Host strips a BOM; ledger DW-734 `wontfix-accepted`.
- [x] [Review][Defer] LOW A peer's ledger record outlives a shared-file remove (QA finding 3) — deferred: dropping peer records is unsafe while records carry no path; ledger DW-735 `wontfix-accepted` (reopen with DW-733).
- [x] [Review][Defer] LOW doctor labels a shared-file finding with the first client in registry order (QA finding 5) — deferred: ledger DW-736 `wontfix-accepted`.
- [x] [Review][Defer] LOW The oracle capture scripts the pre-44-2 fixtures cite are not in the repository — deferred: ledger DW-737 `wontfix-accepted`. (acceptance-auditor)

Rejected:
- `false` Blind Hunter: spec frontmatter `status: done` vs sprint `review` — the frontmatter is build-auto's machine state; the sprint tracker is the review state.
- `low` Edge Case Hunter: `COPILOT_HOME` with `~` or a relative path — VS Code does not expand it either (probe V1), the `CLAUDE_CONFIG_DIR` override behaves the same, and a guard adds a branch for an unusual setting.
- `low` Edge Case Hunter: `status` reports only canonical names in old files — the CLI writes only canonical names; the sweep now matches it.
- `low` Edge Case Hunter: a claude-code disable/remove with no peer record is silent — spec-bound (`by-design`): the AD-15 byte-identical bound in Boundaries and the earlier triage.
- `low` QA finding 4: a whitespace-only line after removing the last legacy entry — parity with the pinned pre-story claude-code behavior.
- `low` Blind Hunter: the view shows no `legacy`/`sharedWith` status rows — the view's doctor run lists the old-location finding; rendering more needs extension code.

### Rework (iteration 1 of 3; lead re-open 2026-11-22, wave-9 decision #135)

The review's DW-733 deferral is overruled: the lead reproduced it on the built CLI with a scratch HOME (vscode `apply --scope project` in project A, then a claude-code mode change in project B, where VS Code was never configured, exits 1 "the file is shared with vscode"). That breaks the Boundaries' back-compat bound ("`claude-code` behavior on a `.mcp.json` that no `vscode` record touches is byte-identical to before") and AD-15, so it is a HIGH that cannot ship. Work ONLY these items:

- [x] [Review][HIGH] DW-733: shared-file ownership must be per file, not per (client, scope, name) [packages/client-config/src/state.ts, src/shared-files.ts, src/engine.ts]. Record the resolved absolute config path on every ownership and stash record this story's code writes, as an ADDITIVE optional field (old state files still parse; AD-15 additive fields; update the documented state shape that `engine-e2e.test.ts` pins only by adding the optional field). For the shared-file rule, a peer client's record counts as a sharing owner only when its recorded path is the same file (`home-guard.ts` `samePath`/`pathKey`). A record without a path (written before this story, or by a pre-44.2 vscode `.vscode/mcp.json` write) never counts as a peer owner of a `.mcp.json`. claude-code's existing rule (an unrecorded canonical entry counts as its own, AD-15) stays. Pins, on the built CLI as a child process under a scratch HOME where stated:
  - the lead's repro (vscode in project A, claude-code mode change in project B) exits 0 and writes exactly what pre-44.2 claude-code wrote (compare with the pre-story claude-code oracle), both directions (claude-code in A, vscode in B too);
  - a pre-44.2-shaped vscode project record (no path) does not block claude-code in any project;
  - a genuinely shared file (both clients, same project) still adopts an equal entry and refuses a differing one, both directions;
  - an old state file without paths parses and behaves as before;
  - a `mutation:` line for each pin (Rule 19).
- [x] [Review] DW-735 (peer record outlives a shared-file remove; `wontfix-accepted` "reopen with DW-733"): with per-file records, re-check it. Fix it in this pass only if it is now a two-way door (about 15 lines with its test); otherwise leave it as filed and say why in `## Auto Run Result`.
- [x] [Review] `CHANGELOG.md` and the docs: remove the DW-733 limitation and its workaround text once the fix lands.

## Spec Change Log

Implement stage, 2026-11-22 (no change to the `<intent-contract>`; every item below is a build decision or a claim the build found wrong):

1. **Wrong claim (AC 44.2.1): `format: "json"` does not make a file strict.** The Boundaries and the matrix row "Strict JSON user file" assume that a `json` adapter refuses a comment or a trailing comma. It does not: `readers.ts` parses every `json` and `jsonc` file with `allowTrailingComma: true, disallowComments: false` (the pre-story claude-code oracle accepts the comment-bearing `.mcp.json` fixture). The refusal needed new data: optional `ScopeDef.strictJson` and a matching `ClientAdapter.strictJson` that `paths.ts` `adapterForScope` projects for one scope, set only on the vscode user scope, and honored by the JSON reader. The shared project `.mcp.json` stays as tolerant as claude-code's, as the matrix row requires. This widens task 2 by one optional type field; no other adapter's data moves (pinned by `adapters-44-2-backcompat.test.ts`).
2. **Spec tension (AC 44.2.3): "claude-code's results are `toEqual` the pre-story oracle" cannot hold for `status` and `detect` rows.** The spec's own matrix puts the shared file under both clients with a `sharedWith` marker, and the vscode adapter's project probe is `.mcp.json`, so any project with a `.mcp.json` now lists vscode as detected. The oracle therefore pins `apply`, `disable`, `enable`, `remove` and the doctor findings of claude-code exactly, and the claude-code status row except the additive `sharedWith` field (`shared-mcp-json.test.ts` strips it and says so).
3. **Dead code deleted instead of kept (task 4, D-5 `inputs`, Rule #54).** `synthesize.ts` lost the `${env:` branch of `referenceForm` and the inputs branch (no adapter has `envExpansion: "vscode"` outside the read-only legacy scopes, which are never synthesized). `engine.ts` lost `ensureInputs` and `presentInputIds`, whose body was unreachable once the gate (`envExpansion !== "vscode"`) refused every roster adapter, and `synthesize.ts` lost `VscodeInput`, `VSCODE_PASSWORD_INPUT_ID` and `SynthesisResult.inputs`. The package's public `index.ts` no longer exports those four names: a removal from a published API in a `patch` changeset, which the lead may raise to `minor` (AC 44.2.9 allows it). The CLI keeps `inputsMerged: []` and `missingInputIds: []` in its envelopes, because the extension's types require both. The doctor's old `vscode` expansion branch (`cli/clients.ts:1543,1557`, D-5 verdict L) was deleted for the same reason; the new `vscode-local-harness-entries` check reports owned entries in the old files without scanning their references.
4. **Task 3 and 7 detail.** The new `legacyScopes` data is `{scope, paths, format, rootKey, envExpansion}`; `paths.ts` adds `adapterForScope`, `legacyAdapterView` and `resolveLegacyPath`, and the engine reads and edits an old file through that view (backups under `backups/vscode-legacy/<scope>/`, so `restore --client vscode` can never pick an old-file backup). New engine surface: `previewLegacyRemoval`, `sharedWriteVerdict`, `holdsLegacyReferences`, `EngineResult.adopted|sharedWith|sharedNote|legacy`. A failed old-file edit is exit 1 from the CLI (`the new entry was written, but ... still in the old file`), after the new entry was kept; a refused conflict is exit 1 before any write. The matrix's `--server iris-dev-mcp` is the CLI's `--servers` for apply and `--server` for the toggles.
5. **Certify harness (task 10).** `certify.mjs` now applies the vscode entry in the default env-reference mode: the dummy-password explicit mode existed only because the old env-reference write also merged an `inputs[]` descriptor that `remove` does not roll back. The record was re-run with a scratch `HOME`/`USERPROFILE`, `COPILOT_HOME` unset and a scratch working directory (the pass's `status` reads the project `.mcp.json` of the directory it runs in, and this repository may hold one). The `humanOnly` marker is kept, re-dated 2026-11-22, and points at the D-6 runbook.
6. **Ledger limit, not fixed.** The ownership ledger is keyed `(client, scope, name)` with no file path, so a claude-code project record made in one project also counts as an owner in another project's `.mcp.json`. The shared-file rule inherits this; it can only make vscode adopt-or-conflict where a stricter, path-keyed ledger would write. Pre-existing keying, out of scope here.

7. **Ledger limit fixed (rework 1, DW-733; supersedes item 6).** `ManagedEntryRecord` and `StashRecord` gain an additive optional `path` (the resolved config file). No state-file version change; an older file parses, and its pathless records are never read as a peer's owner record of a shared file. `state.ts` keys a slot by `(client, scope, name)` plus the file: records of one slot for two files coexist, a ledger call that names a file (`RecordFile`) matches the records for that file and the pathless ones, and a call without one matches all (the old behavior, for the pure state tests). `shared-files.ts` `recordingClients` takes the file: a record with a path counts only for the same file (`samePath`); a pathless record counts for X itself only when the scope is unshared or X is a pre-sharing writer (claude-code), and never for a peer; so a pre-44.2 vscode record never makes vscode a sole owner of a `.mcp.json` entry either. `ownerClients`, `soleOwner` and `otherOwners` take the file as a final argument (the module is new in this story, unreleased). `dropRemovedShared` is new: a remove also drops the peers' manager records for the same file (their stashes stay). Doctor's `unrecorded-entries` and `--repair` use the same file.

## Review Triage Log

### 2026-11-22 — Review pass
- verdicts: 35 findings — high 0, medium 11, low 22, false 2, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind-3: after vscode adopts an unrecorded claude-code entry, vscode becomes sole owner and a later vscode apply rewrites it — the literal D-2 / Boundaries sole-owner rule (spec-bound; closing by-design); reopen_if a spec amendment adds a persistent implied owner.
  - `[low]` `[reject]` Blind-4: disable and remove state the shared-file effect after the write, not before — the Boundaries say "proceeds and says"; spec-bound.
  - `[low]` `[reject]` Blind-5 and Edge-8: every project with a `.mcp.json` now detects VS Code — task 3 prescribes the project config probe, and Spec Change Log 2 records it; spec-bound.
  - `[low]` `[reject]` Blind-6 and Edge-9: `disable` leaves old-file entries and old-file backups are not selectable by `restore` — the spec scopes the old files to `apply`/`remove`; recovery is the timestamped backup; not worth more than a note.
  - `[low]` `[reject]` Blind-7 and Intent-3: legacy removal matches by canonical name, not ledger — the same ownership model `apply` uses for the new file (`ownershipRefusal`); consistent with AD-30.
  - `[medium]` `[defer]` Blind-1 and Edge-10: a `patch` changeset removes four public exports — the spec task 12 fixes `patch` and leaves a raise to `minor` to the lead; deferred to the lead (frontmatter).
  - `[medium]` `[patch]` Blind-2 and Edge-1: the `apply` the refusal and doctor advise never dropped the pre-move stash — `record` in `engine.ts` `apply` now drops a legacy-reference stash; pinned by a new test.
  - `[low]` `[patch]` Blind-8, Verification-gap-9: doctor read an unparseable strict file and the stash check through the unscoped adapter — both calls now use `adapterForScope` (`cli/clients.ts`).
  - `[false]` `[reject]` Blind-9: scratch path in the certification record — the existing claude-code and cline records already carry the same scratch-home form.
  - `[low]` `[patch]` Blind-10: Claude Code users are not told the project `.mcp.json` is shared — a paragraph added to the Claude Code section of `docs/client-config/README.md`.
  - `[medium]` `[patch]` Edge-2: the legacy-stash refusal ran after the missing-file no-op — moved before it; pinned by a new test.
  - `[low]` `[patch]` Edge-3: `previewLegacyRemoval` did not guard a null native edit or a throw — guarded like `withLegacyRemoval`.
  - `[low]` `[reject]` Edge-4: an unparseable unrelated old file makes `apply` exit 1 — the manager cannot confirm that no owned entry remains in it, and the new write already succeeded; reopen_if a user reports a broken old file blocking apply.
  - `[low]` `[reject]` Edge-5: the doctor fix command omits `--mode`/`--yes` — wording only; the command names the server and scope.
  - `[low]` `[reject]` Edge-6: one pre-move stash can raise an orphaned-stash and a legacy-stash finding — cosmetic duplicate.
  - `[medium]` `[patch]` Edge-7 and Edge-11: a vscode disable or remove of an entry only vscode records says nothing about Claude Code reading the file — `withSharedNote` now names the other readers for a client that never wrote the file before sharing; claude-code stays silent until another client records the entry (the byte-identical back-compat bound); the old vscode-silent test was replaced.
  - `[medium]` `[patch]` Verification-gap-1: no test of `enable` into a shared file — conflict and equal-entry tests added.
  - `[medium]` `[patch]` Verification-gap-2: claude-code as the refused party, and `adopted:true` for the reverse adoption, were unpinned — tests added.
  - `[medium]` `[patch]` Verification-gap-3: the other-client stash back-compat test asserted nothing about another client — a claude-code `${env:` stash enable test added.
  - `[low]` `[patch]` Verification-gap-4: the CRLF assertion was constant 0 for LF fixtures — it now asserts the line-ending style survives for every fixture.
  - `[low]` `[patch]` Verification-gap-5: missing `mutation:` lines — written in `## Verification` for the new and changed pinning tests (AC 44.2.3, 44.2.4, 44.2.5, 44.2.7); AC 44.2.1/6/9 have no executable pin by design.
  - `[medium]` `[defer]` Verification-gap-6: the ledger has no file path, so a claude-code record from one project counts as a sharing owner in another's `.mcp.json` — pre-existing keying (Spec Change Log 6); deferred.
  - `[false]` `[reject]` Verification-gap-7: migration combined with the shared rule — with the entry absent from `.mcp.json` the write is a normal create, and with it present the shared rule is the intended behavior.
  - `[low]` `[reject]` Verification-gap-8: goldens captured from the engine's own output — the shape is grounded in probe V8 and the byte layout in the claude-code oracle.
  - `[low]` `[reject]` Verification-gap-10: no extension test for the new output fields — the fields are additive and the spec makes no extension change beyond the mirror test.
  - `[low]` `[reject]` Intent-1: no real Copilot session was exercised — AC 44.2.7 is a human row by decision; the file-level certify ran.
  - `[low]` `[reject]` Intent-2: doctor lists the shared file under the first client only — the spec requires it checked once; `status` and `detect` show it under both.
  - `[low]` `[reject]` Intent-4: a migration failure returns `ok:true` with warnings at the engine and exit 1 at the CLI — the spec's migration row keeps the new entry and reports the old one.

### 2026-11-22 — Review pass (rework 1)
- verdicts: 35 findings — high 0, medium 3, low 24, false 8, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind-1: the first write in another project replaces a legacy pathless record, so a non-canonical manager-created name loses its ownership elsewhere — reachable only for non-canonical names through the engine API (the CLI writes canonical names, which skip the ownership check); the fix adds a branch.
  - `[low]` `[reject]` Blind-2: `at` is optional on the `state.ts` ledger functions — every non-test caller passes it (grep of `src` outside `__tests__`); making it required rewrites the state unit tests for no reachable caller.
  - `[false]` `[reject]` Blind-3: the CHANGELOG omits the new required argument of `soleOwner`/`ownerClients`/`otherOwners` — `shared-files.ts` is new in this unreleased story, so no released signature changed.
  - `[medium]` `[patch]` Blind-4: `restore` repeats the per-file record filter inline instead of extending `shared-files.ts` (Rule 2) — patched: `peersRecordingFile` in `shared-files.ts`, used by `restore`.
  - `[low]` `[patch]` Blind-5: the DW-735 test name claims a stash check it does not make — retitled to the manager record; the stash unit stays.
  - `[low]` `[reject]` Blind-6: the process tests spawn `dist` with no freshness guard — the same convention as every process suite of the package; the loop commands build first.
  - `[low]` `[patch]` Blind-7: `COMPACT = ... ?? ""` fails silently — now throws when the oracle lacks the fixture.
  - `[low]` `[reject]` Blind-8: no win32 case for the path comparison — `pathKey` is the shared helper `home-guard.test.ts` already pins per platform.
  - `[low]` `[reject]` Blind-9: the CHANGELOG does not explain pathless records — it says a record written before this change never affects a Claude Code write, which is the user-visible rule.
  - `[low]` `[reject]` Edge-1: duplicate of Blind-2.
  - `[false]` `[reject]` Edge-2: `doctor --repair` records without a path when `finding.path` is null — every `unrecorded-entries` finding carries `scope.path`, which is non-null for a file that was read; a test now pins the recorded path.
  - `[low]` `[reject]` Edge-3: a corrupt `path` type in `state.json` throws — a hand-corrupted ledger; `wontfix-theoretical`, the ledger fields are unvalidated by design.
  - `[low]` `[reject]` Edge-4: duplicate of Blind-1.
  - `[low]` `[reject]` Edge-5: a moved `COPILOT_HOME` makes a record not match — only non-canonical names are affected; the duplicate of Blind-1's reasoning.
  - `[low]` `[reject]` Edge-6: records for dead paths accumulate — one small record per moved project; harmless and listed under the residual risks.
  - `[low]` `[defer]` Edge-7: `doctor`'s orphaned-stashes check ignores `stash.path` — not caused by this change (one stash per slot was read the same way); deferred, low.
  - `[false]` `[reject]` Edge-8: `doctor` flags a claude-code entry under vscode when it is visited first — claude-code is the first adapter in the registry and a pre-sharing writer, so it counts its own pathless record; vscode is the second visit and the file is checked once.
  - `[false]` `[reject]` Edge-9: a pathless peer record outlives the remove — it never counts for a peer, so it cannot cause the DW-735 symptom.
  - `[medium]` `[patch]` Edge-10: the `restore` filter differs from `recordingClients` — same root cause as Blind-4.
  - `[low]` `[reject]` Edge-11: the oracle-byte check covers one ledger state — the pathless state is pinned by the pre-44.2 test and each guard has a mutation line.
  - `[low]` `[reject]` Edge-12: a pathless record still satisfies `isManagerCreated` for any file — duplicate of Blind-1; the shared-file rule the item names is enforced.
  - `[false]` `[reject]` Edge-13: DW-735 is unclosed for pathless peer records — same refutation as Edge-9.
  - `[low]` `[reject]` Edge-14: slot-only matching for unshared scopes was removed — duplicate of Edge-5.
  - `[medium]` `[patch]` Verification-gap-1: no test of `restore`'s per-file filter — patched: a built-CLI test with a positive control (`peersRecordingFile` mutation below).
  - `[low]` `[patch]` Verification-gap-2: the `doctor --repair` path is unpinned — patched: a built-CLI repair round-trip asserting the recorded path.
  - `[low]` `[reject]` Verification-gap-3: no engine test for a non-canonical name recorded at another path — the unit pins `isManagerCreated` per file and the behavior is the design.
  - `[low]` `[patch]` Verification-gap-4: DW-735 test title and comment overclaim — fixed (same as Blind-5).
  - `[false]` `[reject]` Verification-gap-5: the mutation line for the pathless term may overclaim — re-run: dropping the term turned exactly the three named tests red.
  - `[low]` `[patch]` Verification-gap-6: a comment overclaims "byte for byte" and one assertion checks its own fixture — the comment is corrected; the fixture precondition stays, it guards the setup.
  - `[low]` `[reject]` Verification-gap-7: process pins need a fresh `dist` — duplicate of Blind-6.
  - `[low]` `[reject]` Intent-1: the process tests run on `dist` with no rebuild step shown — duplicate of Blind-6.
  - `[low]` `[reject]` Intent-2: no status/doctor assertion for another project's record — the doctor change is the `recordingClients` argument, pinned by its unit; the stash half is Edge-7.
  - `[low]` `[reject]` Intent-3: pathless records mean two things in `sameSlot` and `recordingClients` — duplicate of Blind-1; the split is the design (a legacy record never counts for a peer).
  - `[false]` `[reject]` Intent-4: `dropRemovedShared` leaves a pathless peer record — same refutation as Edge-9.
  - `[false]` `[reject]` Intent-5: `path` on every adapter's record changes the state file — an additive optional field; old files parse and `engine-e2e.test.ts` pins the new key.

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

**D-5 build-time re-run (AC 44.2.6, task 13; 2026-11-22, the seven patterns over `packages/client-config`, `extensions/iris-mcp-launcher`, `docs` and the root `*.md`, with the same exclusions plus `fixtures/` listed as files).** Every hit above took its recorded verdict, as built; the re-run found these hits that D-5 did not list:
- Root `README.md:264` (`${input:`, `inputs`: the "zero-secrets end state" item 3, "VS Code native inputs"): D, edited to the environment-reference text.
- `CHANGELOG.md:3262` (`inputs`, a 2026 entry describing the old env-reference upgrade) and `packages/client-config/CHANGELOG.md:44` (`inputs`, unrelated wording): H, history, left as is. `tool_support.md:192` (`inputs`, tool arguments): U.
- `extensions/iris-mcp-launcher/src/clientsEngine.ts`, `clientsPanel*.ts` and the extension tests: `inputs` hits are the unrelated "inputs the extension owns" wording and `missingInputIds` in three test fixtures and one type (kept: the CLI still emits `missingInputIds: []`): U / kept.
- Verdicts differing from D-5's as written: `clientsView.test.ts:84` (a detect fixture holding a profile `mcp.json` path) was M, not L: it now holds the new user-file path, because it mirrors what `detect` prints for vscode. `cli/clients.ts:1543,1557` (the doctor's old-file branch) was deleted, not kept (Spec Change Log 3). `certify.mjs:481-483` was M, not D (the comment went with the explicit-mode special case). The re-pointed tests: `readers.test.ts`, `diff.test.ts`, `e2e.test.ts`, `qa-33-5-unit.test.ts` read the old JSONC fixtures through `vscodeLegacyAdapter()` (L); `golden.test.ts` has new Copilot goldens (`golden/vscode`, `golden/vscode-compact`, captured from the engine) and the old ones under `golden/vscode-legacy*` driven through the legacy view (L); `byte-preservation.test.ts`, `engine-e2e.test.ts`, `clients-cli*.test.ts`, `qa-33-5-process.test.ts`, `status.test.ts`, `home-guard.test.ts`, `synthesize.test.ts`, `adapters.test.ts` moved to the new shape (M).
- The new hits this story's own files add are the intended ones: `adapters.ts` `legacyScopes` (`servers`, `${env:`-era paths: L), `engine.ts` `LEGACY_REFERENCE` and the enable refusal text (L), the new tests and their old-format seeds (L), the READMEs, `docs/client-config/README.md` and the CHANGELOG entry (D).

**D-6 Owner runbook (human-only, AC 44.2.7; pair it with `epic-43-decision-sheet-item-1-…`).**
1. Setup:
   - VS Code ≥ 1.146, signed in to Copilot, the Copilot harness selected (the default);
   - a throwaway IRIS (`node scripts/throwaway-iris.mjs up …`), never shared data;
   - a throwaway project folder, trusted.
2. From the built repo, run `node packages/client-config/dist/cli/clients-cli.js apply --client vscode --scope project --server iris-dev-mcp --mode server-manager`, or `--mode env-reference` with `IRIS_*` exported in the shell that then runs `code .`. Open a new Copilot chat. Expect `iris_*` tools listed and one `iris_server_info` call to succeed.
3. Repeat with `--scope user` and `COPILOT_HOME` unset. Expect `~/.copilot/mcp-config.json` (Windows: `%USERPROFILE%\.copilot\mcp-config.json`). Expect the same result.
4. Precedence (V7): put `iris-dev-mcp` in both files with different `IRIS_NAMESPACE`, call `iris_server_info`, and record which namespace answers.
5. Forwarding (V3/V4): put an old `${input:}` entry in `.vscode/mcp.json` and an old `${env:}` entry in the profile `mcp.json`. Expect both absent from the Copilot session.
6. Provider (deferred item; fixed by Story 44.6, owner ruling, wave-9 decision #134): enable the launcher's servers in the Copilot session, on the build that carries both 44.2 and 44.6. Record whether they connect and authenticate. The sitting waits for both stories.
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

Mutation evidence (implement stage, 2026-11-22; each mutation applied to the source, the named tests run, the file restored and `cmp`-checked byte-identical):
- mutation: AC 44.2.2 -- the user scope's `entryShape: "copilot"` set to `"standard"` in `adapters.ts` -> `vscode-copilot-targets.test.ts` "user scope, default" and "user scope in every mode" red (2 tests). The spec's own mutation, `envExpansion` back to `"vscode"`, was green in that row at first, because synthesis no longer branches on the expansion (the `${env:` branch is deleted): it was red only in `adapters.test.ts`. The default-write row now also asserts `vscode.envExpansion` is `"claude"`, and the same mutation is red there (1 test).
- mutation: AC 44.2.3 -- `soleOwner` skipped in `engine.ts` `sharedVerdict` (always a normal write) -> `shared-mcp-json.test.ts` red: adopt, conflict (CLI and engine), unrecorded-different and the equal-entry adoption (5 tests). `PRE_SHARING_WRITERS` emptied in `shared-files.ts` (claude-code conflicts on an unrecorded entry) -> red: the claude-only unrecorded-entry `toEqual`, the vscode-conflict/claude-replaces row and the ownership unit (3 tests). The unrecorded-entry oracle was added for this: captured from a dist built from `git archive 9f7797c5` (`capture-oracle-unrecorded.mjs`), because the five-fixture oracle never has an unrecorded canonical entry, so that mutation was first green there.
- mutation: AC 44.2.4 -- `withLegacyRemoval` called before `runEdit` in `engine.ts` `apply` -> `vscode-copilot-targets.test.ts` "the new write fails: the old file is untouched and gets no backup", the migration row and the old-file-edit-fails row red (3 tests).
- mutation: AC 44.2.8 -- the Cursor `restartHint` text edited in `adapters.ts` -> `adapters-44-2-backcompat.test.ts` "every other adapter record is toEqual its pre-story capture" red (1 test).
- mutation: Integration (task 9) -- the shared-file dedup of the `status` managed-entry count (`cli/clients.ts`) skipped, then the package rebuilt -> `clients-cli-process.test.ts` "status --json lists the shared project .mcp.json once per client with sharedWith, and counts the entry once" red (1 test, on the built bin). The source was restored and the package rebuilt; the process suite is green again (36 tests).

Mutation evidence (review pass, 2026-11-22; each applied to the source, the named tests run, the file restored and `cmp`-checked byte-identical):
- mutation: AC 44.2.3 (enable into a shared file) -- the conflict return in `engine.ts` `enable` disabled -> `shared-mcp-json.test.ts` "enable into a shared file ... refuses when the other client has since written a different entry" red (1 test).
- mutation: AC 44.2.3 (claude-code as the refused or adopting party) -- `sharedVerdict` returns `null` for `claude-code` -> "adopt in the other direction" and "conflict the other way: claude-code is refused" red (2 tests).
- mutation: AC 44.2.3 (shared disable/remove note) -- `withSharedNote` names only ledger owners again (the vscode-only-owner fallback removed) -> "the engine names the other reader even when only vscode records the entry" red (1 test).
- mutation: AC 44.2.4 (pre-move stash) -- the legacy-stash drop removed from `apply`'s `record` -> "the apply that the refusal advises drops the legacy stash" red (1 test); the `legacyScopes !== undefined` guard removed from the `enable` refusal -> "another client's stash that holds ${env:...} still enables" red (1 test); the refusal made to run only when the file exists -> "enable refuses the stash even when the new file does not exist yet" red (1 test).
- mutation: AC 44.2.5 (help text) -- the help line `${VAR} references` set to `${env:VAR} references` in `cli/clients.ts` -> `vscode-copilot-targets.test.ts` "the CLI help text names ${VAR} and never ${env:VAR}" red (1 test).
- mutation: AC 44.2.7 (re-dated marker) -- the vscode `markedOn` in `certification-results.json` set back to `2026-11-21` -> `qa-42-9-certification-gate.test.ts` "every humanOnly marker is dated the implementation date" and the table-sync control red (2 tests).
- AC 44.2.1, 44.2.6 and 44.2.9 have no executable pin by design: probe claims, a grep enumeration, and a changeset and CHANGELOG that the release step consumes (a test on a changeset file would fail after release).

Mutation evidence (code review, 2026-11-22; each applied with `perl -0pi`, the named test run with `-t`, the file restored from a copy and `cmp`-checked byte-identical):
- mutation: AC 44.2.9 / DW-732 -- the `./deprecated.js` re-export block removed from `index.ts` -> `deprecated-exports.test.ts` "the package entry point still exports the four names" red (1 test).
- mutation: AC 44.2.2 (pre-move stash shape) -- `isPreMoveStash` returns false whenever no old-harness reference is present -> `vscode-copilot-targets.test.ts` "a user stash in the old {command, args, env} shape is refused ..." red (1 test).
- mutation: AC 44.2.4 (reporting; detection) -- the `legacyScopes` probe loop in `detect.ts` iterates nothing -> "an old .vscode/mcp.json alone ... still detects vscode, and status and doctor report it" red (1 test).
- mutation: AC 44.2.4 (reporting; old file named in a doctor fix) -- the doctor fix back to `--servers <the server names>` -> "status and doctor report the owned entries in both old files" red (1 test).
- mutation: AC 44.2.4 (preview of the migration write in `diff --json` text) -- `servers[].text` without the old-location block -> "the preview shows the old-file removal, and a diff writes nothing" red (1 test).
- mutation: AC 44.2.4 (the `remove` sweep) -- `remove` returns without `withLegacyRemoval` -> "remove --client vscode also removes the owned old-file entry" red (1 test).
- mutation: AC 44.2.4 (a failed sweep on `remove`) -- `cmdToggle`'s `legacyFailures` filter made empty -> "remove --client vscode whose old-file sweep fails exits 1 ..." red (1 test).
- mutation: AC 44.2.4 (confirmation of a legacy-only edit) -- the `legacy.some(...)` term dropped from `wantsWrite` -> "an apply whose only edit is the old-file removal still asks for confirmation" red (1 test; the first version of this test, built on a re-apply, stayed green because a re-apply plans `update`, and was rewritten on an adopt).
- mutation: AC 44.2.3 (adopt needs no confirmation) -- `&& plan.mechanism !== "adopt"` dropped -> "an adopt-only apply writes no config file, so it needs no confirmation" red (1 test).
- mutation: AC 44.2.3 (restore names the other reader) -- the `sharedWith`/`sharedNote` spread dropped from `restore` -> `shared-mcp-json.test.ts` "a restore of the shared file names the other reader ..." red (1 test).
- mutation: AC 44.2.4 (only canonical names leave an old file) -- `isCanonicalName(name) &&` dropped from `legacyTargets` -> "only canonical names are swept from an old file" red (1 test).
- mutation: matrix row "Strict JSON user file" (the refusal says why) -- the strict hint disabled in `readers.ts` -> "a user file with a comment or a trailing comma is refused at validate" red (1 test).
- mutation: matrix row "Strict JSON user file" (every stage) -- the strict JSON reader refuses every file -> `qa-44-2-shared-lifecycle.test.ts` "the strict file written by the manager is itself strict JSON ... at every stage" red (1 test; green before this pass's patch, because the stages' results were never checked).
- QA-stage mutation lines for AC 44.2.2 (`COPILOT_HOME` empty, no literal secret, strict refusal), AC 44.2.3 (shared rule, listing once, CRLF) and AC 44.2.4 (backup location, `removalEdits`, darwin legacy path) are recorded under `## Tests Added` (2026-11-22) and count here.

Mutation evidence (rework 1, 2026-11-22, DW-733 and DW-735; each applied with `perl -0pi` to the source, the package rebuilt (the process pins run the built bin), the named tests run, the file restored from a copy, `cmp`-checked byte-identical, rebuilt):
- mutation: DW-733 (a peer's record counts only for the same file) -- `recordingClients` returns true for any record with a path -> `shared-per-file-ownership.test.ts` "vscode in project A, then a claude-code mode change in project B", "the other direction" and the `recordingClients` unit red (3 tests).
- mutation: DW-733 (a pathless record never counts for a peer) -- the pathless branch of `recordingClients` returns true -> "a pre-44.2 vscode project record (no path) does not block claude-code in any project" and the `recordingClients` unit red (2 tests).
- mutation: DW-733 (records of two files coexist) -- `state.ts` `sameSlot` ignores the path -> "vscode's records for project A and project B both survive" and the units "records of one slot for two files coexist" red (2 tests).
- mutation: DW-733 (an old state file without paths) -- the `record.path === undefined ||` term dropped from `sameSlot` -> "an old state file without any path parses and behaves as before", the pre-44.2 vscode record test and the unit "a record without a path is replaced by the first write" red (3 tests).
- mutation: DW-733 (a genuinely shared file still adopts and refuses) -- `soleOwner` returns true -> "claude-code first", "vscode first", "a vscode record in project A does not make vscode the sole owner ...", "vscode's records ... both survive" and the DW-735 process test red (5 tests).
- mutation: DW-733 (every record carries its path) -- `engine.ts` `apply` records without `at` -> both repro directions, "vscode's records ... both survive", the pre-44.2 test, "vscode first" and the DW-735 process test red (6 tests). The same mutation plus `disable` stashing without `at` turns the changed pins red: `engine-e2e.test.ts` "the spec §3.4 shapes land on disk exactly" (the `path` key on both records) and four `shared-mcp-json.test.ts` tests (adopt in the other direction, the refused claude-code, the disable note, the restore note), which now seed `path` on their ledger records (5 tests on top of the 6 above).
- mutation: DW-735 (a peer's record does not outlive a shared-file remove) -- `dropRemovedShared` drops only the client's own records -> the process test "DW-735: the peer's record does not outlive a shared-file remove" and the `dropRemovedShared` unit red (2 tests).
- mutation: DW-733 (restore names a reader only for this file; review patch) -- `peersRecordingFile` in `shared-files.ts` made to ignore the path (`true`), the package rebuilt -> `shared-per-file-ownership.test.ts` "a claude-code restore names vscode as a reader only when vscode records this project's file" red (1 test); restored from a copy, `cmp`-checked byte-identical, rebuilt.
- mutation: DW-733 (a repaired record carries its file; review patch) -- the `at` spread removed from the `recordManaged` call of `doctor --repair` in `cli/clients.ts`, rebuilt -> "doctor --repair records the unrecorded entry of a shared .mcp.json with that file's path" red (1 test); restored, `cmp`-checked, rebuilt.
- Path of each mutation: the process pins and the repro run on the BUILT bin as a child process with a scratch HOME; the units run in memory. `engine-e2e.test.ts` and `shared-mcp-json.test.ts` run the engine and `runCli` in process.

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

Status: done
Blocking condition: none

Build and review (2026-11-22): tasks 1-13 built, reviewed by four layers (Blind Hunter, Edge Case Hunter, Verification Gap, Intent Alignment: 35 findings, none high), patched and verified; one commit of the reviewed diff plus this spec on the epic branch, nothing pushed or published.
- Review breakdown: 6 medium entries patched (stash left behind by the advised `apply`; the legacy-stash refusal ordered after the missing-file no-op; the shared-file note for a vscode-only owner; and three test gaps: `enable` into a shared file, claude-code refused or adopting, a non-vscode `${env:` stash), 6 low patches (doctor strict-file adapter, preview guard, a constant-zero assertion, mutation lines, a docs paragraph), 2 items deferred (the `patch` changeset that removes four public exports, and the path-less ownership ledger), 2 false, and the remaining lows rejected with their reasons in `## Review Triage Log`.
- Follow-up review recommended: true. Two or more medium entries were patched, and the patches touch `engine.ts` `apply`/`enable`/`withSharedNote`, which only in-memory and process tests exercise; the unverified risk is a shared-file flow no scenario drives (for example an `enable` after a disable by both clients).
- Verification (all in the foreground, scratch homes only): build; the six-file and three-file `(loop)` sets green; `render-certification-table.mjs --check` exit 0; `@iris-mcp/client-config` suite 48 files, 1343 tests green; launcher suite 458 passed, 3 skipped; `@iris-mcp/all` run in 8 vitest shards, all 8 green; `lint`, `type-check`, `gen:governance-baseline:check` (141 frozen keys unchanged) and `gen:ipm:check` pass. Mutation evidence for each pinning test is in `## Verification`.
- Residual risks: the owner's Copilot-session certification (D-6) is still to run; the changeset stays `patch` for the lead to raise; the ledger has no file path (deferred); the launcher provider path is Story 44.6.

Plan stage (2026-11-22): the spec meets the READY FOR DEVELOPMENT standard and the run halted after planning, as instructed. Nothing was implemented or committed.

Implement stage (2026-11-22): tasks 1-13 are built and verified; nothing is committed, staged beyond the golden-fixture `git mv` renames, or published.
- Changed: `packages/client-config` (`types`, `adapters`, `paths`, `readers`, `diff`, `synthesize`, `engine`, `status`, `detect`, `index`, `cli/clients`, new `shared-files.ts`; tests, goldens and the oracle fixtures; `certify.mjs`, `certification-results.json`, the README with its generated tables), the three docs, the extension README and its two mirror tests, `CHANGELOG.md` and `.changeset/story-44-2-vs-code-copilot-mcp-configuration-targets.md`.
- Verified: the `(loop)` commands green (build; the six-file and three-file vitest sets; `render-certification-table.mjs --check`); the package suite (48 files, 1337 tests) and the launcher suite (32 files, 458 tests) green; `lint`, `type-check`, `gen:governance-baseline:check` (141 frozen keys, unchanged) and `gen:ipm:check` clean; the five mutations of `## Verification` each observed red and restored.
- AC 44.2.1: no probe claim about VS Code could be re-checked without the app; the claims the build found wrong are in the Spec Change Log (items 1-2). AC 44.2.6: the re-run and its new verdicts are in D-5. AC 44.2.7: the certify run passed under a scratch `HOME` (paths printed and checked first, `COPILOT_HOME` unset); the vscode record is re-dated 2026-11-22 with `humanOnly` kept and the D-6 pointer; the owner still runs D-6. AC 44.2.9: the CHANGELOG and the changeset name `@iris-mcp/client-config` as the must-carry package; no vsix is needed for the fix, the CLI change reaches the MCP Clients view through the npm `@1` release, and the extension README change reaches the Marketplace with the next vsix (DW-720).
- For the lead: the changeset is `patch` but removes four public exports (Spec Change Log 3); the AD-30 text of D-2 is unchanged and was implemented as written.

For the lead:
- the AD-30 "Shared files" replacement text (D-2, Rule 20);
- three epic-text corrections (D-1, "Corrections for the lead");
- one `deferred:` item (the extension provider path) to harvest;
- the owner runbook (D-6).

Rework 1 (2026-11-22; DW-733, DW-735; the lead's re-open, wave-9 decision #135):
- DW-733 fixed with an additive optional `path` on every ledger and stash record the code writes (Spec Change Log 7): no breaking state-file change was needed, so nothing was stopped. The lead's repro (vscode `apply --scope project` in project A, then a claude-code mode change in project B) now exits 0 on the built CLI and writes the bytes of a world where VS Code was never used; the first claude-code apply is the pre-story oracle's bytes. The other direction, a pre-44.2 (pathless) vscode record, an old state file without paths, and a genuinely shared file (adopt and refuse, both directions) are pinned in the new `shared-per-file-ownership.test.ts` (14 tests, built CLI plus units). Mutation lines are in `## Verification`.
- DW-735 re-checked and FIXED (it was a two-way door: `dropRemovedShared`, about 20 lines with its tests): a `remove` of a shared entry drops the peers' manager records for the same file, so the stale record no longer makes a later write look like a conflict. Peers' stashes are kept (a disabled copy the peer can still enable). The ledger DW-735 can close as resolved.
- The `deferred:` frontmatter item for the path-less ledger (DW-733) is removed: it is fixed.
- CHANGELOG: the known-limitation sentence and its workaround are replaced by the per-file ownership statement. The docs (`docs/client-config/README.md`, the package and extension READMEs) held no DW-733 text.
- Verification (foreground, scratch homes only): build; the six-file `(loop)` set plus the new file, `state` and `engine-e2e` green (182 tests); the three-file process set green (66 tests); `render-certification-table.mjs --check` exit 0; the whole `@iris-mcp/client-config` suite 52 files, 1407 tests green; `tsc --noEmit` clean. The `(once)` commands were not run.
- Review of this pass (2026-11-22; four layers, all delivered; frozen diff `05e3757..` tree, spec excluded from the diff): 35 findings, high 0 / medium 3 / low 24 / false 8. Patched: 3 medium (one root cause, the `restore` filter extended into `shared-files.ts` `peersRecordingFile` and pinned) and 4 low (the `doctor --repair` path pin, test title/comment overclaims, the silent oracle-fixture fallback); deferred: 1 low (doctor's orphaned-stash check ignores the stash path, not caused by this change); 24 rejected with their reasons in `## Review Triage Log`. Follow-up review recommended: false (no `high` patched).
- Verification of this pass (foreground, scratch homes only): build; the `(loop)` sets green (215 tests across ten files); `render-certification-table.mjs --check` exit 0; `@iris-mcp/client-config` 52 files, 1409 tests green; launcher 32 files, 458 passed / 3 skipped; `@iris-mcp/all` 8 shards green; `lint`, `type-check`, `gen:governance-baseline:check` (141 frozen keys) and `gen:ipm:check` clean. This replaces the earlier "(once) not run" note.
- Residual risk: a record written by a client other than claude-code or vscode now carries a path too (every record), so a `state.json` shared across two different homes' paths keeps one record per file; a project directory that moves leaves its old record behind (harmless: it counts only for the old path).

## Tests Added

QA stage, 2026-11-22 (gap-first against the Tasks & Acceptance and the I/O matrix; vitest only; scratch `HOME`/`USERPROFILE`/`COPILOT_HOME`; the process suite drives the built `dist/cli/clients-cli.js`; no source file changed).

New files (3 files, 65 tests):

- `packages/client-config/src/__tests__/qa-44-2-vscode-process.test.ts` (26 tests, built bin as a child process, expected bytes hand-derived):
  - COPILOT_HOME matrix (3 tests; AC 44.2.2, matrix row "COPILOT_HOME"): unset, set, set-but-empty through `status`, `apply` and `remove`, with a decoy file in the other candidate directory left untouched; `XDG_CONFIG_HOME` and `CLAUDE_CONFIG_DIR` never move the vscode user file while `CLAUDE_CONFIG_DIR` still moves claude-code's; `COPILOT_HOME` never moves the old profile `mcp.json` the migration reads.
  - No literal secret by default (2 tests; AC 44.2.2, AD-9): env-reference, server-manager and governance-file at user and project scope with a hostile `IRIS_PASSWORD` in the child env, the whole scratch tree and both streams scanned for it, the project entry compared with claude-code's per mode; `explicit` without or with a wrong typed confirmation is exit 2 and writes nothing, with it the literal lands only in the file and the ledger flags `containsSecret`.
  - Strict user file against the tolerant shared file (4 tests; matrix row "Strict JSON user file"): a line comment, a trailing comma and a block comment each refuse at `apply` (exit 1), `status` and `doctor`, with bytes untouched and no ledger or backup; the same comment and trailing comma in the project `.mcp.json` are accepted and the bytes return exactly on remove.
  - Shared `.mcp.json` (7 tests; AC 44.2.3 and the Integration AC): vscode and claude-code write byte-identical project files on five non-canonical shapes (none, compact, 4-space, CRLF+BOM, comments) and remove returns the fixture; adopt writes nothing (no backup, bytes identical, both ledger records); conflict in both directions leaves file and ledger byte-identical and never echoes a typed secret; an unrecorded different canonical entry is refused for vscode and replaced by claude-code (AD-15), then adopted; disable and remove name the other client in text and `--json`, and a vscode `enable` after a shared disable works; `status`/`detect` list the file under both clients once, `doctor` reports a corrupt shared file once and an env-reference once per variable; the home-directory refusal for `apply` and `diff` of the new project file, with user scope and `status` still allowed.
  - Migration out of non-canonical legacy files (10 tests; AC 44.2.4, matrix row "Migration"): five project-scope fixtures (BOM+CRLF with a comment inside the owned span and `inputs` last; 4-space with trailing commas, owned last; fully compact; owned first with a foreign comment after; comments inside the owned span) each run `diff` (writes nothing) then `apply` (hand-derived bytes, old-file backup equal to the pre-edit bytes under `backups/vscode-legacy/project`, never under the vscode bucket, a second apply is a no-op, the doctor finding is gone); owned-only entry keeps `inputs` byte-identical; the `remove` sweep; migration combined with the shared adopt; user scope with BOM+CRLF and `COPILOT_HOME` set; an unparseable old file (apply exit 1, entry kept, old bytes untouched, doctor names it unreadable).
- `packages/client-config/src/__tests__/qa-44-2-shared-lifecycle.test.ts` (13 tests, in memory; AC 44.2.2 and 44.2.3, Rule #58): apply, disable, enable, remove with a byte oracle at every stage on the shared `.mcp.json` (BOM+CRLF, comments, trailing commas, a sibling root key, `mcpServers` absent, tab-indented, empty and whitespace-only files) and on the strict user file (a sibling root key and a multi-line foreign entry, `mcpServers` absent, `{}`; every stage stays strict JSON); the old files resolve per platform (win32 `%APPDATA%`, darwin, linux; `.vscode/mcp.json` per platform; null without a project directory) and ignore `COPILOT_HOME`, `XDG_CONFIG_HOME` and `CLAUDE_CONFIG_DIR`. Where the root key was absent the empty `mcpServers` container stays after a remove, which is the pre-story claude-code behavior (pinned from a run on 2026-11-22), so those shapes pin the foreign pieces and validity, not exact bytes.

Mutations (each applied to the source, the package rebuilt, the named tests run, the file restored and `cmp`-checked byte-identical, rebuilt, green again):

- mutation: AC 44.2.2 (COPILOT_HOME set but empty) -- `paths.ts` env override accepts an empty value (`overrideRoot !== ""` dropped in both resolvers) -> `qa-44-2-vscode-process.test.ts` "unset, set, and set-but-empty ..." red (1 test); restored, 26 green.
- mutation: AC 44.2.2 (no literal secret) -- `synthesize.ts` env-reference writes `process.env.IRIS_PASSWORD` when set -> "env-reference, server-manager and governance-file ... write no password" red (1 test, only reachable through a child with a hostile env); restored, 26 green.
- mutation: AC 44.2.2 (strict user file) -- `readers.ts` ignores `strictJson` (always tolerant) -> the three strict-file refusal tests red (3 tests); restored, 26 green.
- mutation: AC 44.2.3 (shared rule) -- `engine.ts` `sharedVerdict` short-circuits to a normal write for every file -> adopt, conflict in both directions, the unrecorded-entry test and the migration-with-adopt test red (4 tests); restored, 26 green.
- mutation: AC 44.2.3 (listing once) -- `cli/clients.ts` doctor `firstVisit` no longer skips a path already seen -> "status and detect list the file under both clients once each, doctor reports ... once" red (1 test); restored, 26 green.
- mutation: AC 44.2.3 (Rule #58, line endings) -- `diff.ts` `detectEol` returns `"\n"` always -> `qa-44-2-shared-lifecycle.test.ts` "BOM + CRLF: apply -> disable -> enable -> remove" red (1 test); restored, 13 green.
- mutation: AC 44.2.4 (old-file backup location) -- `engine.ts` legacy edit uses `client: adapter.id` instead of `<id>-legacy` (the backup lands in the vscode bucket `restore` reads) -> the five project migration tests and the user migration test red (6 tests); restored, 26 green.
- mutation: AC 44.2.4 (foreign bytes around the removed entry) -- `diff.ts` `removalEdits` never takes the trailing comma (`if (content[i] === ",")` made `if (false)`) -> the tolerant-file round trip, three of the five migration fixtures, the remove sweep and the user migration red (6 tests); restored, 26 green.
- mutation: AC 44.2.4 (old path per platform) -- `adapters.ts` legacy user darwin path uses the linux root -> "user: %APPDATA%\Code\User on win32, ..." red (1 test); restored, 13 green.

Commands run (all foreground, scratch homes only):

- `pnpm turbo run build`: 7 of 7 successful (after the last mutation restore).
- `cd packages/client-config && npx vitest run`: 50 files, 1382 tests passed (1343 before + 26 + 13 new).
- `cd extensions/iris-mcp-launcher && npx vitest run`: 32 files, 458 passed, 3 skipped.
- `node packages/client-config/scripts/render-certification-table.mjs --check`: exit 0 ("marker sections are in sync").
- `pnpm run lint`: 7 of 7 tasks successful, `--max-warnings 0`. `pnpm run type-check`: 13 of 13 successful.

### QA findings for the lead

None is high; nothing was fixed (QA writes tests only). DW-732 and DW-733 were not re-reported.

1. `low` -- a BOM is accepted in the strict user file. `readers.ts:459-461` strips a leading U+FEFF before every parse, including the `strictJson` one. A `~/.copilot/mcp-config.json` that starts with a BOM applies with exit 0 and the BOM is kept (probe: `﻿{"mcpServers":{"foo":...}}` then `apply --client vscode --scope user`). Probe V8 says VS Code validates that file with `JSON.parse`, which throws on a BOM, so the manager may write into a file Copilot cannot read. Unverified against VS Code's reader (it may strip a BOM first); not pinned either way, so the owner's D-6 sitting or a bundle check should settle it.
2. `low` -- the strict-file refusal does not say why. A comment or trailing comma gives `config is unparseable: JSON parse error at line 1 (offset 0, code 10)` and doctor `config file is unparseable: ...` (`readers.ts:446` path, surfaced by `cli/clients.ts` apply and doctor). A user who edited the file by hand gets no hint that this file, unlike `.mcp.json`, must be strict JSON.
3. `low` -- a peer's ledger record outlives the entry. After `claude-code` removes a shared entry, vscode's record stays (probe: ledger `[vscode:iris-dev-mcp]`, file has no entry). When claude-code then writes a different entry (explicit, literal password), `status` shows vscode `present-enabled` for an entry vscode did not write, and a vscode re-apply is refused as a conflict. `engine.ts` `remove` and `shared-files.ts` `ownerClients`; related in effect to DW-733 but a different cause (peer record not dropped on remove), so it fixes separately.
4. `low` (cosmetic) -- removing the only entry from a legacy `servers` object leaves a whitespace-only line (`{\n  "servers": {\n    \n  },`); the file parses and `inputs` is untouched. `diff.ts` `removalEdits`. The shipped shared-file tests pin the same behavior for claude-code, so it is parity, not a regression.
5. `low` (evidence for the rejected review item Intent-2) -- `doctor` labels findings for the shared file `[claude-code/project]` even when only vscode ever wrote it (probe: vscode-only apply, then doctor lists six `[claude-code/project] ... references $IRIS_*` lines and only the VS Code restart hint). A vscode-only user sees a client they never configured. `cli/clients.ts` doctor `firstVisit` (about line 1533).

Residual: no real Windows run (the `USERPROFILE` path shape is pinned in memory by `vscode-copilot-targets.test.ts` and by the new platform test, not by a Windows child process); no real VS Code or Copilot session (AC 44.2.7 stays a human row).
