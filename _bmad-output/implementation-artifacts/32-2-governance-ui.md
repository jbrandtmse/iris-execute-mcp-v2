# Story 32.2: Extension Governance UI

Status: done

## Story

As a VS Code user of the iris-mcp-launcher extension,
I want a governance editor view that shows the governed key universe with per-key toggles, configSource badges, and a diff preview,
so that I can manage one governance file visually and every MCP client picks the policy up on next server start.

## Acceptance Criteria

1. **AC 32.2.1** — Governance view in `iris-mcp-launcher` (scaffolding the extension with only this view if 31.4 hasn't shipped): tree/webview over the governed key universe derived from the published packages' dist metadata (same derivation the `iris-mcp-all` cross-package tests use — never a hand-maintained list); per-tool/per-action toggles, preset display, per-profile tabs, inline validation errors.
2. **AC 32.2.2** — All writes go through the same shared engine as the CLI (one code path); diff preview before save; the UI edits the governance FILE only — it never touches client configs or env.
3. **AC 32.2.3** — Effective-policy preview pane renders the full cascade with `configSource` badges, matching `iris_server_profiles` output for a running server byte-for-byte in a recorded check.
4. **AC 32.2.4** — Manual smoke recorded in story notes: toggle a write tool off in the UI → restart a server launched with `IRIS_GOVERNANCE_FILE` under a real agent → `iris_server_profiles` shows it disabled → calling it returns `GOVERNANCE_DISABLED` (the F2 success-metric round-trip). **This AC is performed by the Project Lead in a real VS Code instance** (the dev environment is headless) — the dev implements everything and leaves the empirical checkbox OPEN with an unambiguous step-by-step procedure, exactly the AC 31.4.4/31.5.4 pattern.

## Integration ACs

AC 32.2.3 + AC 32.2.4 ARE this story's Integration ACs (consumers produce observable effects): the preview pane reads the same cascade the servers enforce (verified against a running server's `iris_server_profiles`), and the UI→file→server→gate round-trip is exercised end-to-end. The CLI/subprocess layer the UI calls is the SAME `iris-mcp-governance` engine Story 32.1 shipped — the UI never reimplements cascade or validation logic.

## Tasks / Subtasks

- [x] Task 1: Engine access layer (AC: 2)
  - [x] Decide + record the subprocess contract: spawn the `iris-mcp-governance` CLI (`--json` modes) — resolution order mirroring 31.6's spawn resolution: `irisMcpLauncher.developmentRepoPath` → `<repo>/packages/shared/dist/cli/governance-cli.js` (node), else `npx -y @iris-mcp/shared iris-mcp-governance` (published). NO bundling of `@iris-mcp/shared` into the extension (breaks the self-contained zero-runtime-dep VSIX; shared pulls native `@napi-rs/keyring`)
  - [x] `irisMcpLauncher.governanceFile` setting (string, default `""` = unset): passed through UNCHANGED as `IRIS_GOVERNANCE_FILE` to every spawned server (mirroring the existing `governance`/`governancePreset`/`auditLog` passthroughs in package.json + env.ts) AND used as the file the UI edits. Empty ⇒ view shows an empty-state with a "choose file" affordance (J1: explicit path only, never discovered)
  - [x] Key-universe command: if the CLI's `effective --json` universe (baseline ∪ mentioned) is insufficient for the FULL governed universe (201 keys), add a `universe`/`--all-keys` surface to the shared CLI that derives keys the same way `iris-mcp-all` tests do (SERVER_PACKAGES + deriveKeysForTool over built dist) — additive to shared, single-sourced; probe first (Rule #16) and record the choice
- [x] Task 2: Governance view (AC: 1)
  - [x] Webview (or tree) contributed to the iris-mcp-launcher views: governed key universe grouped per server package, per-tool/per-action tri-state toggles (enabled/disabled/inherit), preset display (from `irisMcpLauncher.governancePreset`), per-profile tabs (global + each Server Manager profile), inline validation errors from the engine's own messages
  - [x] Diff preview before save (render `diff --json`); save goes through `set`/`unset` subprocess calls — never hand-serialized JSON
- [x] Task 3: Effective-policy preview (AC: 3)
  - [x] Preview pane rendering the full cascade with `configSource` badges (env/file/preset/default) via `effective --json`; recorded check vs a running built server's `iris_server_profiles` output (the Case-I agreement pattern, captured into story notes)
- [x] Task 4: Tests + packaging (AC: 1, 2, 3)
  - [x] vitest coverage of the view-model layer (pure, vscode-free): state derivation, toggle → set/unset command mapping, diff preview rendering, badge mapping — fakes pinned to `@types/vscode@1.125.0` + the REAL CLI stdout shapes captured by running the bin (Rules #36/#54)
  - [x] packaging.test.ts/containment.test.ts roster updates for new files (recursive rosters per the 32.3 fix); the subprocess layer asserts NO credential material flows through it (containment discipline — governance files are not secrets, but the layer spawns processes: pin the env scrub)
- [x] Task 5: Docs + AC 32.2.4 procedure (AC: 4)
  - [x] Extension README governance-view section (capability + `irisMcpLauncher.governanceFile` default state, Rules #30/#43); CHANGELOG entry
  - [x] The unambiguous step-by-step AC 32.2.4 procedure for the Project Lead (install VSIX → set governanceFile → toggle → restart → iris_server_profiles → GOVERNANCE_DISABLED), including VS Code + Server Manager version fields to fill in

## Dev Notes

### Verified current-state pointers (lead-verified 2026-07-27, Rule #47)

- Extension: `extensions/iris-mcp-launcher/` — plain `tsc` build (no bundler), zero runtime deps, self-contained VSIX; `src/extension.ts` (activate, provider registration), `env.ts` (`synthesizeIrisEnv` — passthrough construction), `settings.ts` (readSettings), `serverDefinitionProvider.ts` (spawn resolution incl. `developmentRepoPath` + `process.execPath` interpreter), `selectServers.ts` (existing command + status bar patterns); `package.json` already contributes `irisMcpLauncher.governance`, `governancePreset`, `auditLog` passthrough settings (mirror their shape for `governanceFile`).
- Engine: `iris-mcp-governance` bin at `packages/shared/dist/cli/governance-cli.js` (Story 32.1) — `validate/get/set/unset/effective/diff` with `--json`; reserved-key rejection; atomic writes. Published via `@iris-mcp/shared` `bin` (two bins: use `npx -p @iris-mcp/shared iris-mcp-governance` form).
- Key universe derivation reference: `packages/iris-mcp-all` tests use `SERVER_PACKAGES` + `deriveKeysForTool` over each package's built dist (Rule #45); the frozen baseline is 141 keys, live universe 201 (141 + 60 post-foundation).
- Test baseline: extension 235 tests / 13 files after 32.1; `src/__tests__/vscodeMock.ts` (pinned fake), `activationFlow.test.ts` (activation-level pattern), `packaging.test.ts` + `containment.test.ts` (recursive rosters).

### Constraints

- **Self-contained VSIX is invariant**: zero npm runtime dependencies; `dist/*.js` only. The engine is reached via subprocess (CLI), never by bundling shared.
- **Credential containment**: the governance subprocess layer must never receive or emit credential material; pin the spawned env (scrub IRIS_USERNAME/IRIS_PASSWORD/IRIS_PROFILES before spawning the CLI — the CLI needs only the governance file path).
- **Rule #54**: every vscode fake shape must be producible by the real API (`@types/vscode@1.125.0` oracle); every CLI-output fake must be captured from the real bin.
- **Rule #55**: file-writing tools only; NUL-scan; no heredocs.
- **Reload semantics**: PD-3 (Story 32.3) keeps AC-31.5.6 reload semantics — the view reflects file state at open/refresh; no hot-reload machinery. Document that a server restart applies changes (matches the file's restart-only contract).
- **No governance key/tool changes** (Rules #28/#31/#53 untriggered); no `packages/**` test-count contracts moved except additive shared-CLI surface if Task 1 adds `universe` (Rule #31: a new ACTION-free command on a bin, not an MCP tool — tool counts unaffected).
- **AC 32.2.4 stays OPEN for the Project Lead** — do NOT claim it headlessly; the honest-deferral pattern from 31.5 is the model (the dev agent declining to claim what it cannot observe is correct behavior).

### Previous-story intelligence

- 32.1 (just landed): the CLI's `--json` shapes, exit codes, warn-not-reject unknown-key policy, and the Case-I CLI↔server agreement proof — the UI inherits all of it via subprocess.
- 31.5/31.6: command + status bar contribution patterns, `onStartupFinished` activation, QuickPick vs webview trade-offs, `developmentRepoPath` resolution order, `process.execPath` spawn interpreter (AC 31.6.1 amended), machine-scope rationale for executable-selecting settings (`governanceFile` is an inert JSON path — window scope suffices, same as `auditLog`).
- 32.3 late-layer items R3/R4/R5/R8 (extension warning-dedupe, eager Server Manager activation, status-bar zero-state, refresh race) are assigned to Story 32.4 — do NOT fix them here; avoid re-touching those seams except where the view genuinely intersects.

### Project Structure Notes

- Code: `extensions/iris-mcp-launcher/src/` (new: governance view module(s) e.g. `governanceView.ts`, `governanceEngine.ts` subprocess layer; edits: `extension.ts`, `env.ts`, `settings.ts`, `types.ts`, `package.json`). Possible additive: `packages/shared/src/cli/governance.ts` (`universe` command) if Task 1's probe requires it.
- Tests: `extensions/iris-mcp-launcher/src/__tests__/` (+ roster updates).
- Docs: extension README, CHANGELOG, story notes for AC 32.2.3's recorded check.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 32.2]
- [Source: _bmad-output/planning-artifacts/research/technical-iris-server-manager-mcp-connections-research-2026-07-25.md#F2-D3]
- [Source: packages/shared/src/cli/governance.ts (engine surface)]
- [Source: packages/iris-mcp-all/src/__tests__/ (key-universe derivation pattern)]
- [Source: .claude/rules/project-rules.md#30 / #31 / #36 / #45 / #54 / #55]

## Dev Agent Record

### Agent Model Used

claude-k3[1m] (bmad-dev-story, Epic 32 Story 32.2)

### Debug Log References

- Rule #16 probe (Task 1, BEFORE building): read `packages/shared/src/cli/governance.ts` `cmdEffective` — confirmed its key universe is `new Set(GOVERNANCE_BASELINE)` ∪ mentioned keys (141+), NOT the full 201. Recorded choice: **added the additive `universe` command** to the shared CLI rather than overloading `effective` (shipped + reviewed in 32.1; kept byte-stable).
- Live derivation probe (node one-liner over built dist): baseline 141; baseline ∪ dist-derived (SERVER_PACKAGES + deriveKeysForTool) = **201** (35/66/46/36/18 per package, 104 tools); +framework tool = 202. `buildMutatesLookup` over real dist = 60 entries; `buildDefaultEnabledWrites` = `["iris_production_control:clean"]`.
- AC 32.2.3 recorded check (the Case-I agreement pattern, generalized to the full universe): disposable script (deleted after) spawned the BUILT bin `universe --json --file <fixture> --profile default` AND the BUILT `iris-dev-mcp` over real stdio with `IRIS_GOVERNANCE_FILE=<fixture>` + live IRIS (localhost:52773, HSCUSTOM). Output:
  - `CLI universe: 202 keys (postFoundation: 61)`
  - `Server iris_server_profiles: profile=default, 151 keys`
  - `Post-foundation write seed check on iris_env_promote:execute: cli=false server=false`
  - `Server-reported keys compared: 151`
  - `RESULT: PASS — CLI universe render matches the running server key-for-key (value + configSource)`
  - Every key the server reported (141 baseline ∪ iris-dev-mcp's registered keys ∪ the framework tool) matched the CLI's 202-key render on BOTH value and configSource — including the fixture's file-layer flips (`iris_doc_put=false`, `iris_sql_execute=false`, both `configSource: "file"`) and the write-seed property `effective --json` cannot reproduce.
- Gates: extension `npx vitest run` 16 files / **290 tests** (+3 files / +55 over the 32.1 baseline of 13/235), `npx tsc --noEmit` clean, `npm run build` clean; shared `npx vitest run` 64 files / **1273 tests** (+1 file / +21), `tsc --noEmit` clean, eslint clean (1 PRE-EXISTING warning at cli/governance.ts:740 — the `no-dynamic-delete` directive predates this story on HEAD, verified via stash-lint; not touched). Full workspace turbo gates + `gen:governance-baseline:check` (:check ONLY): see Completion Notes.

### Completion Notes List

1. **Subprocess contract (Task 1, recorded decision).** The extension reaches the governance engine ONLY by spawning the Story 32.1 CLI: `developmentRepoPath` non-empty ⇒ `process.execPath` + `<repo>/packages/shared/dist/cli/governance-cli.js` + `ELECTRON_RUN_AS_NODE=1` (mirroring 31.6's local spawn, fail-closed on a relative path or unbuilt CLI — never a silent npx fallback); otherwise `npx -y -p @iris-mcp/shared iris-mcp-governance`. For `universe` ONLY, the npx invocation adds `-p` for all five server packages (derived from `definitions.ts`'s `PACKAGE_NPM_NAME`, never a second hand-maintained roster) because `universe` derives the registered half of the key universe from sibling dist — npm lays all `-p` packages side-by-side under one `node_modules/@iris-mcp/`, and the CLI's auto-detection covers both layouts (monorepo `packages/iris-<x>-mcp`, npm scope `<x>`). `@iris-mcp/shared` is NEVER bundled (native `@napi-rs/keyring` would break the zero-runtime-dep VSIX invariant).
2. **`universe` command (Task 1, the recorded key-universe choice).** New additive shared-CLI command rendering the FULL governed universe (baseline ∪ dist-derived ∪ framework = 202 keys today) with the REAL mutates/default-enabled classifications — the render `iris_server_profiles` computes on a running server over its own registered subset. Key consequence proven live: post-foundation write keys seed default-DISABLED (`iris_env_promote:execute: false`), which `effective`'s baseline-scoped render cannot reproduce. Resolution: `--root` wins (monorepo root or package container); else auto-detect three levels up from the CLI's own file (works identically from `src/` under vitest, `dist/` in the checkout, and npm siblings). Failure = exit 1 naming every probed path. Single-sourcing: composes `getEffectivePolicy`/`getEffectiveConfigSources`/`buildMutatesLookup`/`buildDefaultEnabledWrites` + the shared `deriveKeysForTool`; a unit test compares the render key-for-key against a DIRECT engine call over independently-loaded dist tools (no-drift proof). Rule #31: a new COMMAND on an existing bin — no MCP tool added, no governance key added, tool counts untouched.
3. **Preview render choice (Task 3, spec deviation recorded).** The story text says the preview renders "via `effective --json`"; it renders via **`universe --json`** instead — the same shared cascade functions over the full universe with real classifications, which is strictly more faithful to a running server (and is what made the AC 32.2.3 byte-for-byte recorded check possible over every server-reported key). `effective` is untouched and remains the baseline-scoped render for scripting.
4. **View architecture (Tasks 2+3).** Command `irisMcpLauncher.openGovernanceEditor` → singleton WebviewPanel (editor area; no viewsContainers/icon needed). Three-layer split honoring the "one vscode import" rule: `governanceView.ts` (pure view-model: tab/layer model, tri-state staging, `diff --json` preview, badge mapping, CSP-nonce HTML), `governancePanel.ts` (orchestration, injected deps, busy-guarded message pump, singleton reveal), `governanceEngine.ts` (resolution + env scrub + spawn + argv). Tabs: `global (file)` (edits the file's global layer, renders the reserved `default` profile) + `default` + every Server Manager server name + every profile the file names (parsed from `diff --json` layer labels). Toggles stage edits; Save applies them through `set`/`unset` subprocess calls (never hand-serialized JSON); a failed write aborts the sequence, warns once, keeps remaining edits staged. Preset is DISPLAY-only (env-sourced; the UI never writes it — the 32.1 recorded decision).
5. **Missing/invalid file states.** Missing file: no validate/diff; `universe` runs WITHOUT `--file` (seeds-only render); a loud banner states a server launched with `IRIS_GOVERNANCE_FILE` pointing at a missing file FAILS TO START and Save creates the file. Invalid file: `validate --json`'s `{ok:false,error}` is a legitimate state (exit 1), rendered inline with the engine's own text (the exact server startup failure text); editing disabled until it parses.
6. **Credential containment (Task 4, pinned).** `buildGovernanceCliEnv` scrubs EVERY `IRIS_*` variable from the ambient extension-host env (so `IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_PROFILES` — and ambient `IRIS_GOVERNANCE*` — can never reach the subprocess), then re-adds only the extension's own `governance`/`governancePreset` settings so the preview computes the same env channel spawned servers see. Pinned by unit tests incl. a distinctive-secret behavioral sweep; the containment.test.ts update-arguments pin now asserts EXACTLY two config writes extension-wide (`servers` + `governanceFile`, both non-secret), cross-checked against `settings.ts`'s reads. The second write uses the same two-statement idiom as `updateServersConfig` so the single-expression-chain grep stays green.
7. **Passthrough (Task 1).** `irisMcpLauncher.governanceFile` (default `""` = unset, window scope — an inert JSON path, not an executable selector like machine-scoped `developmentRepoPath`) added to package.json/settings.ts/types.ts + `env.ts`'s `GOVERNANCE_PASSTHROUGH` (emitted as `IRIS_GOVERNANCE_FILE`) and `LAUNCHER_OWNED_VARS` (explicit-null cleared when unset). The two whole-object env fixtures (selectServers.test.ts, serverDefinitionProvider.test.ts) gained `IRIS_GOVERNANCE_FILE: null` — the sanctioned roster update, not a weakened assertion.
8. **Test tier (Task 4).** +3 extension test files (55 tests): `governanceEngine.test.ts` (17 — resolution order, env scrub, argv wire shapes, spawn seams), `governanceView.test.ts` (23 — tabs, toggles, staged→set/unset mapping, pending preview, groups/badges, HTML incl. escaping), `governancePanel.test.ts` (15 — full flows: empty state, refresh sequence, stage→save→refresh, save-failure abort, tab caching, missing/invalid file, chooseFile, discard, singleton reveal, marker-containment). CLI-output fixtures shaped EXACTLY like the real bin (capture commands cited in file headers, Rule #36); vscode shapes not extended — the panel is driven through injected fakes in shapes the real API produces (Rule #54). Shared: `governance-cli-universe.test.ts` (20) + one real-bin `universe` case in the dist-packaging test + `universe` added to the e2e all-read-commands JSON-contract loop (now five).
9. **Docs (Task 5, Rules #30/#43).** Extension README "Governance editor" section (capability, engine resolution, containment, `governanceFile` default state, restart-to-apply) + settings-table row; extension CHANGELOG (editor + setting); root README CLI table `universe` row + caveat paragraph updated; packages/shared/README CLI bullet + single-sourcing list + caveat updated; new changeset `.changeset/governance-cli-universe.md` (`@iris-mcp/shared` patch). PD-3 reload semantics documented at every surface: view reflects file state at open/refresh; restart a server to apply.
10. **AC 32.2.4 stays OPEN for the Project Lead** (the 31.4.4/31.5.4 honest-deferral pattern — the dev environment is headless). Procedure below.

#### AC 32.2.4 — manual smoke procedure (for the Project Lead; the F2 success-metric round-trip)

Environment fields to fill in: VS Code version: __________ · Server Manager extension version: __________ · Suite commit: __________

1. Build + package: `cd extensions/iris-mcp-launcher && npm run build && npm run package` (produces `iris-mcp-launcher-0.1.0.vsix`). Install it: Extensions view → `…` → "Install from VSIX…".
2. In User settings, set `irisMcpLauncher.developmentRepoPath` to this monorepo checkout (absolute path; required until `@iris-mcp/*` is published — `packages/shared` must be built).
3. Set `irisMcpLauncher.governanceFile` to a NEW absolute path, e.g. `C:\governance\smoke-32-2.json` (must not exist yet).
4. Run "IRIS MCP Launcher: Open Governance Editor" from the Command Palette. VERIFY: the missing-file banner appears (server would fail to start); the universe renders grouped per package (this also proves the CLI subprocess resolution works end-to-end in the real extension host).
5. In the `global (file)` tab, toggle a WRITE tool (e.g. `iris_doc_put`) to **disabled**. VERIFY: it lands in "Pending changes (1)" with `inherit (unset) → disabled (false)`. Click **Save**. VERIFY: pending clears; the row now shows `disabled` + a `file` configSource badge; the file now exists on disk with `"global": { "iris_doc_put": false }`.
6. Restart the MCP server (Copilot: restart the "IRIS Dev Tools — <server>" server, or Reload Window) so it re-reads the file at startup.
7. Under a real agent (Copilot Chat), call `iris_server_profiles` on that server. VERIFY: `governance.policy.iris_doc_put === false` and `governance.configSource.iris_doc_put === "file"`.
8. Call `iris_doc_put` (any trivial arguments). VERIFY: the call is REFUSED with `GOVERNANCE_DISABLED`.
9. Cleanup: in the editor, toggle `iris_doc_put` back to **inherit** and Save (or delete `C:\governance\smoke-32-2.json` and clear the `governanceFile` setting); restart the server and confirm the tool is callable again.

Expected result: steps 4–8 pass with no manual JSON editing at any point (the UI→file→server→gate round-trip, the F2 success metric). Record versions + outcome in this story's notes, then check AC 32.2.4.

**Scope note (added at code review):** this procedure exercises the engine's LOCAL mode (`developmentRepoPath` → the checkout's built CLI) — the only resolvable mode until `@iris-mcp/*` is published. The published npx mode (`npx -y -p @iris-mcp/shared …`, including the `universe` command's six-package sibling-dist derivation and, on Windows, the `cmd.exe /d /s /c` spawn wrapping added at review) has NO live evidence yet by design; its first real exercise is the post-publish smoke (belongs with the 31-4-7 publish-gate checklist).

### File List

- `packages/shared/src/cli/governance.ts` (modified — additive `universe` command, deps seam, help text)
- `packages/shared/src/__tests__/governance-cli-universe.test.ts` (new — 20 tests)
- `packages/shared/src/__tests__/governance-cli-dist-packaging.test.ts` (modified — real-bin `universe` case)
- `packages/shared/src/__tests__/governance-cli-e2e.test.ts` (modified — `universe` in the all-read-commands JSON-contract loop)
- `packages/shared/README.md` (modified — `universe` bullet, single-sourcing list, caveat)
- `README.md` (modified — CLI table `universe` row, read-commands list, caveat)
- `.changeset/governance-cli-universe.md` (new — `@iris-mcp/shared` patch changeset)
- `extensions/iris-mcp-launcher/package.json` (modified — `governanceFile` setting, `openGovernanceEditor` command)
- `extensions/iris-mcp-launcher/src/types.ts` (modified — `LauncherSettings.governanceFile`)
- `extensions/iris-mcp-launcher/src/settings.ts` (modified — read `governanceFile`)
- `extensions/iris-mcp-launcher/src/env.ts` (modified — `IRIS_GOVERNANCE_FILE` passthrough + owned-var)
- `extensions/iris-mcp-launcher/src/governanceEngine.ts` (new — subprocess resolution, env scrub, argv, spawn)
- `extensions/iris-mcp-launcher/src/governanceView.ts` (new — pure view-model + HTML)
- `extensions/iris-mcp-launcher/src/governancePanel.ts` (new — panel orchestration)
- `extensions/iris-mcp-launcher/src/extension.ts` (modified — command registration + adapters)
- `extensions/iris-mcp-launcher/src/__tests__/governanceEngine.test.ts` (new — 17 tests; 21 after review)
- `extensions/iris-mcp-launcher/src/__tests__/governanceView.test.ts` (new — 23 tests; 25 after review)
- `extensions/iris-mcp-launcher/src/__tests__/governancePanel.test.ts` (new — 15 tests; 21 after review)
- `extensions/iris-mcp-launcher/src/__tests__/governanceActivationFlow.test.ts` (new, QA — 5 tests; 6 after review)
- `extensions/iris-mcp-launcher/src/__tests__/governanceEngineRealCli.test.ts` (new, QA — 4 tests)
- `extensions/iris-mcp-launcher/src/__tests__/governanceUiRoundTrip.test.ts` (new, QA — 1 test)
- `extensions/iris-mcp-launcher/src/__tests__/governanceHtmlSafety.test.ts` (new, QA — 3 tests)
- `extensions/iris-mcp-launcher/src/__tests__/vscodeMock.ts` (modified, QA — webview/openDialog/ViewColumn fake shapes; review added the workspace-scope config layer)
- `extensions/iris-mcp-launcher/src/__tests__/containment.test.ts` (modified — two-write pin, settings helper)
- `extensions/iris-mcp-launcher/src/__tests__/definitions.test.ts` (modified — settings helper)
- `extensions/iris-mcp-launcher/src/__tests__/env.test.ts` (modified — settings helper)
- `extensions/iris-mcp-launcher/src/__tests__/localSpawnIntegration.test.ts` (modified — settings helper)
- `extensions/iris-mcp-launcher/src/__tests__/selectServers.test.ts` (modified — settings helper, env fixture)
- `extensions/iris-mcp-launcher/src/__tests__/serverDefinitionProvider.test.ts` (modified — settings helper, env fixture)
- `extensions/iris-mcp-launcher/README.md` (modified — Governance editor section, settings row)
- `extensions/iris-mcp-launcher/CHANGELOG.md` (modified — 0.1.0 entry)

### Change Log

- 2026-07-27: Story 32.2 dev complete. Extension governance UI (webview editor) over the Story 32.1 CLI via subprocess; additive shared-CLI `universe` command (full governed universe from built dist, real classifications); `irisMcpLauncher.governanceFile` setting + `IRIS_GOVERNANCE_FILE` passthrough; credential-scrubbed subprocess env; AC 32.2.3 recorded check PASS (CLI render matches a running server's `iris_server_profiles` key-for-key over all 151 server-reported keys); AC 32.2.4 left OPEN with a lead procedure. Extension 16 files/290 tests (+55); shared 64 files/1273 (+21).
- 2026-07-27: QA added 4 test files (+13: activation flow 5, real-CLI engine e2e 4, wire round-trip 1, HTML safety 3) → extension 20 files/303.
- 2026-07-27: Code review (bmad-code-review; all three layers returned + reviewer-direct verification). 0 decision-needed / 19 patch (all applied + pinned, +14 extension tests / +1 shared test) / 1 defer (LOW) / 2 dismissed. Headline patches: npx-mode spawn was dead on Windows (`spawn("npx")` → ENOENT on the `.cmd` shim — verified empirically; now routed through `cmd.exe /d /s /c` with argv intact); `GLOBAL_TAB` sentinel collided with a real profile named "global" (silent wrong-layer edits — sentinel moved out of the profile namespace); partial-save retry wedge (a replayed `unset` fails "nothing to unset" forever — applied edits now drop from `staged` as they land); hung-CLI session wedge (spawn timeout + kill, busy reset on panel dispose); IRIS_* env scrub made case-insensitive (Windows env lookup is case-insensitive); choose-file writes to the owning settings scope via inspect (was hardcoded Global, silently shadowed by a workspace value). AC 32.2.3's "byte-for-byte" overclaim amended in epics.md to the accurate subset-agreement claim; story record reconciled post-QA (Rule #51). Final tallies: extension 20 files/317, shared 64 files/1274, all green.

### Review Findings

Code review 2026-07-27 (bmad-code-review). Layers: blind-hunter (13 findings), edge-case-hunter (14), acceptance-auditor (5) — all three returned this run (they died on the API-limit event in the killed first attempt); PLUS reviewer-direct verification per the carried retro directive (empirical: `spawn("npx")` ENOENT on win32, `cmd.exe /d /s /c` fix verified with a spaced-path arg, `universe --json` live recount 202/61, baseline `:check` exit 0, HEAD lint-warning provenance, QA live tiers re-executed 8/8 unskipped). Triage: 0 decision-needed / 19 patch / 1 defer / 2 dismissed.

Patches (all applied and pinned by tests):
- [x] [Review][Patch] npx-mode governance CLI spawn dead on Windows — `spawn("npx")` cannot execute the `npx.cmd` shim (ENOENT pre-20.12, EINVAL since CVE-2024-27980); the documented post-publish production mode failed on the primary platform with a misleading message. Fixed via `cmd.exe /d /s /c` routing (argv intact, verified with a spaced path; `shell:true` rejected — DEP0190 unescaped concatenation). `.exe` commands (local mode) unwrapped. [governanceEngine.ts] (edge-1 HIGH, auditor-4, reviewer-direct)
- [x] [Review][Patch] IRIS_* env scrub was case-sensitive on a case-insensitive platform — ambient lowercase `iris_password`/`iris_governance` reached the CLI subprocess. Now `toUpperCase()`-scrubbed + pin. [governanceEngine.ts] (blind-M3, edge-2, auditor-2)
- [x] [Review][Patch] `GLOBAL_TAB = "global"` collided with a legitimate profile/server named "global" — duplicate tab id, and the profile's edits+preview silently retargeted the GLOBAL layer. Sentinel moved out of the profile namespace (`"\0global"`) + collision pins. [governanceView.ts] (blind-M1, edge-6)
- [x] [Review][Patch] Partial-save retry wedge: applied edits stayed in `staged`, so a retry replayed an already-applied `unset` → "nothing to unset" abort at the sequence head forever. `save()` now drops each edit as it applies; the failed + remaining edits stay staged. [governancePanel.ts] (edge-3, blind-L5)
- [x] [Review][Patch] `stage`/`discard` were not busy-guarded — a mid-save toggle was silently wiped by the post-save clear; a mid-save Discard cleared staged while the snapshot commands kept writing. Both guarded. [governancePanel.ts] (edge-4, blind-L4)
- [x] [Review][Patch] The opener's reveal path bypassed the busy guard — a double-invoke mid-save ran a concurrent full refresh interleaved with the save's CLI writes. Reveal-only while busy now. [governancePanel.ts] (edge-5)
- [x] [Review][Patch] Hung CLI wedged the panel for the session: no spawn timeout, and `busy` survived panel dispose in the same closure. Added a 120s (injectable) timeout that kills the child and resolves a spawnError, and `busy` resets on dispose. [governanceEngine.ts, governancePanel.ts] (blind-M2, edge-8, auditor-3)
- [x] [Review][Patch] Choose File… hardcoded `ConfigurationTarget.Global` — a workspace-scoped `governanceFile` silently shadowed the write on the next read. Now inspect-then-write-to-the-owning-scope (the selectServers `resolveWriteTarget` discipline); vscodeMock gained the workspace-scope config layer; activation pin 32-2-6. [extension.ts, vscodeMock.ts] (blind-L3, edge-7)
- [x] [Review][Patch] CLI-JSON vocabulary fields (`mutates`, `configSource`, diff `file=`/`default=`) were interpolated into the webview HTML unescaped (TS types over JSON.parse are not runtime guarantees). Now String-coerced + escaped. [governanceView.ts] (blind-L1, edge-13)
- [x] [Review][Patch] The `stage` message had no runtime validation — a malformed message staged a silent key deletion or an unknown key the CLI warns-but-writes. Now tri-state value + universe-key membership checked (the switchProfile discipline). [governancePanel.ts] (blind-L2)
- [x] [Review][Patch] `--root ""` was silently treated as auto-detect — now exit 2 usage (the 32.1 `--file ""` discipline) + pin. [cli/governance.ts] (blind-L6)
- [x] [Review][Patch] `frameworkTool.keys` was hardcoded while the duplicate guard derived it — output/derivation drift waiting to happen; the derived array is now reused for both. [cli/governance.ts] (blind-L7, edge-10)
- [x] [Review][Patch] A malformed success-status `universe` payload crashed the render and the message-pump catch swallowed it with zero diagnostics — minimal shape guard → inline load error. [governancePanel.ts] (blind-L9)
- [x] [Review][Patch] Published npx mode has zero live evidence pre-publication — now named explicitly in the AC 32.2.4 procedure (local mode only; npx's first exercise is the post-publish smoke). [this story] (blind-L10)
- [x] [Review][Patch] AC 32.2.3's "byte-for-byte" overclaim: the recorded check is key-for-key agreement over the server's reported key universe (151 keys), not literal output equality (CLI renders 202). epics.md amended in place (original wording + dated rationale, the AC 31.0.3/31.6.1 pattern); the webview summary line qualified. [epics.md, governanceView.ts] (auditor-1)
- [x] [Review][Patch] Story record stale post-QA (Rule #51): File List omitted the four QA test files + vscodeMock; tallies were dev-stage only. Reconciled (20 files/317 extension, 64/1274 shared — mechanically recounted). [this story] (auditor-5)
- [x] [Review][Patch] `fileProfileNames`'s layer-label regex couldn't match a profile name containing a newline (`[\s\S]` now) + pin. [governanceView.ts] (edge-9)
- [x] [Review][Patch] `governanceFile` wasn't trimmed (developmentRepoPath was) — a pasted trailing space produced the scary missing-file banner with no hint. Trimmed + pin. [settings.ts] (edge-11)
- [x] [Review][Patch] The new dist-packaging `universe` case spawned the bin WITHOUT a scrubbed env — ambient `IRIS_GOVERNANCE`/`IRIS_GOVERNANCE_FILE` could fail it on a correctly-configured machine (the 32-1-R1 class, a NEW instance). Case-insensitive scrub added. [governance-cli-dist-packaging.test.ts] (reviewer-direct)

Deferred:
- [x] [Review][Defer] Sync `statSync` on the extension host in the engine/panel path (UNC `developmentRepoPath`/file paths stall the single-threaded host ~1.3s+; the 31-6-2 fix converted the same class to fs/promises) — deferred: the fix is an async refactor of the sync `describe()`/resolution seam the render path depends on, not a one-liner; LOW frequency (UNC paths only). [governanceEngine.ts, extension.ts] (blind-L8)

Dismissed (2): edge-12 (`universe --file ""` renders the documented no-file mode via the 32.1-patched `resolveFilePath` — not a false-valid; no-file is a legitimate universe mode) · edge-14 (a non-`file:`-scheme open-dialog result is pathological — real local/remote windows return usable `fsPath`s; any failure surfaces loudly in the missing-file banner).
