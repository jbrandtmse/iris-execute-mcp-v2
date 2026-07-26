# Story 31.5: Launcher Server-Selection UI (`iris-mcp-launcher`)

Status: ready-for-dev

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
2. **AC 31.5.2** — The write targets the configuration scope the setting is ALREADY defined in (`inspect()`-driven: workspace-folder → workspace → global), falling back to Global when it is defined nowhere. A multi-root workspace must not silently write a folder-scoped value into user settings or vice versa. The chosen scope is named in the post-write confirmation so the user knows which file changed.
3. **AC 31.5.3** — A status bar item reports live state — `$(server) IRIS MCP: <n>` when servers are selected, and a discoverable zero-state (e.g. `$(server) IRIS MCP: none`) when the roster is empty — with a tooltip naming the selected servers and packages, and a click action running `irisMcpLauncher.selectServers`. It updates on `onDidChangeConfiguration` without requiring a reload. The zero-state is the load-bearing case: it is the only signal a fresh install gives that the extension is installed and waiting for input.
4. **AC 31.5.4** — **Activation strategy is decided and justified in Dev Notes.** The 31.4 MVP ships `activationEvents: []` and is activated implicitly by `contributes.mcpServerDefinitionProviders`, i.e. only when VS Code's MCP subsystem first asks for definitions — under which a status bar item would not appear at startup, defeating AC 31.5.3. Adopt an explicit activation event (`onStartupFinished` is the expected answer) and state the cost accepted (the extension activates for every window). Verify empirically that the status bar item is present after a plain window reload with MCP never exercised.
5. **AC 31.5.5** — Failure containment matches the bar set by the 31.4 review: a Server Manager API that throws, is missing, or returns nothing degrades to **exactly one** actionable warning (never a toast storm, never an unhandled rejection out of a command handler), the command still opens with an empty-state message rather than failing silently, and no third-party error text is forwarded to a user surface. **No credential, token, or password may appear in any QuickPick item, tooltip, status bar text, log line, or warning** — extend the existing `containment.test.ts` source-grep (already disk-enumerated, not hand-rostered) to cover the new files.
6. **AC 31.5.6** — Writing the setting does not retroactively change already-registered MCP definitions; the confirmation therefore states plainly that a reload (or MCP server restart) is required for changes to take effect, matching how 31.4 provides definitions at registration time. Do NOT silently trigger a reload.
7. **AC 31.5.7** — **Back-compat (Rule #19).** With the new command never invoked, behavior is byte-identical to Story 31.4: same definitions, same env synthesis, same credential path. Proven mechanically — an assertion that fails on drift, not a prose claim — and the existing 107-test suite must stay green with no expected-value edits beyond genuinely new surface.
8. **Integration AC 31.5.8** — The value this story WRITES must be exactly what the 31.4 provider READS. Drive the real `readSettings` → `planDefinitions` path against a configuration written by the command's own write helper (not a hand-built literal), asserting the resulting plan matches the selection — including the coercion edge cases `readSettings` already guards (duplicates, non-string members, whitespace). A rename or shape change on either side must fail this test.

## Tasks / Subtasks

- [ ] **Task 1 — New `selectServers.ts` module: pure, injectable logic (AC: 31.5.1, 31.5.2, 31.5.5)**
  - [ ] Create `src/selectServers.ts`. **Do NOT put logic in `extension.ts`** — see the "one vscode import" rule in Dev Notes. Take injected deps (`getServerManagerApi`, `getSettings`, a config read/write port, a QuickPick port, `showWarning`) exactly like `LauncherProvider` does.
  - [ ] Build QuickPick items from `getServerNames()`: `label` = server name, `detail` = the `description`/`detail` fields that `ServerName` **already carries** (see `types.ts`) — do not re-fetch specs to build the list.
  - [ ] Pre-check items whose name is in the current `readSettings().servers`.
  - [ ] Preserve `scope` per server name for the write decision (the provider already does this — mirror it, do not invent a second mechanism).
  - [ ] Empty roster ⇒ actionable empty-state message, not a silent no-op or an empty picker.
- [ ] **Task 2 — Scope-correct write (AC: 31.5.2, 31.5.6)**
  - [ ] Use `inspect()` on `irisMcpLauncher.servers` to choose the target: workspaceFolderValue → workspaceValue → globalValue → default to Global.
  - [ ] Write via `WorkspaceConfiguration.update(section, value, target)`.
  - [ ] Post-write message names BOTH the scope written and that a reload/MCP restart is required (AC 31.5.6). **Never call `workbench.action.reloadWindow` yourself.**
- [ ] **Task 3 — Status bar item (AC: 31.5.3)**
  - [ ] Create on activate, push to `context.subscriptions`, `command` = `irisMcpLauncher.selectServers`.
  - [ ] Text: count when >0, explicit zero-state when 0. Tooltip lists selected servers + packages.
  - [ ] Subscribe to `onDidChangeConfiguration` filtered to the `irisMcpLauncher` section; refresh without reload.
- [ ] **Task 4 — Activation strategy (AC: 31.5.4)**
  - [ ] Add the explicit activation event to `package.json` (expected: `onStartupFinished`).
  - [ ] Record in Dev Notes WHY, and the cost accepted.
  - [ ] **Empirically verify**: reload a window, never touch MCP, confirm the status bar item appears. Record the observation — this AC is not satisfiable by unit test alone.
- [ ] **Task 5 — package.json contributions (AC: 31.5.1)**
  - [ ] Add `contributes.commands` with the id and the `IRIS MCP Launcher: Select Servers…` title (use a `category` so the palette groups it).
  - [ ] Extend `packaging.test.ts` with a mechanical check that every declared `contributes.commands` id is actually registered in source, and vice versa — same Rule #51 spirit as the existing settings-key ↔ `readSettings()` test.
- [ ] **Task 6 — Tests (AC: all, especially 31.5.7, 31.5.8)**
  - [ ] Unit-test `selectServers.ts` with fakes: happy path, **cancel leaves config untouched** (assert the update port was never called), empty roster, API throws, duplicate/whitespace names.
  - [ ] Scope-selection tests across all four `inspect()` shapes.
  - [ ] Status bar text/tooltip tests including the zero-state.
  - [ ] **Integration AC 31.5.8**: feed the write helper's output through the REAL `readSettings` → `planDefinitions`; assert the plan matches. Not a hand-built literal.
  - [ ] **Rule #19 proof**: command never invoked ⇒ `providePlannedDefinitions()`/env synthesis byte-identical to pre-story. Make it fail on drift.
  - [ ] Extend `containment.test.ts` patterns to cover QuickPick items, tooltips, and status bar text as credential-leak surfaces.
- [ ] **Task 7 — Verification (AC: all)**
  - [ ] `npx tsc --noEmit` clean; `npx vitest run` green with the count reported (Rule #51 — count mechanically from runner output, do not hand-tally).
  - [ ] `npm run build` + `npx vsce package` produce a self-contained VSIX.
  - [ ] **Root workspace untouched**: `git status` shows ZERO files under `packages/**`. Do not run the root turbo build as a gate for this story — but do confirm nothing outside `extensions/iris-mcp-launcher/` changed.

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

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
