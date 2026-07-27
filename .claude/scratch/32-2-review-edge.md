# Edge Case Hunter — Story 32.2 (governance UI) findings

Diff reviewed: `.claude/scratch/32-2-fulldiff.txt` (5,479 lines, read fully) plus repo context (`definitions.ts` PACKAGE_NPM_NAME/PACKAGE_DIR_NAME, `governance-baseline-derivation.ts` SERVER_PACKAGES, `governance.ts` loader + cascade signatures, panel/engine test files). Every production branch walked: `cli/governance.ts` `universe` command, `governanceEngine.ts`, `governanceView.ts`, `governancePanel.ts`, `extension.ts` wiring, `env.ts` passthrough, `settings.ts`.

## HIGH

### 1. npx-mode governance CLI spawn fails on Windows — `spawn("npx")` without `shell: true` cannot execute the `npx.cmd` shim
- **Severity:** high
- **Location:** `extensions/iris-mcp-launcher/src/governanceEngine.ts:156` (`command: "npx"`), spawned at `:275` via plain `node:child_process.spawn`
- **Trigger:** any governance-editor command with `irisMcpLauncher.developmentRepoPath` unset (the published/default mode) on Windows.
- **What goes wrong:** on Windows `npx` resolves to `npx.cmd`, and `child_process.spawn` without `shell: true` cannot run `.cmd` files (documented Node behavior) — the child emits `error` ENOENT, so EVERY engine command returns `spawnError: "spawn npx ENOENT"` and the editor renders an inline failure for validate/diff/universe/set/unset. The whole npx mode is dead on the product's primary dev platform, with a misleading "not on PATH"-looking message for users who have npm installed. Nothing exercises the real npx spawn: the real-CLI e2e pins local mode only (`expect(resolution.target.mode).toBe("local")`, `governanceEngineRealCli.test.ts`), and unit tests inject a fake `spawnImpl` — a Rule #54 blind spot: the fake proves the plumbing, never that the real command name spawns. (The `McpStdioServerDefinition` "npx" spawn path is VS Code's own process creation, not this code.)

## MEDIUM

### 2. `buildGovernanceCliEnv` scrubs `IRIS_` case-SENSITIVELY — case-variant ambient vars cross the containment boundary on Windows
- **Severity:** medium
- **Location:** `extensions/iris-mcp-launcher/src/governanceEngine.ts:176` (`if (name.startsWith("IRIS_")) continue;`)
- **Trigger:** Windows extension host with an ambient env var like `Iris_Password` or `iris_governance` (Windows env lookup is case-insensitive).
- **What goes wrong:** the var survives the scrub and reaches the CLI subprocess — credential material (`iris_password`, `iris_profiles`) crosses the exact boundary the module banner claims ("the spawned environment therefore scrubs EVERY IRIS_* variable"), and a case-variant ambient `iris_governance`/`iris_governance_file` silently changes the CLI's cascade render. The suite already learned this (32-3-R9): the Story 32.2 e2e file's own `childEnv` scrubs `!key.toUpperCase().startsWith("IRIS_")` — the production engine regressed to the case-sensitive form.

### 3. Partial-save retry wedge: already-applied edits stay staged, and a retried `unset` fails "nothing to unset" at the head of the sequence forever
- **Severity:** medium
- **Location:** `extensions/iris-mcp-launcher/src/governancePanel.ts:249-271` (`save`)
- **Trigger:** staged = [`unset A`, `set B`]; `unset A` succeeds, `set B` fails (CLI error). User fixes the cause and clicks Save again.
- **What goes wrong:** on failure `state.staged` is left untouched (deliberate — "the remaining staged edits stay staged") but that INCLUDES the edits already written. The retry replays `unset A` against a file where A is gone → CLI exit 1 "nothing to unset" → save aborts at the first command every time; B is never retried. The user is wedged until Discard (losing B) or manual file surgery. The test at `governancePanel.test.ts:255` pins abort-on-first-failure but never exercises a retry after partial success. Fix shape: drop successfully-applied entries from staged as the loop proceeds.

### 4. `stage`/`discard` are not busy-guarded — a toggle clicked during a save is silently wiped, unapplied
- **Severity:** medium
- **Location:** `extensions/iris-mcp-launcher/src/governancePanel.ts:316-329` vs the `busy` checks at `:276/:297/:307/:330`
- **Trigger:** user clicks a toggle (or Discard) while a Save's CLI sequence is still running.
- **What goes wrong:** `save()` snapshots `commands = stagedCliCommands(state)` once; a mid-save `stage` appends a new entry to `state.staged` that is never in the command list; after the loop, `clearStaged(state)` deletes it without it ever being written. The post-save refresh renders the edit as gone — silent loss of a user gesture. Symmetrically, `discard` mid-save clears staged while the already-snapshot commands keep writing, so Discard appears to work but the writes still land.

### 5. The opener's reveal path bypasses the busy guard — double-invoke during save/chooseFile runs a concurrent full `refresh()`
- **Severity:** medium
- **Location:** `extensions/iris-mcp-launcher/src/governancePanel.ts:348-353` (the returned opener: `panel.reveal(); await refresh();` with no `busy` check)
- **Trigger:** invoke `irisMcpLauncher.openGovernanceEditor` while a save, chooseFile, or refresh is in flight.
- **What goes wrong:** a second, unguarded `refresh()` rebuilds `state` wholesale (`state = {...}`) while `save()`'s command loop is mid-flight; its CLI reads interleave with the save's CLI writes (a `diff` read between two `set` invocations renders a partially-applied file), `save()` then runs `clearStaged` over the refreshed state and issues a THIRD refresh. Two overlapping refreshes also race their progressive `state = {...}` mutations, rendering half-loaded intermediate HTML. Outcomes are transient/self-healing in most interleavings, but the singleton panel's one-writer-at-a-time invariant the busy guard exists to provide has a documented hole on this path.

### 6. `GLOBAL_TAB`'s sentinel value "global" collides with a legitimate profile named "global"
- **Severity:** medium
- **Location:** `extensions/iris-mcp-launcher/src/governanceView.ts:93` (`GLOBAL_TAB = "global"`), `:154` (`computeProfileTabs`), `:159` (`layerForTab`)
- **Trigger:** a governance file containing `{"profiles": {"global": {...}}}` (legal: the CLI/loader reject only `""` and RESERVED_KEYS) or a Server Manager server named "global".
- **What goes wrong:** the comment at `:88-93` claims the id "lives outside the profile namespace" — it does not. `computeProfileTabs` returns `["global", ..., "global"]` (duplicate tab id); `universeByTab["global"]` is shared by both layers' renders; the duplicate tab is labeled "global (file)" and "global"; and `layerForTab("global") → undefined` means toggles on the profile-"global" tab stage writes to the GLOBAL layer — the exact collision the sentinel comment says it exists to prevent. The profile's own layer is unreachable via the UI.

### 7. Choose-file writes only Global scope — a workspace-scoped `irisMcpLauncher.governanceFile` silently shadows the user's choice
- **Severity:** medium
- **Location:** `extensions/iris-mcp-launcher/src/extension.ts` (`updateGovernanceFileSetting`: `config.update(GOVERNANCE_FILE_SETTING_KEY, filePath, vscode.ConfigurationTarget.Global)`)
- **Trigger:** the workspace (or workspace-folder) settings already define `irisMcpLauncher.governanceFile`; user picks a different file in the editor.
- **What goes wrong:** the write lands in Global, but `readSettings` reads the merged configuration where the workspace value wins — the panel refreshes to the OLD path with no message, looking like the picker did nothing. The servers-selection flow solved this exact problem with inspect-then-write-to-the-owning-scope (`selectServers.ts` `chooseTarget`); the new write doesn't.

### 8. No timeout or cancellation on `runGovernanceCli` — a hung CLI subprocess wedges the panel for the session
- **Severity:** medium
- **Location:** `extensions/iris-mcp-launcher/src/governanceEngine.ts:265-311`
- **Trigger:** first `npx -y` run on a slow/broken network (six `-p` packages for `universe`), a blocked npx registry fetch, or any CLI hang — the promise settles only on `error`/`close`.
- **What goes wrong:** the panel's `busy` flag never clears, so every guarded action (refresh/save/chooseFile/switch-profile-fetch) is silently ignored. Closing the panel does NOT recover: `onDispose` clears `panel`/`state` but not the closure's `busy`, and the opener is the same closure — a reopened panel inherits `busy: true` with all guarded actions dead until the window reloads. (E1's Windows ENOENT masks this on Windows; on POSIX/macOS the npx path is live.)

## LOW

### 9. `fileProfileNames`'s layer-label regex cannot match profile names containing a newline
- **Severity:** low — `governanceView.ts:132` (`/^profile "(.*)"$/` — `.` never matches `\n`). A JSON-legal profile name with a newline yields a `diff` layer label that matches nothing, so the profile silently gets no tab (its layer is uneditable in the UI; the raw diff row still renders). No test uses control-character profile names.

### 10. `frameworkTool.keys` is hardcoded `[SERVER_DISCOVERY_TOOL_NAME]` while the duplicate-guard uses `deriveKeysForTool`
- **Severity:** low — `packages/shared/src/cli/governance.ts` (`frameworkTool: { name: SERVER_DISCOVERY_TOOL_NAME, keys: [SERVER_DISCOVERY_TOOL_NAME] }`). If the framework tool ever gains action keys, the derived set (used for `originByKey`/`universe`) and the emitted `frameworkTool.keys` diverge — the extra keys fall into the view's "baseline (no owning package)" group instead. Consistent today (the tool has no actions); the inconsistency is structural.

### 11. `settings.governanceFile` is not trimmed, unlike `developmentRepoPath` in the same function
- **Severity:** low — `settings.ts:92`. `"C:\gov\policy.json "` (trailing space from a paste) yields `fileExists: false` and the "file does not exist — a server FAILS TO START" banner with no hint that whitespace is the cause. `developmentRepoPath` on the adjacent line gets `.trim()`.

### 12. `--file ""` (empty flag value) inherited from 32.1's resolveFilePath reaches `universe` too
- **Severity:** low — `packages/shared/src/cli/governance.ts` (`resolveFilePath`). `--file ""` returns `""` verbatim; the loader treats `""` as unset → `universe --file ""` renders as an empty file (`fileConfig = {}`, output `file: ""`), not as no-file — same false-valid class reported as 32.1 finding E2 (already assigned to Story 32.4; noted here because the new command inherits it and the view's `file === undefined ? no file : has file` split is downstream of it).

### 13. CLI-JSON fields typed as boolean/enum are interpolated RAW into the webview HTML
- **Severity:** low — `governanceView.ts:476` (`file=${entry.file}`, `default=${entry.default}`), `:505` (`${row.mutates}`), `:508` (`${configSourceBadge(row.source)}`). All string-typed/untrusted interpolations (keys, layers, profile names, error text, file path, note) ARE escaped — but these four are trusted-by-contract values from JSON parsed as `unknown` and cast; nothing validates them. A CLI emitting a markup string in a `file`/`mutates`/`configSource` field would inject markup into the webview (CSP `script-src 'nonce-…'` blocks script execution; inline handlers/styles remain). Mitigating context: the producer is the suite's own subprocess, and `npx`-supply-chain compromise already means code execution — so this is hardening depth, not a reachable attack.

### 14. `chooseFile` returns `fsPath` unchecked for scheme — a non-`file:` Uri choice becomes an unreadable local path
- **Severity:** low — `extension.ts` (`chooseFile: uris?.[0]?.fsPath`) + the panel's `statSync` fileExists probe. On a virtual/remote document picker result, `fsPath` can be a path that exists only in the remote/VFS scheme; the editor then shows the "does not exist" banner with no scheme hint. (Remote-window fsPath is correct in the common vscode-remote case; only non-file schemes break.)

## Walked and found clean

- `universe`: `--root` explicit/auto-detect (three-levels-up both layouts), `--root ""` falls through to auto-detect, missing-dist fail-loud naming every probed path, duplicate-key guard (cross-package AND framework-tool), `getEffectivePolicy`/`getEffectiveConfigSources` argument order verified against the real signatures, `--profile` reserved-key/empty validation, `candidateToolEntries` short-name derivation matches the real npm names (`@iris-mcp/<short>`, PACKAGE_NPM_NAME) and can only select an EXISTING path (fails loud otherwise).
- `env.ts`: `IRIS_GOVERNANCE_FILE` added to BOTH the passthrough map and `LAUNCHER_OWNED_VARS` (explicit-null clearing when unset — Rule #19 pinned by the updated back-compat tests).
- Panel: missing-file flow skips validate/diff and renders universe without `--file` (unset can't be staged on a missing file — `stageToggle`'s desired===current no-op makes it unreachable), invalid-file disables editing (CLI set would still fail closed), `validate` exit-1-with-JSON treated as data not error, switchProfile validates tab membership, `onMessage` catch swallows into no-rejection.
- View: every string-typed interpolation escaped (keys, tabs, pending changes, banners, file path, note, `msgAttr` JSON round-trip through entity encoding is getAttribute-safe), CSP nonce + `default-src 'none'`.
- vscodeMock additions (webview panel, showOpenDialog, ViewColumn): shapes match the installed `@types/vscode@1.125.0` members the adapter actually uses; no impossible shapes introduced.
