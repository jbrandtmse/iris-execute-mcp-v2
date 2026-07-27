# Blind Hunter review — Story 32.2 (governance UI)

Scope: `.claude/scratch/32-2-fulldiff.txt` (5,479 lines — tracked `git diff HEAD` + untracked new files), read in full. Diff-only review; no spec consulted. 13 findings: 0 HIGH, 3 MEDIUM, 10 LOW.

---

## MEDIUM

### M1 — `GLOBAL_TAB = "global"` collides with a real profile/server named "global": edits AND preview silently target the wrong layer
- **Severity:** medium (CONFIRMED from the diff)
- **Evidence:** `governanceView.ts:93` (`export const GLOBAL_TAB = "global"`), with the comment claiming "the id lives outside the profile namespace" — it does not. `computeProfileTabs` (governanceView.ts:150-156) prepends `GLOBAL_TAB` and then appends profile names verbatim from Server Manager and from `fileProfileNames(diff)` — a Server Manager server (or a file profile) literally named `global` produces tabs `["global", "default", …, "global"]`: two tabs with the SAME id. `renderTabs` (governanceView.ts:439-447) labels BOTH "global (file)". `layerForTab`/`renderProfileForTab` (governanceView.ts:159-166) return `undefined`/`"default"` for any tab === "global", so on the profile-"global" tab: the universe preview renders the `default` profile, and every staged toggle maps to `set`/`unset` WITHOUT `--profile` (`stagedCliCommands`, governanceView.ts:227-244) — a governance edit intended for the `global` PROFILE lands in the file's GLOBAL layer, silently. No test names a profile "global" (the computeProfileTabs pin at diff line 3443 uses only "prod"/"default"). Fix: a sentinel outside the string namespace (e.g. `"\0global"`), or filter/rename-collide with a warning.

### M2 — `busy` is never reset on panel dispose + `runGovernanceCli` has no timeout: a hung CLI wedges the singleton panel for the session
- **Severity:** medium (logic CONFIRMED; trigger PLAUSIBLE)
- **Evidence:** `busy` lives in the `createGovernancePanelOpener` closure (governancePanel.ts:105); `onDispose` resets `panel`/`state` but NOT `busy` (governancePanel.ts:360-363). `runGovernanceCli` (governanceEngine.ts:265-311) has no timeout and no cancellation — the promise settles only on `close`/`error`. A hung child (first-run `npx -y -p @iris-mcp/shared -p …×5 universe` downloading six packages over a stalled network, which can block for many minutes) leaves `busy === true` forever. After the user closes and reopens the panel, every guarded message (`chooseFile`/`refresh`/`save`/`switchProfile` universe-load — governancePanel.ts:276-345) silently returns early with zero feedback: the editor is dead until window reload. Even the non-wedge case is user-visible: during a multi-minute first-run npx download, every button click is silently ignored. Fix: reset `busy` in `onDispose` and add a timeout (render an inline error) to `runGovernanceCli`.

### M3 — the IRIS_* env scrub is case-sensitive on a case-insensitive platform: ambient lowercase `iris_*` vars reach the CLI and change its cascade render
- **Severity:** medium (CONFIRMED asymmetry)
- **Evidence:** `buildGovernanceCliEnv` scrubs with `name.startsWith("IRIS_")` (governanceEngine.ts:174-178). Windows env lookups are case-insensitive, so an ambient `iris_governance` or `iris_password` (lowercase/mixed-case, e.g. set via `set iris_governance=…`) is NOT scrubbed — and the spawned CLI reads `process.env.IRIS_GOVERNANCE` case-insensitively, so the ambient governance channel the module banner swears can "never reach the subprocess" does reach it and alters the `universe`/`effective` render (and credential material reaches a process the containment contract says never receives it). The story's own QA proves the authors know the semantics: `governanceUiRoundTrip.test.ts:3100-3104` scrubs the child env with `/^iris_/i` ("CASE-INSENSITIVELY"). All `buildGovernanceCliEnv` unit pins (governanceEngine.test.ts:1835-1889) use uppercase only — nothing pins the lowercase case. Fix: `name.toUpperCase().startsWith("IRIS_")`.

---

## LOW

### L1 — several CLI-JSON-derived values are interpolated into the webview HTML UNESCAPED (TS types over `JSON.parse` are not runtime guarantees)
- **Severity:** low (CONFIRMED)
- **Evidence:** `${row.mutates}` (governanceView.ts:505), `${configSourceBadge(row.source)}` (:508), and the diff preview's `file=${entry.file}` / `default=${entry.default}` (:476) are interpolated raw. The values come from `universe --json` / `diff --json` — a hostile or buggy CLI (a `developmentRepoPath` the user pinned, a compromised publish) can emit arbitrary strings where the TS types claim `"read"|"write"`, `"env"|"file"|…`, `boolean`. The QA hostile-fixture test (`governanceHtmlSafety.test.ts`) uses TAME values for exactly these fields, so nothing pins them. Mitigation exists: the strict nonce-CSP (`script-src 'nonce-…'` without `'unsafe-inline'`, governanceView.ts:566/598) blocks inline script/handlers, so impact is HTML spoofing inside the webview — including forged `[data-msg]` buttons the click handler (governanceView.ts:408-411) will faithfully `JSON.parse` and post (chains into L2). Fix: `escapeHtml`/`String(...)` on these too — it costs nothing.

### L2 — the `stage` message handler has no runtime validation (unknown keys are written; unknown values coerce to "unset"), unlike `switchProfile`'s defensive check
- **Severity:** low (CONFIRMED)
- **Evidence:** `case "stage"` (governancePanel.ts:323-329) passes `message.key` straight to `stageToggle` — no membership check against the universe keys, while `case "switchProfile"` validates `state.profileTabs.includes(message.profile)` (governancePanel.ts:332) and the panel test praises that defensiveness (governancePanel.test.ts:2867). `stageToggle` maps any value other than "enabled"/"disabled" to `"unset"` (governanceView.ts:207), so a malformed message silently stages a key DELETION. And the CLI `set` "warns (but writes)" for unknown keys (cli/governance.ts HELP text, diff line 907), while `save()` ignores stderr on exit 0 (governancePanel.ts:253-267) — an unknown key lands in the governance file reported as success. Fix: validate key against `universeByTab[activeTab].keys` and value against the tri-state enum at the message boundary.

### L3 — Choose File… always writes `ConfigurationTarget.Global`: a workspace-scoped `governanceFile` silently shadows the write
- **Severity:** low (CONFIRMED behavior; pinned deliberate by test)
- **Evidence:** `config.update(GOVERNANCE_FILE_SETTING_KEY, filePath, vscode.ConfigurationTarget.Global)` (extension.ts:606, pinned by activation test 32-2-3 at diff line 1643). `irisMcpLauncher.governanceFile` is window-scoped (package.json, diff line 158-162 — no `scope` restriction), so a user who set it at WORKSPACE scope gets: dialog write succeeds → Global value set → the Workspace value still wins on read → `refresh()` re-reads the OLD path and the editor reopens the previous file with no warning. The 31.5 servers write picks the owning scope via `inspect()`; this write hardcodes Global. Fix: mirror the `TARGET_LABEL`/`inspect` scope-selection from selectServers.

### L4 — a toggle staged DURING a save is silently wiped
- **Severity:** low (CONFIRMED race)
- **Evidence:** `case "stage"` is not busy-guarded (governancePanel.ts:323-329) while `save()` holds `busy` across its awaits and finishes with `state = clearStaged(state)` (governancePanel.ts:269) over the LIVE state — any edit the user staged mid-save (realistic under npx mode, where each `set` costs an npx round-trip of seconds) is discarded with no notice. Fix: recompute the clear against the captured command list, or guard `stage` with `busy`.

### L5 — a partially-failed save leaves already-applied edits in the pending list
- **Severity:** low (CONFIRMED UX inconsistency)
- **Evidence:** on write failure `save()` returns without pruning the staged entries that already succeeded (governancePanel.ts:252-267) and without refreshing — the pending table keeps showing applied edits as pending, and toggle positions keep rendering from the pre-save diff snapshot until a manual Refresh. Retry re-applies them (idempotent, so no corruption — but the UI lies in the interim).

### L6 — `--root ""` is silently treated as unset, inconsistent with the 32.1-reviewed `--file ""` discipline
- **Severity:** low (CONFIRMED)
- **Evidence:** `resolveContainerDir` treats `root === ""` as absent and auto-detects (cli/governance.ts:955-966). The Story 32.1 code review patched `--file ""` to exit 2 (usage) for exactly this shape (recorded in this diff's sprint-status hunk, line 41). Same fix should apply to `--root`.

### L7 — `frameworkTool.keys` is hardcoded while the duplicate guard derives it — output/derivation drift waiting to happen
- **Severity:** low (CONFIRMED)
- **Evidence:** the guard derives `deriveKeysForTool(serverDiscoveryTool, "framework")` (cli/governance.ts:1114) but the JSON emits `frameworkTool: { name, keys: [SERVER_DISCOVERY_TOOL_NAME] }` (:1194). If the framework tool ever gains action keys, the emitted group disagrees with the derived universe. The same module documents "derived, never mapped" for `candidateToolEntries` (:977-984). Fix: emit the derived array.

### L8 — sync `statSync` on the extension host in the panel path (the class 31-6-2 eliminated)
- **Severity:** low (CONFIRMED)
- **Evidence:** `defaultFileExists` (governanceEngine.ts:89-95) and the `fileExists` adapter (extension.ts:584-590) are guarded but SYNCHRONOUS. A UNC `developmentRepoPath` or governance-file path stalls the single-threaded extension host (measured ~1.3s for a nonexistent UNC host in the 31-6-2 record, worse for a hung SMB share) when the panel opens/refreshes. The 31-6-2 fix converted the identical spawn-validation stats to `fs/promises`; this story reintroduces sync stats one module over.

### L9 — malformed/skewed `universe` JSON (exit 0, no `error`, missing `packages`) crashes render and the `onMessage` catch swallows it with zero diagnostics
- **Severity:** low (PLAUSIBLE)
- **Evidence:** `runRead` shape-checks nothing beyond status/error-field (governancePanel.ts:122-143); `buildGroups` does `universe.packages.map` unguarded (governanceView.ts:314); the handler wrapper is `void onMessage(message).catch(() => undefined)` (governancePanel.ts:358) — a version-skewed or buggy CLI emitting a success-status malformed payload leaves a stale panel with no banner and no log. The realistic old-CLI skew (no `universe` command) IS handled (exit 2 → loadError); the malformed-shape case is not. Fix: a minimal shape guard in `runRead`/`buildGroups`, and log swallowed handler errors.

### L10 — published-mode `universe` (npx `-p` ×6, sibling-dist `file://` import bypassing `exports`) has zero live evidence pre-publication
- **Severity:** low (PLAUSIBLE residual risk)
- **Evidence:** the AC 32.2.3 live agreement check ran LOCAL mode (built checkout). The npx path — six `-p` installs landing as `node_modules/@iris-mcp/{shared,dev,…}` siblings, `resolveContainerDir` three-up auto-detect (cli/governance.ts:965), `import(pathToFileURL(entry))` of each package's `dist/tools/index.js` resolving THAT package's own deps from the npx cache — is untestable until `@iris-mcp/*` publishes, and every fallback it has is fail-closed (an error banner), so the risk is "feature dead on arrival in published mode", not wrong behavior. Should be named in the AC 32.2.4 smoke procedure explicitly (it is the first real exercise of this path).

---

## Checked and found clean

- CSP handling: nonce generated per render, single nonced script tag, `default-src 'none'`, no `unsafe-inline` for scripts — QA test pins it.
- All user/CLI TEXT surfaces (file path, profile/tab names, validation error, load error, engine note, keys, diff layer labels) go through `escapeHtml`, incl. quote-escaping inside `data-msg` attributes (pinned hostile).
- `__proto__`-safe emission in the CLI (`Object.defineProperty` on `mutatesOut`; `--profile "__proto__"` rejected exit 2 BEFORE any dist load — pinned).
- Duplicate-key and reserved-framework-tool guards in `universe` are hard errors naming both origins (pinned via injected loader).
- Argv construction is shell-free throughout (spawn with arg arrays; profile names with spaces/quotes are safe).
- `validate` exit-1-with-JSON is correctly treated as a legitimate outcome, not a load failure.
- The new test suites are genuine: real-CLI engine E2E, UI→file→server round-trip with a real handshake + `GOVERNANCE_DISABLED` enforcement, an INDEPENDENT dist-loaded oracle for the no-drift proof, hostile HTML fixtures. No test-that-cannot-fail found in the new files; the gaps are the unpinned cases named above (profile named "global", lowercase env scrub, tame mutates/configSource values in the HTML-safety fixtures).
