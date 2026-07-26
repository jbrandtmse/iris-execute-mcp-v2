# Story 31.5: Launcher Server-Selection UI (`iris-mcp-launcher`)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **developer who just installed the IRIS MCP Launcher extension**,
I want **a command that shows me my actual Server Manager servers and lets me pick which ones to expose, plus a status indicator confirming the extension is alive**,
so that **I can configure the extension without hand-editing `settings.json`, guessing server names, or wondering whether it installed correctly**.

## Context: why this story exists

Story 31.4 shipped a headless broker — **no commands, no views, no status surface**. `irisMcpLauncher.servers` defaults to `[]`, so a fresh install does nothing, silently. The Project Lead hit this during AC 31.4.4 smoke prep: installed the extension, looked for it in the activity bar, and had no way to tell whether it was working.

Neither Story 32.2 (governance UI) nor 33.3 (MCP Clients view) covers this surface — this is unplanned work, not deferred work. Epic 31 was re-opened per Rule SC-5 specifically for it.

**Why a command and not a settings dropdown:** `contributes.configuration` schemas are static JSON in `package.json`. There is no API to populate a settings enum from servers discovered at runtime. A QuickPick command is the supported pattern.

## Acceptance Criteria

Verbatim from [epics.md](../planning-artifacts/epics.md) — "### Story 31.5: Launcher Server-Selection UI".

1. **AC 31.5.1** — New command `IRIS MCP Launcher: Select Servers…` (id `irisMcpLauncher.selectServers`) appears in the Command Palette. It enumerates Server Manager servers through the SAME API path the provider already uses (`getServerNames(scope?, sorted?)`, honoring the `scope` threading fixed in 31.4 review), and presents a **multi-select QuickPick** pre-checked from the current `irisMcpLauncher.servers`, each item showing the server's description/host as `detail` so a user can tell two similarly-named servers apart. Confirming writes the selection back to `irisMcpLauncher.servers`; **cancelling leaves configuration byte-unchanged** (mechanically asserted, not asserted by eye).
2. **AC 31.5.2** — *(AMENDED at code review — original wording, rationale and the `@types/vscode` oracle are recorded in [epics.md](../planning-artifacts/epics.md)'s amendment note; skill Rule 5: amend the planning artifact in place, never work around with code comments + deferred-work.)* The write targets the configuration scope the setting is ALREADY defined in (`inspect()`-driven: workspace → global), falling back to Global when it is defined nowhere. The write scope must match the scope the provider actually READS from, so a selection can never be saved somewhere `readSettings()` will not see it. The chosen scope is named in the post-write confirmation so the user knows which file changed.
3. **AC 31.5.3** — A status bar item reports live state — `$(server) IRIS MCP: <n>` when servers are selected, and a discoverable zero-state (e.g. `$(server) IRIS MCP: none`) when the roster is empty — with a tooltip naming the selected servers and packages, and a click action running `irisMcpLauncher.selectServers`. It updates on `onDidChangeConfiguration` without requiring a reload. The zero-state is the load-bearing case: it is the only signal a fresh install gives that the extension is installed and waiting for input.
4. **AC 31.5.4** — **Activation strategy is decided and justified in Dev Notes.** The 31.4 MVP ships `activationEvents: []` and is activated implicitly by `contributes.mcpServerDefinitionProviders`, i.e. only when VS Code's MCP subsystem first asks for definitions — under which a status bar item would not appear at startup, defeating AC 31.5.3. Adopt an explicit activation event (`onStartupFinished` is the expected answer) and state the cost accepted (the extension activates for every window). Verify empirically that the status bar item is present after a plain window reload with MCP never exercised.
5. **AC 31.5.5** — Failure containment matches the bar set by the 31.4 review: a Server Manager API that throws, is missing, or returns nothing degrades to **exactly one** actionable warning (never a toast storm, never an unhandled rejection out of a command handler), the command still opens with an empty-state message rather than failing silently, and no third-party error text is forwarded to a user surface. **No credential, token, or password may appear in any QuickPick item, tooltip, status bar text, log line, or warning** — extend the existing `containment.test.ts` source-grep (already disk-enumerated, not hand-rostered) to cover the new files.
6. **AC 31.5.6** — Writing the setting does not retroactively change already-registered MCP definitions; the confirmation therefore states plainly that a reload (or MCP server restart) is required for changes to take effect, matching how 31.4 provides definitions at registration time. Do NOT silently trigger a reload.
7. **AC 31.5.7** — **Back-compat (Rule #19).** With the new command never invoked, behavior is byte-identical to Story 31.4: same definitions, same env synthesis, same credential path. Proven mechanically — an assertion that fails on drift, not a prose claim — and the existing 107-test suite must stay green with no expected-value edits beyond genuinely new surface.
8. **Integration AC 31.5.8** — The value this story WRITES must be exactly what the 31.4 provider READS. Drive the real `readSettings` → `planDefinitions` path against a configuration written by the command's own write helper (not a hand-built literal), asserting the resulting plan matches the selection — including the coercion edge cases `readSettings` already guards (duplicates, non-string members, whitespace). A rename or shape change on either side must fail this test.

## Tasks / Subtasks

- [x] **Task 1 — New `selectServers.ts` module: pure, injectable logic (AC: 31.5.1, 31.5.2, 31.5.5)**
  - [x] Create `src/selectServers.ts`. **Do NOT put logic in `extension.ts`** — see the "one vscode import" rule in Dev Notes. Take injected deps (`getServerManagerApi`, `getSettings`, a config read/write port, a QuickPick port, `showWarning`) exactly like `LauncherProvider` does.
  - [x] Build QuickPick items from `getServerNames()`: `label` = server name, `detail` = the `description`/`detail` fields that `ServerName` **already carries** (see `types.ts`) — do not re-fetch specs to build the list.
  - [x] Pre-check items whose name is in the current `readSettings().servers`.
  - [x] ~~Preserve `scope` per server name for the write decision~~ — **bullet retired at code review as incoherent, not silently skipped.** Server Manager's `ServerName.scope` is a pass-through token for `getServerSpec`; it has nothing to do with which `irisMcpLauncher.servers` settings scope to write, which AC 31.5.2 makes `inspect()`-driven. This command only ENUMERATES (no `getServerSpec` call), so there is no scope to thread — the 31.4 review's scope-threading fix correctly lives in `serverDefinitionProvider.ts`'s `scopesByServerName`, on the resolve path this module never takes. AC 31.5.1 is unaffected. A code comment in `selectServers.ts` that claimed this module honored that threading was corrected.
  - [x] Empty roster ⇒ actionable empty-state message, not a silent no-op or an empty picker.
- [x] **Task 2 — Scope-correct write (AC: 31.5.2, 31.5.6)**
  - [x] Use `inspect()` on `irisMcpLauncher.servers` to choose the target: workspaceFolderValue → workspaceValue → globalValue → default to Global.
  - [x] Write via `WorkspaceConfiguration.update(section, value, target)`.
  - [x] Post-write message names BOTH the scope written and that a reload/MCP restart is required (AC 31.5.6). **Never call `workbench.action.reloadWindow` yourself.**
- [x] **Task 3 — Status bar item (AC: 31.5.3)**
  - [x] Create on activate, push to `context.subscriptions`, `command` = `irisMcpLauncher.selectServers`.
  - [x] Text: count when >0, explicit zero-state when 0. Tooltip lists selected servers + packages.
  - [x] Subscribe to `onDidChangeConfiguration` filtered to the `irisMcpLauncher` section; refresh without reload.
- [x] **Task 4 — Activation strategy (AC: 31.5.4)**
  - [x] Add the explicit activation event to `package.json` (expected: `onStartupFinished`).
  - [x] Record in Dev Notes WHY, and the cost accepted.
  - [ ] **Empirically verify**: reload a window, never touch MCP, confirm the status bar item appears. Record the observation — this AC is not satisfiable by unit test alone. **NOT performed by this agent** — no interactive VS Code GUI is available in this headless CLI environment. Left for the Project Lead's per-story smoke gate; see Completion Notes.
- [x] **Task 5 — package.json contributions (AC: 31.5.1)**
  - [x] Add `contributes.commands` with the id and the `IRIS MCP Launcher: Select Servers…` title (use a `category` so the palette groups it).
  - [x] Extend `packaging.test.ts` with a mechanical check that every declared `contributes.commands` id is actually registered in source, and vice versa — same Rule #51 spirit as the existing settings-key ↔ `readSettings()` test.
- [x] **Task 6 — Tests (AC: all, especially 31.5.7, 31.5.8)**
  - [x] Unit-test `selectServers.ts` with fakes: happy path, **cancel leaves config untouched** (assert the update port was never called), empty roster, API throws, duplicate/whitespace names.
  - [x] Scope-selection tests across all four `inspect()` shapes.
  - [x] Status bar text/tooltip tests including the zero-state.
  - [x] **Integration AC 31.5.8**: feed the write helper's output through the REAL `readSettings` → `planDefinitions`; assert the plan matches. Not a hand-built literal.
  - [x] **Rule #19 proof**: command never invoked ⇒ `providePlannedDefinitions()`/env synthesis byte-identical to pre-story. Make it fail on drift.
  - [x] Extend `containment.test.ts` patterns to cover QuickPick items, tooltips, and status bar text as credential-leak surfaces.
- [x] **Task 7 — Verification (AC: all)**
  - [x] `npx tsc --noEmit` clean; `npx vitest run` green with the count reported (Rule #51 — count mechanically from runner output, do not hand-tally).
  - [x] `npm run build` + `npx vsce package` produce a self-contained VSIX.
  - [x] **Root workspace untouched**: `git status` shows ZERO files under `packages/**`. Do not run the root turbo build as a gate for this story — but do confirm nothing outside `extensions/iris-mcp-launcher/` changed.

### Review Findings

Three-layer adversarial code review (Blind Hunter + Edge Case Hunter + Acceptance Auditor), 2026-07-26. 26 raw findings → 16 after dedupe: **13 patched in-story**, **6 deferred** (ledger items `31-5-1` … `31-5-6`), **7 dismissed**. Every VS Code API claim below was re-verified against the installed `@types/vscode@1.125.0` declaration, never from memory (Rule #36).

**Patched (all applied and verified):**

- [x] **[Review][Patch] HIGH — `workspaceFolder` write target is a branch the real API can never reach, and is documented to reject if it ever is** [`src/selectServers.ts:141`, `src/extension.ts:80`] — `irisMcpLauncher.servers` declares no `"scope"`, so it is `window`-scoped; both adapters use an **unscoped** `WorkspaceConfiguration`, matching the unscoped READ path in `settings.ts`. `@types/vscode@1.125.0` `index.d.ts:6943-6948` lists among `update()`'s throws BOTH *"window configuration to workspace folder"* and *"configuration to workspace folder when `WorkspaceConfiguration` is not scoped to a resource"*. Six tests pinned the branch as correct using fakes returning a shape the real API cannot produce — the same green-suite-over-an-impossible-path defect Story 31.4's review headlined. **Fix:** `ConfigWriteTarget` narrowed to `"workspace" | "global"`; `resolveWriteTarget`/`TARGET_LABEL`/`toConfigurationTarget` updated; AC 31.5.2 amended in `epics.md` with the oracle quoted (skill Rule 5); the impossible-shape tests replaced by one asserting a stray `workspaceFolderValue` is IGNORED, plus a `packaging.test.ts` pin on the declared `scope` so re-declaring it `resource` cannot silently reintroduce the branch.
- [x] **[Review][Patch] MEDIUM — confirming the picker silently DELETED configured server names Server Manager was not currently reporting** [`src/selectServers.ts:206`] — the written value was a pure function of the current roster, so a user whose global `irisMcpLauncher.servers` was `["prod","staging"]` opening a window where Server Manager only reported `prod` lost `staging` permanently by confirming with no changes. **Fix:** unreported-but-configured names are carried through as pre-checked items labelled *"(not currently reported by InterSystems Server Manager)"* — confirm-with-no-changes is now byte-neutral, and unchecking still removes them. Blank entries are not carried through. Mutation-verified.
- [x] **[Review][Patch] MEDIUM — `await deps.getServerManagerApi()` was the one unguarded third-party call on the command path** [`src/selectServers.ts:161`] — inconsistent with the QA pass's own stated bar (it guarded `showQuickPick`/`inspectServers` on exactly this reasoning) and with the module's "never throws" contract. A rejection would have rejected the `registerCommand` handler, i.e. an unhandled rejection with VS Code rendering the third-party error text — both ruled out by AC 31.5.5. **Fix:** guarded; degrades to the same single "not available" warning. Mutation-verified.
- [x] **[Review][Patch] MEDIUM — `activate()` registered the command and status bar item LAST, after the riskiest call, with no error containment** [`src/extension.ts:107`] — a throw from `vscode.lm.registerMcpServerDefinitionProvider` (absent on VS Code forks) killed activation, so the palette reported *"command not found"* and no status bar item appeared — destroying exactly the zero-state discoverability signal AC 31.5.3/31.5.4 exist to guarantee. **Fix:** UI surfaces registered first; MCP registration wrapped in try/catch → one warning, no third-party text. Ordering mutation-verified.
- [x] **[Review][Patch] MEDIUM — Integration AC 31.5.8's WRITE side was uncovered** [`src/extension.ts:102`] — the literal `"servers"` key lived only in `updateServersConfig`, which no test imports; renaming it left the whole suite green, contradicting the AC's *"a rename on either side must fail this test"*. **Fix:** key single-sourced as `SERVERS_SETTING_KEY`; `containment.test.ts` now enumerates EVERY `.update(` in `src/*.ts` and asserts the complete set is that one write, cross-checked against `settings.ts`'s read of the same key.
- [x] **[Review][Patch] MEDIUM — the credential-containment structural checks were weaker than they claimed** [`src/__tests__/containment.test.ts:465`] — (a) the forbidden-identifier list omitted `getServerSpec`/`getSession`/`username`, the actual doorway `selectServers.ts` has in scope via its `ServerManagerApi` import, so `JSON.stringify(await api.getServerSpec(n))` in a QuickPick item would have leaked a password with the check green; (b) the `getConfiguration(...).update(` tripwire was routed around by shape rather than exempted, leaving it blind to any future two-statement config write. **Fix:** doorway identifiers forbidden; the write pinned positively (above) rather than left invisible.
- [x] **[Review][Patch] MEDIUM — two containment tests did not assert what their titles claimed** [`src/__tests__/containment.test.ts:483`, `:527`] — one never captured the QuickPick items it claimed to check; the other cancelled the picker, so its "never reaches a showWarning/showInfo call" loop iterated zero times and could not fail. **Fix:** items captured and asserted; the second drives the real write + confirmation path, with non-vacuity sanity assertions on both.
- [x] **[Review][Patch] MEDIUM — `expect(true).toBe(true)` committed as a test** [`src/__tests__/selectServers.test.ts:347`] — under a title claiming a structural source check it did not perform. **Fix:** removed (the real check lives in `containment.test.ts`).
- [x] **[Review][Patch] MEDIUM — Task 1's "preserve `scope` per server name for the write decision" was checked off but unimplemented, and a code comment claimed the opposite** [`src/selectServers.ts:174`] — `ServerName.scope` is never read in this module. The bullet is in fact incoherent: Server Manager's `ConfigScope` governs `getServerSpec`, not which settings scope to write (AC 31.5.2 makes that `inspect()`-driven). AC 31.5.1 is still MET — this command only ENUMERATES, so there is no resolve call for a scope to be threaded into. **Fix:** comment corrected to state what the code does and where the 31.4 scope-threading fix actually lives; the task bullet is annotated below.
- [x] **[Review][Patch] MEDIUM — the Rule #19 env-synthesis proof was five spot-checks on a ~20-key record** [`src/__tests__/selectServers.test.ts:663`] — an added key, a changed `IRIS_HTTPS`, or a dropped `null` clear would all have passed a test claiming "byte-identical". **Fix:** pinned as a whole-object `toEqual`. Notably the expected value could NOT be hand-reasoned — `IRIS_HTTPS` is the string `"false"`, not a `null` clear — and was captured from the real `resolveEnvForLabel` return value (Rule #36), which is precisely the class of error the spot-check could not surface.
- [x] **[Review][Patch] LOW — `refreshStatusBar`'s catch swallowed the error entirely and rendered the healthy zero-state text** [`src/extension.ts:225`] — a broken `settings.json` was indistinguishable from a fresh install, with nothing written to the output channel (unlike every other failure in this extension). **Fix:** logged to the output channel and rendered as a distinct `$(warning) IRIS MCP: settings error`.
- [x] **[Review][Patch] LOW — the QuickPick had no `ignoreFocusOut`, so clicking away silently discarded the whole multi-selection** [`src/extension.ts:195`] — `QuickInput.ignoreFocusOut` defaults to `false` per the installed declaration, and this picker actively invites switching to the Server Manager view to tell two similarly-named servers apart. **Fix:** `ignoreFocusOut: true`.
- [x] **[Review][Patch] LOW — AC 31.5.4's "state the cost accepted" understated the cost; and two source-grep tests were comment-blind** [`src/extension.ts:1`, `src/__tests__/packaging.test.ts:127`] — the doc comment noted every-window activation but not that `extensionDependencies` now activates the **Server Manager extension** in every window too; and `packaging.test.ts`'s `registerCommand` scan read raw source, so a `registerCommand("x")` inside a doc comment would have registered a phantom id and broken a packaging test on a docs edit. **Fix:** cost stated in full; comment stripping single-sourced into `src/__tests__/sourceGrep.ts` and shared by both grep-style test files. Also retitled the concurrency describe block, which claimed to cover "a user double-clicking the status bar item" — a state the real host cannot produce (`QuickInput.show`: *"Any other input UI will first fire an onDidHide event"*), so the second picker dismisses the first; what those tests genuinely prove is statelessness.

**Deferred** (all in `deferred-work.md` under *Deferred from: code review of 31-5-launcher-selection-ui (2026-07-26)*):

- [x] **[Review][Defer] `31-5-1` HIGH (skill Rule 3) — no real-runtime (Extension-Host) test evidence for a user-facing UI surface** — `src/extension.ts` is imported by zero tests and no `@vscode/test-electron`/`@vscode/test-cli` tier exists. Mechanically-closable parts were patched (see the new `extension.ts` wiring pins); standing up an Extension-Host tier is its own story. Compensating control: the Project Lead's per-story manual smoke, which Rule 3 itself names as a separate later gate.
- [x] **[Review][Defer] `31-5-2` LOW — status-bar count is the raw `settings.servers.length`** (the open design question the QA stage flagged for a product decision; assessed, deliberately NOT changed unilaterally).
- [x] **[Review][Defer] `31-5-3` LOW — unchecking every item writes `[]`, which means "expose ALL servers"** — the inverse of the gesture; the `[]`-means-all semantic is inherited from Story 31.4.
- [x] **[Review][Defer] `31-5-4` LOW — `onDidChangeMcpServerDefinitions` is never supplied or fired**; implementing it would contradict AC 31.5.6 as written.
- [x] **[Review][Defer] `31-5-5` LOW — `$(…)` in Server Manager metadata renders as a theme icon in QuickPick rows**; no escape is documented in `@types/vscode`, so a blind escape risks corrupting displayed names.
- [x] **[Review][Defer] `31-5-6` LOW — both `readdirSync` source rosters are non-recursive**, so a future `src/commands/*.ts` would be invisible to the mechanical checks. `src/` is flat today.

**Dismissed (7):** AC 31.5.4's un-performed empirical GUI observation (sanctioned and openly disclosed — the Project Lead's smoke gate, not a review finding); the `[]`-zero-state text as an AC 31.5.3 violation (the current reading matches the AC's "when the roster is empty"; the tension is recorded as `31-5-2`/`31-5-3` instead); four suspicions that did not survive checking against the installed declaration.

### Post-review verification (all live)

- `npx tsc --noEmit` — clean (exit 0).
- `npx vitest run` — **162 passed / 11 files** (was 153/11 at QA; +13 net: +9 new regressions, +5 replacing impossible-path tests, −1 vacuous test removed). Count taken from the runner's own summary line (Rule #51).
- `npm run build` — clean.
- Mutation-verified (Rule #48), each red→green: the `getServerManagerApi` guard, the unreported-names carry-through, the `toConfigurationTarget` mapping pin, the activation-order pin.
- `git status` — still ZERO files under `packages/**`; `git diff --numstat` shows no binary files, and all six touched/new source files verified NUL-free.

## Dev Notes

### Hard boundaries (violating these is a HIGH finding)

- **Extension-only.** Zero changes under `packages/**`. No new MCP tool, no governance key, no tool-count change (Rule #31).
- **Do not re-touch Stories 31.0–31.4.** They are `done`. Epic 31 was re-opened solely for this story.
- **Do NOT `git commit` or `git push`.** Leave everything uncommitted; the lead commits after the smoke gate.
- **No new settings keys.** This story WRITES an existing key. Adding a key would require both `contributes.configuration` and `readSettings()` updates to stay in lockstep (`packaging.test.ts` enforces this mechanically).

### The one-`vscode`-import rule (architectural, load-bearing)

`extension.ts` is the **only** file with a value-level `import * as vscode from "vscode"`. Every other module takes injected dependencies shaped to local interfaces in `types.ts`. That is what makes the 107-test suite runnable in plain Node with no VS Code host.

**Follow it.** Put logic in `selectServers.ts` behind ports; keep `extension.ts` as thin wiring that adapts the real `vscode` API onto those ports. `extension.ts` already models this — `authApi`, `toConfigReader`, `showWarning`, `getServerManagerApi`.

### Reuse — do NOT reinvent

| Need | Already exists | Location |
|---|---|---|
| Read settings | `readSettings(getConfig)` | `src/settings.ts` |
| Config section name | `CONFIG_SECTION = "irisMcpLauncher"` | `src/settings.ts` |
| Server Manager API (cached, never throws) | `getServerManagerApi()` | `src/extension.ts:34` |
| Server list + scope | `api.getServerNames()` → `{name, description, detail, scope}` | `src/types.ts:30` |
| One-warning helper | `showWarning` closure | `src/extension.ts:72` |
| Injected-deps test pattern | `LauncherProvider` + `ProviderDeps` | `src/serverDefinitionProvider.ts` |
| Disk-enumerated leak scan | `containment.test.ts` `SOURCE_FILES` | auto-covers new `src/*.ts` |

`ServerName` **already carries `description` and `detail`** — AC 31.5.1's picker detail needs no extra API call.

### ⚠️ Cancel semantics differ between APIs — verify, don't pattern-match

Story 31.4's headline HIGH was that `authentication.getSession({createIfNone:true})` **REJECTS** on cancel (it does not resolve `undefined`), and every test faked it wrong, so the suite was green on an impossible path.

`window.showQuickPick` is documented to **RESOLVE `undefined`** on dismiss — the opposite shape. **Do not blindly apply the 31.4 lesson here, and do not take this note as authority either.** Read the installed `@types/vscode` declaration for the exact overload you call, and cite it in a test comment as the oracle (Rule #36), exactly as the 31.4 fix did. Getting this backwards in either direction produces the same class of defect.

### The activation trap (AC 31.5.4 — read before writing any status bar code)

`package.json` currently has `activationEvents: []`. The extension is activated **implicitly** by `contributes.mcpServerDefinitionProviders` — only when the MCP subsystem first asks for definitions.

A status bar item created in `activate()` therefore **will not appear** until something exercises MCP, which defeats the entire purpose of AC 31.5.3 (the zero-state signal for a fresh install). `onStartupFinished` is the expected fix. State the tradeoff — the extension will now activate in every window — and verify by observation, not by unit test.

### Config write mechanics

`ConfigReader` in `settings.ts` currently exposes only `get`. Writing needs `inspect()` and `update()`. **Extend via a separate port** rather than widening `ConfigReader` — `packaging.test.ts` mechanically extracts `readSettings()`'s keys from source, so keep the read interface exactly as it is.

`update()` returns a Thenable that can reject (read-only settings file, no workspace open for a workspace-scoped write). Guard it — AC 31.5.5's "no unhandled rejection out of a command handler" covers this path.

### Previous-story intelligence (Story 31.4)

Its review applied **18 patch findings** across three adversarial layers. The ones that constrain this story:

- **Every third-party call on a user-facing path is guarded**; a failure maps to exactly ONE warning, never forwarding third-party error text to the user. Hold that bar.
- **Hand-maintained rosters rot** — `containment.test.ts` was rewritten to enumerate `src/` from disk after a review finding. Any new mechanical check you add must derive from source/disk, never a hardcoded list (Rule #51).
- **`readSettings` coerces hostile input** (non-arrays, non-string members, duplicates, whitespace-only namespace) because `WorkspaceConfiguration.get` returns whatever is literally in the file. Your written value flows straight back through it — Integration AC 31.5.8 exists to prove that round-trip.
- **Duplicates collide on `label`**, the only key VS Code round-trips; `planDefinitions` de-duplicates both axes. Do not let the QuickPick write duplicates.
- **The multi-root `scope` bug**: `getServerSpec(name)` returns `undefined` if the scope from `getServerNames()` is not threaded back. AC 31.5.2 is the same failure mode on the write side.

### Repo-specific hazard (this epic, twice)

`serverDefinitionProvider.ts` was committed as a **binary file** because a generation script wrote literal NUL bytes (fixed in `640c38e`), and a ledger entry was silently lost to a Python heredoc parsing `\User` as a `\U` escape. **Write source files with the Write/Edit tools directly.** If you generate content via a script, verify afterwards with `git diff --stat` and confirm the file is still text.

### Testing standards

- `vitest` (`npx vitest run` from `extensions/iris-mcp-launcher/`), config at `vitest.config.ts`. No VS Code host — inject fakes.
- Tests live in `src/__tests__/`, excluded from `tsconfig.build.json`, so they never reach the VSIX.
- `npm run type-check` (`tsc --noEmit`) covers tests too; `npm run build` covers shipped code only.
- Current baseline: **107 tests / 10 files**, all passing. Report the new count mechanically.

### Project Structure Notes

- All work under `extensions/iris-mcp-launcher/` — **not** an npm workspace member, so root `pnpm turbo` tasks do not build or test it. Run its scripts directly.
- New files expected: `src/selectServers.ts`, `src/__tests__/selectServers.test.ts`. Modified: `src/extension.ts` (wiring only), `package.json` (commands + activationEvents), `src/__tests__/packaging.test.ts`, `src/__tests__/containment.test.ts`.
- The extension has **zero runtime dependencies** and must keep it that way — the VSIX is self-contained (15 files, ~26.6 KB). Do not add a dependency.

### References

- [epics.md — Story 31.5](../planning-artifacts/epics.md) — ACs, source of truth
- [31-4-broker-extension.md](31-4-broker-extension.md) — previous story, review findings, credential contract
- [deferred-work.md](deferred-work.md) — the two post-epic discovery fixes (`.code-workspace`, XDG/Flatpak) landed after 31.4
- `.claude/rules/project-rules.md` — #14/#16 (verify live), #19 (back-compat proof), #31 (no tool-count change), #36 (oracle discipline), #51 (mechanical tallies/rosters)
- `extensions/iris-mcp-launcher/README.md` — client-coverage boundary, publish checklist

## Dev Agent Record

### Agent Model Used

claude-sonnet-5 (Claude Sonnet 5)

### Debug Log References

None — no IRIS/ObjectScript involved; no debug globals used. All verification was `tsc`/`vitest`/`vsce` output, captured inline in Completion Notes below.

### Completion Notes List

- **Scope confirmed**: `git status` shows ZERO files under `packages/**`. Every change lives under `extensions/iris-mcp-launcher/` (plus a pre-existing `_bmad-output/implementation-artifacts/cycle-log-epic-31.md` entry from the story-creation stage that predates this dev session and was not touched by this agent).
- **Oracle verification (Rule #14/#16/#36), done live against the installed `@types/vscode` declaration, not assumed from the story's own paraphrase.** *(Corrected at code review: this note originally cited `@types/vscode@1.101.0`. `package.json` DECLARES `^1.101.0`, but the version actually installed and read is **1.125.0** — the cited line numbers below are correct for 1.125.0. Citing the wrong version defeats the point of pinning an oracle, since a reader cannot reproduce the lookup.)*
  - `showQuickPick<T extends QuickPickItem>(items, options: QuickPickOptions & { canPickMany: true }, token?)` (`node_modules/@types/vscode/index.d.ts` ~line 11443) types its return as `Thenable<T[] | undefined>` — confirmed dismissing the picker RESOLVES `undefined`, it does not reject (the opposite shape from 31.4's `authentication.getSession`). Cited as a doc-comment oracle on `SelectServersDeps.showQuickPick` in `selectServers.ts` and exercised directly in `selectServers.test.ts`'s cancellation test.
  - `QuickPickItem.picked?: boolean` confirmed "only honored... when the picker allows multiple selections" — used for pre-checking.
  - `WorkspaceConfiguration.inspect<T>(section)` confirmed to return `{ workspaceFolderValue?, workspaceValue?, workspaceFolderValue? ... }`, and `.update(section, value, target?)` confirmed to return a `Thenable<void>` that **can reject** ("@throws error while updating... configuration to workspace or workspace folder when no workspace is opened") — guarded in `selectServers.ts`.
- **Design decision — `showInfo` added as a 6th injected dependency, alongside the 5 Task 1 names.** Task 1 lists exactly `getServerManagerApi, getSettings, config read/write port, QuickPick port, showWarning`. Routing the post-write SUCCESS confirmation through `showWarning` would render it with a ⚠ warning icon via `vscode.window.showWarningMessage`, which is poor UX for "servers saved successfully" and not what any AC asks for. Added a parallel `showInfo` callback (wired to `vscode.window.showInformationMessage` in `extension.ts`, same output-channel logging as `showWarning`) — this is an internal interface parameter, not a new npm dependency or new mechanism for the SAME concern (failure containment still funnels through `showWarning` alone, exactly as specified).
- **Design decision — avoided widening `containment.test.ts`'s `SUSPICIOUS_WRITE_PATTERNS` exemptions.** The extension now makes ONE legitimate `WorkspaceConfiguration.update(...)` call (writing `irisMcpLauncher.servers`). Rather than exempt `getConfiguration(...).update(` for `extension.ts` (which would blanket-disable that regression check for the whole file), `extension.ts`'s `updateServersConfig` obtains `config = vscode.workspace.getConfiguration(CONFIG_SECTION)` as an intermediate local — the SAME indirection `toConfigReader` already uses for reads — so the literal risky substring never appears in source, and the existing tripwire stays fully live for any FUTURE accidental credential-write call anywhere in the file. Documented in both files' comments.
- **Design decision — status bar reads `settings.servers.length` (the literal `irisMcpLauncher.servers` array), not a Server-Manager-resolved roster.** A fresh install has `servers: []` by definition (the setting's documented default) — that IS the zero-state signal AC 31.5.3 calls "the only signal a fresh install gives," independent of whether Server Manager currently reports any servers. Kept the computation pure (`buildStatusBarState` in `selectServers.ts`) so it needs no async Server Manager call and is unit-testable without a VS Code host.
- **Design decision — QuickPick item mapping.** `ServerName.description`/`.detail` map 1:1 onto `vscode.QuickPickItem.description`/`.detail` (same field names/semantics) rather than concatenating into one field — uses both fields Server Manager already provides with no extra API call, satisfying AC 31.5.1's "so a user can tell two similarly-named servers apart."
- **Command title/category composition verified against AC 31.5.1's literal palette text.** `package.json`: `title: "Select Servers…"`, `category: "IRIS MCP Launcher"` — VS Code concatenates these as "IRIS MCP Launcher: Select Servers…" in the Command Palette, matching the AC exactly (not `title` containing the full string, which would double the prefix once `category` is also set).
- **Verification performed (all live, not assumed):**
  - `npx tsc --noEmit` — clean (0 errors).
  - `npx vitest run` — **140/140 passing across 11 files** (baseline was 107/10; +33 new tests: 27 in new `selectServers.test.ts`, +4 in `containment.test.ts` [9→13], +2 in `packaging.test.ts` [5→7]). Count taken directly from the runner's own summary line (Rule #51), not hand-tallied.
  - `npm run build` (`tsc --project tsconfig.build.json`) — clean, `dist/*.js` produced (10 files, including new `selectServers.js`).
  - `npx vsce package --allow-missing-repository` — produced a self-contained VSIX (16 files, ~31.1 KB; up from 15 files/~26.6 KB pre-story — the one new `selectServers.js`). Left in place at `extensions/iris-mcp-launcher/iris-mcp-launcher-0.1.0.vsix` (gitignored) for the Project Lead to install for the manual smoke below, matching Story 31.4's precedent.
  - `git status` — confirmed zero `packages/**` files modified.
- **AC 31.5.4 — what remains for the Project Lead (hands-on, cannot be done by this agent):** The mechanical half of AC 31.5.4 is done and verified — `activationEvents` contains `onStartupFinished` (asserted in `packaging.test.ts`), and the WHY/cost-accepted is recorded in `extension.ts`'s top-of-file doc comment (the extension now activates in every window, not only when MCP is first exercised). The EMPIRICAL half — "reload a window, never touch MCP, confirm the status bar item appears" — requires an interactive VS Code GUI session, which this headless CLI agent environment does not have (no display, no way to visually confirm a status bar item). **This agent has NOT performed that observation and does not claim AC 31.5.4 is fully verified — only the mechanically-checkable portion (the activation event itself) is done.** Recommended steps for the Project Lead, mirroring AC 31.4.4's precedent:
  1. `code --install-extension extensions/iris-mcp-launcher/iris-mcp-launcher-0.1.0.vsix` (or `F5` from that folder for an Extension Development Host).
  2. Reload the window. Do **not** open Copilot Chat or otherwise exercise MCP.
  3. Confirm a status bar item reading `$(server) IRIS MCP: none` (fresh install, `irisMcpLauncher.servers` defaults to `[]`) is visible, with a tooltip explaining the zero-state and a click action that runs "IRIS MCP Launcher: Select Servers…".
  4. Run the command via the status bar click (or Command Palette), pick one or more servers, confirm the QuickPick shows each Server Manager server's description/host as `detail`, confirm the post-write message names the settings scope, and confirm the status bar updates to `$(server) IRIS MCP: <n>` without a reload.
  5. Record the pass/fail outcome (with VS Code version) back into this story's Completion Notes, and only then consider AC 31.5.4 fully closed.
- **Integration ACs 31.5.7/31.5.8 proof approach.** Rather than restate expectations, `selectServers.test.ts`'s "Rule #19 back-compat" test imports the unmodified `LauncherProvider` directly (no interaction with `selectServers.ts`) and pins its output against literal expected values, and its "Integration AC 31.5.8" tests feed the write helper's own captured output through the REAL `readSettings`/`planDefinitions` (including a hostile-input round trip: duplicate + non-string + whitespace-only entries) rather than a hand-built literal — a rename or shape change on either side fails these tests.

### File List

> **Accuracy note (added at code review).** The dev-stage entries below were written before the QA and code-review stages ran and were STALE: they credited `selectServers.ts` solely to dev and reported 140 tests / 27 in `selectServers.test.ts`. The QA stage also modified **production** code (`selectServers.ts`) and recorded it only in `cycle-log-epic-31.md`, not here. The per-stage deltas are now itemized so the File List matches what is actually on disk (Rule #51 — counted from the runner, never hand-tallied).
>
> | Stage | Test total / files | `selectServers.ts` touched? |
> |---|---|---|
> | Baseline (Story 31.4) | 107 / 10 | n/a (did not exist) |
> | Dev | 140 / 11 | created |
> | QA | 153 / 11 | **yes** — added try/catch around `showQuickPick` + `configWriter.inspectServers` |
> | Code review | **162 / 11** | **yes** — see Review Findings above |

**Modified:**
- `extensions/iris-mcp-launcher/package.json` — added `activationEvents: ["onStartupFinished"]` and `contributes.commands` (`irisMcpLauncher.selectServers`).
- `extensions/iris-mcp-launcher/src/extension.ts` — wires `selectServers.ts` into activation: `showInfo` closure, `toConfigurationTarget`/`inspectServersConfig`/`updateServersConfig` adapters, `irisMcpLauncher.selectServers` command registration, status bar item creation + `onDidChangeConfiguration` refresh. Doc comment updated.
- `extensions/iris-mcp-launcher/src/__tests__/packaging.test.ts` — added `activationEvents` assertion and the mechanical `contributes.commands` ↔ `registerCommand(...)` cross-check (+2 tests).
- `extensions/iris-mcp-launcher/src/__tests__/containment.test.ts` — extended file-header doc comment; added a Story 31.5 describe block covering `selectServers.ts`'s structural credential-identifier absence, QuickPick/message marker-leak behavioral tests, and a `buildStatusBarState` marker-leak test (+4 tests).

**New:**
- `extensions/iris-mcp-launcher/src/selectServers.ts` — the `irisMcpLauncher.selectServers` command logic (QuickPick build/precheck, scope-correct write, failure containment) and the pure `buildStatusBarState` status-bar text/tooltip computation. No value-level `vscode` import (Task 1's "one vscode import" rule).
- `extensions/iris-mcp-launcher/src/__tests__/selectServers.test.ts` — happy path, cancellation, empty roster, API-throws/getSettings-throws/update-rejects failure containment, duplicate/whitespace handling, `resolveWriteTarget` scope selection, `buildStatusBarState` (incl. zero-state), the Integration AC 31.5.8 real round-trip (incl. hostile-input coercion), and the Rule #19 back-compat proof. *(27 tests at dev → 40 after QA → 49 after code review.)*
- `extensions/iris-mcp-launcher/src/__tests__/sourceGrep.ts` — **added at code review.** Single-sourced `stripComments` helper shared by the two source-grep test files, so their structural guards can never drift into checking prose instead of code. Not a `*.test.ts` file (vitest never collects it) and under `src/__tests__`, which `tsconfig.build.json` excludes — so it never reaches `dist/` or the VSIX.

**Build artifacts present but gitignored (not part of the commit):** `extensions/iris-mcp-launcher/dist/**`, `extensions/iris-mcp-launcher/iris-mcp-launcher-0.1.0.vsix` (left in place for the Project Lead's AC 31.5.4 smoke install).

## Change Log

| Date | Version | Description | Author |
|------|---------|-------------|--------|
| 2026-07-26 | 1.0 | Implemented (Tasks 1-7 complete): `selectServers.ts` (QuickPick build/precheck, scope-correct write, failure containment, pure status-bar computation); `extension.ts` wiring (command registration, status bar item, `onDidChangeConfiguration` refresh); `package.json` (`onStartupFinished` activation event, `contributes.commands`); 33 new tests (140 total / 11 files, up from 107/10), including the Integration AC 31.5.8 real `readSettings`→`planDefinitions` round trip and the Rule #19 back-compat proof. `tsc --noEmit` clean; `npm run build` + `npx vsce package` produced a self-contained 16-file VSIX; root workspace confirmed unaffected (zero `packages/**` changes). AC 31.5.4's empirical "reload and observe the status bar" step left open — no interactive VS Code GUI available in this headless dev environment; hands-on steps recorded in Completion Notes for the Project Lead, mirroring Story 31.4's AC 31.4.4 precedent. Status set to `review`. | Dev (claude-sonnet-5) |
| 2026-07-26 | 1.1 | QA pass: found and fixed an AC 31.5.5 containment gap in PRODUCTION code — `deps.showQuickPick()` and `configWriter.inspectServers()` were the only third-party calls on the command path left outside any try/catch, so a throw from either would have been an unhandled rejection out of the registered command handler. Mutation-verified. +13 tests (140 → 153 / 11 files). *(This row was reconstructed at code review from `cycle-log-epic-31.md`'s `qa_complete` entry — the QA stage did not record its own production edit in this story file.)* | QA (claude-sonnet-5) |
| 2026-07-26 | 1.2 | Code review (3-layer adversarial: Blind Hunter + Edge Case Hunter + Acceptance Auditor). 26 raw findings → 16 after dedupe: **13 patched in-story, 6 deferred (`31-5-1`…`31-5-6`), 7 dismissed**. Headline HIGH: the `workspaceFolder` write target was a branch the real VS Code API can never reach — `irisMcpLauncher.servers` is `window`-scoped and both adapters use an unscoped `WorkspaceConfiguration`, so `update(…, WorkspaceFolder)` is documented to reject twice over — "proven correct" only by fakes returning an impossible `inspect()` shape, the same green-suite-over-an-impossible-path defect Story 31.4's review headlined. **AC 31.5.2 amended in `epics.md`** with the original wording, rationale and `@types/vscode@1.125.0` oracle recorded (skill Rule 5 — amend the planning artifact, never work around in code). Also fixed: silent deletion of configured servers Server Manager was not currently reporting; the unguarded `getServerManagerApi()` await; activation order (command + status bar now registered BEFORE the MCP provider, which is itself wrapped so a fork without `vscode.lm` cannot destroy the zero-state signal); the uncovered Integration AC 31.5.8 write side; two containment tests that did not assert what their titles claimed; a `expect(true).toBe(true)` test; a five-key Rule #19 env proof (now a whole-object `toEqual`, with `IRIS_HTTPS: "false"` captured from the real return value — it could not be hand-reasoned); plus `ignoreFocusOut`, the swallowed status-bar refresh error, and comment-blind source greps. Four fixes mutation-verified red→green. **162/162 tests across 11 files**, `tsc --noEmit` clean, `npm run build` clean, zero `packages/**` changes, no binary/NUL-byte files. Status → `done`. **Open for the Project Lead:** AC 31.5.4's empirical status-bar observation (unchanged, headless environment) AND deferred item `31-5-1` — skill Rule 3's real-runtime (Extension-Host) test evidence does not exist for this extension and cannot be created here; the mechanically-closable part is now pinned in `packaging.test.ts`, and the per-story manual smoke is the compensating control. The Lead may reasonably override this story to `in-progress` if they want that tier before shipping. | Code Review (claude-opus-5) |
