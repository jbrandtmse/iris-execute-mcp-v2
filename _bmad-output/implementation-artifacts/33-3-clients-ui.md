# Story 33.3: Extension "MCP Clients" UI

Status: done

## Story

As an iris-mcp user in VS Code,
I want an "MCP Clients" view in the iris-mcp-launcher extension where I pick my clients, toggle individual iris-mcp servers per client, and apply with a diff preview,
so that I never hand-edit any client's MCP config JSON.

## Acceptance Criteria

1. **AC 33.3.1** — "MCP Clients" view in `iris-mcp-launcher`: detected clients with **user-selectable checkboxes** (roster persisted in extension state); undetected v1 clients listed collapsed with a "not detected" note; Pi shown in a "not MCP-capable" info row with rationale (user-requested client, documented disposition).
2. **AC 33.3.2** — Per selected client: the iris-mcp server matrix (5 servers + `@iris-mcp/all`) with enable/disable toggles driving the 33.1 engine; scope and env-mode pickers respecting adapter capabilities; third-party entries listed read-only.
3. **AC 33.3.3** — Every write flows through diff preview → explicit confirm → engine (same single code path as the CLI); post-write the client's restart hint is surfaced; backup/restore reachable from the UI.
4. **AC 33.3.4** — Manual smoke recorded in story notes: from the UI, enable `iris-dev-mcp` for two different real clients (e.g. Claude Code + one other installed), verify both agents list the tools after restart; disable for one, verify absence there and continued presence in the other (the F3 success metric).

## Integration ACs

**AC 33.3-I1** — The UI drives the REAL 33.2 CLI surface (spawn-level integration): every view action (`detect`/`status`/`diff`/`apply --yes`/`enable`/`disable`/`remove`/`restore`/`doctor`) goes through the `iris-mcp-clients` bin with `--json` — the same single code path as the terminal CLI (AC 33.3.3) — with the spawned env scrubbed of every `IRIS_*` variable (the governanceEngine containment discipline). Engine tests spawn the REAL built bin against sandbox HOMEs and assert observable file effects (enable → config contains the entry; disable → absent/stashed), per Rule 3's real-runtime bar within a headless environment (the 31-5-1 recorded constraint: no Extension-Host tier exists; the compensating controls are view-model unit tests + spawn-level engine tests + the AC 33.3.4 manual smoke).

## Tasks / Subtasks

- [x] Task 1: Engine layer (AC: I1)
  - [x] `src/clientsEngine.ts` — mirrors `governanceEngine.ts`: resolution order for the `iris-mcp-clients` bin (dev-repo `packages/client-config/dist/cli/clients-cli.js` when `irisMcpLauncher.developmentRepoPath` set → `npx -y -p @iris-mcp/client-config iris-mcp-clients` otherwise), `IRIS_*`-scrubbed spawn env, `parseCliJson` envelope handling, typed per-command wrappers returning the CLI's `--json` data
  - [x] Spawn-level tests with the real bin + sandbox HOME (fixture configs planted; assert file effects, exit-code mapping, malformed-JSON refusal surfacing)
- [x] Task 2: View-model (AC: 1, 2, 3)
  - [x] `src/clientsView.ts` — pure, NO `vscode` import (the "one vscode import" rule): state types + reducers for client roster (checkbox selection), per-client server matrix rows, scope/mode pickers, diff-preview staging, restart-hint display, backup list/restore; undetected clients collapsed; Pi info row (from `CLIENT_DISPOSITIONS` via `detect` output); third-party entries rendered read-only names-only
  - [x] Roster persisted via extension `globalState` (key e.g. `irisMcpLauncher.clientRoster`) — default: all detected clients selected
  - [x] Mode picker per adapter capability: `env-reference` always; `server-manager`/`governance-file` offered per the CLI's mode gating (probe via `iris-mcp-clients doctor`/`apply --help` surfaces — verify what the CLI exposes, Rule #47, don't invent a parallel probe); `explicit` offered with the typed-confirmation flow (the view collects the confirmation string; secret values never rendered — the CLI already redacts)
  - [x] Unit tests: reducers over CLI-output fakes whose shapes are captured from the REAL bin (Rule #36) — every fake shape must be one the real CLI emits (Rule #54)
- [x] Task 3: Panel orchestration + wiring (AC: 1, 2, 3)
  - [x] `src/clientsPanel.ts` — mirrors `governancePanel.ts`: message handling (toggle server → diff preview → confirm → engine write → refresh + restart hint; apply with scope/mode; restore backup), deps interface for the real WebviewPanel + globalState
  - [x] `extension.ts` registration: command `irisMcpLauncher.manageClients` ("Manage MCP Clients…", category "IRIS MCP Launcher") + `contributes.commands` entry; open the panel
  - [x] Tests for the orchestration with faked deps (activationFlow precedent)
- [x] Task 4: Manual smoke procedure (AC: 3.3.4 — Project Lead execution, LEFT OPEN)
  - [x] Record the executable procedure in Completion Notes (the 31.4.4/31.5.4/32.2.4 sanctioned pattern): build VSIX → install → open "Manage MCP Clients…" → select Claude Code + one other detected client → apply iris-dev-mcp (env-reference) to both via the UI → restart both clients → verify both agents list iris-dev-mcp tools → disable for one via the UI → verify absence there and continued presence in the other → record versions + outcomes back into the story
- [x] Task 5: Gates
  - [x] `npx tsc --noEmit` clean in extensions/iris-mcp-launcher; `npx vitest run` green; `pnpm turbo run build test lint type-check` 29/29; `gen:governance-baseline:check` (`:check` ONLY) exit 0; NUL scan; CHANGELOG entry (Rule #43)

## Dev Notes

### Verified surfaces to build on (lead-verified 2026-07-28, Rule #47)

- Extension layering precedent (Story 32.2): `extensions/iris-mcp-launcher/src/governanceEngine.ts` (bin resolution order + env scrub + spawn), `governanceView.ts` (pure view-model), `governancePanel.ts` (orchestration + deps), `extension.ts` (command registration; the "one vscode import" rule documented in its header). Mirror this exactly — same file-name pattern with `clients*` modules.
- CLI contract (Story 33.2): `iris-mcp-clients` bin at `packages/client-config/dist/cli/clients-cli.js`; every command takes `--json` returning `{ok, command, data, error?}`; exit codes 0/1/2; write commands print restart hints (also in `data`); `detect` output carries `CLIENT_DISPOSITIONS` (Pi/roadmap rows); mode gating is host-probed IN THE CLI (modes hidden when unavailable) — the UI asks the CLI, never re-probes.
- Extension settings/state: `irisMcpLauncher.developmentRepoPath` (machine-scoped dev-repo path, Story 31.6) is the dev-mode bin resolution input; `globalState` is the roster persistence home (settings are for user config; the roster is UI state).
- Credential containment (AC 31.4.3's bar, extended in 32.2): this view never sees a credential. Env-reference entries hold `${VAR}` references; explicit-mode secrets pass through the CLI's redaction gate; the panel must not add its own secret rendering.

### Constraints

- **No new MCP tools / governance keys** (Rules #28/#31/#53 untriggered); frozen baseline untouched; **zero `packages/**` changes** in this story **except the single sanctioned additive below**; any OTHER engine change is a Clarification Needed halt, not a silent edit.
- **SANCTIONED packages/** exception (lead decision 2026-07-28, dev-halt resolution): the Dev Notes' claim "`detect` output carries `CLIENT_DISPOSITIONS`" was wrong for `--json` (true only of the text render — lead spec error, flagged for the retro). The story MAY add `dispositions` (id, displayName, disposition, reason — the same data as the text render's "Other clients:" section) to the `detect --json` envelope in `packages/client-config/src/cli/clients.ts` — additive key, back-compat preserved, with a regression test + the envelope doc updated. No other `packages/**` edits.
- **Headless constraint (recorded precedent 31-5-1)**: no Extension-Host/GUI test tier exists; do not claim GUI-observable behavior headlessly. AC 33.3.4 stays OPEN for the Project Lead with the executable procedure (Task 4).
- **No new runtime dependencies** in the extension (engine access is subprocess-only, mirroring governance); devDependencies additions only if a test genuinely needs one (Clarification if so).
- **Rule #51**: client/server counts in any rendered copy derive from CLI data. **Rule #56**: the client roster enumeration comes from `detect`'s report (all 13 + dispositions), never a hand-maintained subset.

### Project Structure Notes

- New files: `extensions/iris-mcp-launcher/src/clientsEngine.ts`, `clientsView.ts`, `clientsPanel.ts` (+ tests under `src/__tests__/`); edits: `extension.ts` (registration), `package.json` (contributes.commands), `CHANGELOG.md`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 33.3 (ACs 33.3.1–33.3.4)]
- [Source: _bmad-output/planning-artifacts/research/technical-iris-server-manager-mcp-connections-research-2026-07-25.md#§3.6 (Extension UI shape)]
- [Source: extensions/iris-mcp-launcher/src/{governanceEngine,governanceView,governancePanel}.ts (32.2 layering precedent)]
- [Source: packages/client-config/README.md (CLI command reference)]

## Dev Agent Record

### Agent Model Used

Claude Code (k3[1m]) — dev stage re-spawn after the Option-1 clarification resolution.

### Debug Log References

- 2026-07-27 dev stage — HALTED before implementation (Clarification Needed). Live probe evidence:
  - `node packages/client-config/dist/cli/clients-cli.js detect --json` → envelope `data` = `{adapterDataVersion, clients[13], counts:{probed:13, detected, notDetected, dispositioned:3}}` — **no dispositions array** (`counts.dispositioned` is a bare number).
  - `node packages/client-config/dist/cli/clients-cli.js detect` (text) → DOES render the `CLIENT_DISPOSITIONS` rows ("Other clients:" — Pi `excluded-not-mcp-capable` + rationale, JetBrains/Kilo `roadmap`).
  - Source confirmation: `packages/client-config/src/cli/clients.ts` `cmdDetect` emits `{ ...report, counts }` where `report` = `DetectionReport` (`{adapterDataVersion, clients}`) — dispositions only enter the text renderer.
  Consequence: AC 33.3.1's Pi/roadmap info rows + Task 2's "Pi info row (from `CLIENT_DISPOSITIONS` via `detect` output)" + Dev Notes Rule #56's "detect's report (all 13 + dispositions)" cannot be satisfied through the Integration AC 33.3-I1-mandated `--json` surface with the shipped 33.2 CLI. The Dev Notes' lead-verified claim "detect output carries CLIENT_DISPOSITIONS (Pi/roadmap rows)" holds for the TEXT output only. Options put to the lead: (1) additively add `dispositions` to `detect --json` data in `packages/client-config` (recommended — needs a story-constraint exception or a small 33.2.x patch first), (2) sanction a text-render scrape of the "Other clients:" section as a documented I1 deviation, (3) de-scope the Pi/roadmap rows to static copy (amend story + epic spec). No code was written.
- 2026-07-28 dev stage (re-spawn, Option 1 sanctioned) — implementation complete. Probe evidence gathered this pass (Rule #14/#16/#36, all against the REBUILT bin):
  - `detect --json` after the additive change carries `dispositions` (verified live: Pi `excluded-not-mcp-capable` + 2 `roadmap` rows; `counts.dispositioned === dispositions.length`).
  - **`diff --json` in explicit mode carries the literal IRIS_PASSWORD** in `data.servers[].text` (the CLI redacts only its text/stderr renders via `redactPlanSecrets`; the JSON path emits raw `plan.diffText`) — verified by reading `cmdDiff` in `packages/client-config/src/cli/clients.ts`. Consequence (recorded in `clientsEngine.ts`'s banner): the UI NEVER uses `diff --json` for explicit mode; it uses the CLI's redacted TEXT render, and the password travels only on the child's stdin (`--password-stdin`). NOT fixed CLI-side — the sanction permits ONLY the dispositions addition; flagged for the retro/lead triage as a possible 33.2.x hardening item.
  - Mode availability is exposed by the CLI ONLY via the `--help` text render ("Modes available on THIS host:", one padded line per available mode) and via exit-2 refusals — no `--json` surface exists. The view probes `--help` once per refresh (`parseAvailableModes`, byte shape verified against the built bin); a probe failure degrades to the two always-available modes and the CLI's write-time gate stays the enforcement point (recorded decision — this is the story-sanctioned "probe via apply --help surfaces", NOT an invented parallel probe).
  - `doctor --json` exits 1 WITH findings and carries the data envelope on BOTH outcomes (mirrors governancePanel's `validate` special case).
- Rule #36 fixture captures (extension view/panel tests): `detect --json`, `status --json`, `diff --json`, `apply --yes --json`, `disable --json`, `doctor --json`, `--help` — captured 2026-07-28 from the built bin against a sandbox HOME with the claude-code fixture planted; capture commands recorded in `clientsView.test.ts`'s header.

### Completion Notes List

- **Sanctioned packages change (Option 1)**: `cmdDetect`'s `--json` emit in `packages/client-config/src/cli/clients.ts` gained `dispositions: CLIENT_DISPOSITIONS` (additive key; text render byte-unchanged) + the envelope doc updated in the module banner and `packages/client-config/README.md`. Regression test in `clients-cli.test.ts` (exact four-field rows, registry order, count agreement, Pi row). Back-compat: existing envelope keys untouched; `git diff HEAD -- packages/` = exactly 3 files (clients.ts, clients-cli.test.ts, README.md). Package suite 16 files / 324 tests (+1).
- **Engine layer (Task 1)**: `clientsEngine.ts` mirrors `governanceEngine.ts` — fail-closed local/npx resolution, case-insensitive `IRIS_*` scrub with the ONE extension-owned re-add (`IRIS_GOVERNANCE_FILE` from `irisMcpLauncher.governanceFile`; `IRIS_SERVER_MANAGER` deliberately NOT re-added — the CLI's SM probe works from settings-file discovery), typed per-command wrappers (`detectClientsJson`/`statusMatrixJson`/`availableModes`/`diffApplyJson`/`diffApplyText`/`applyJson`/`toggleJson`/`restoreJson`/`doctorJson`), reuses `resolveSpawnCommand` (the 32.2 cmd.exe discipline) and `DEFAULT_CLI_TIMEOUT_MS` from `governanceEngine.ts`. Spawn-level `clientsEngineRealCli.test.ts` (5 tests) drives the REAL built bin through the engine's own resolution/env/spawn against a sandbox HOME: observable file effects (apply→present, disable→stashed/absent, enable→restored, remove→byte-equal fixture, restore round-trip), exit-code mapping (usage exit 2 plain text / refusal exit 1 envelope), malformed-config refusal with bytes untouched, and the containment boundary (ambient `IRIS_GOVERNANCE_FILE`/`IRIS_SERVER_MANAGER`/`IRIS_PASSWORD` never reach the CLI; the settings-owned re-add does).
- **View-model (Task 2)**: `clientsView.ts` pure/vscode-free — roster reducers (default all-detected, `sanitizePersistedRoster` hostile-input tolerant), per-client scope derivation from detection probes (never a hand-maintained list, Rule #56), mode pickers constrained to the CLI-probed modes, apply staging with explicit-mode single-server validation, pending-action lifecycle, restart notices, doctor render, escaped HTML (a hostile foreign entry name proven non-injecting). 25 unit tests over real-captured shapes.
- **Panel + wiring (Task 3)**: `clientsPanel.ts` mirrors `governancePanel.ts` (busy guard, dispose resets busy, singleton reveal, message-boundary validation). Every write flows diff preview → webview explicit Confirm → engine → restart hint + status refresh (AC 33.3.3). Explicit mode: typed confirmation + hidden-password input boxes; the secret lives ONLY in the panel closure (never state/HTML/globalState/logs) and travels to the CLI only as child stdin. `extension.ts` registers `irisMcpLauncher.manageClients`; roster persisted via `context.globalState` under `irisMcpLauncher.clientRoster` (the extension's THIRD sanctioned non-secret write — `containment.test.ts`'s positive pin updated to exactly three, with the constant single-sourced in `clientsPanel.ts`). Tests: 18 panel orchestration + 3 activation-flow (real `extension.ts` through the vscode mock, incl. a full-stack wiring test: real subprocess render + real memento persistence across refresh).
- **"Backup list/restore" seam (recorded decision)**: the CLI exposes NO backup-enumeration surface (only `restore [--backup <name>]` + doctor's stale-backup findings) — per Rule #47 the UI does not invent a parallel filesystem probe. The UI offers restore-latest per client (staged + confirmed) and renders doctor findings (which name the stale-backup dir/count/oldest). Named-backup restore stays CLI-only; flagged for the retro if a backup-list command is wanted in 33.4+.
- **Connection literals stay CLI-only (recorded decision)**: AC 33.3.2 names scope + env-mode pickers only; `--host/--port/--username/--namespace/--https/--sm-servers` are not surfaced in the v1 UI (the CLI's defaults apply; env-reference mode references the user's own env vars).
- **AC 33.3.4 (manual GUI smoke) LEFT OPEN for the Project Lead** (the 31.4.4/31.5.4/32.2.4 honest-deferral pattern; the 31-5-1 headless constraint stands — the compensating controls shipped here are the view-model unit tests, the spawn-level real-bin e2e, and the activation-flow full-stack test). Executable procedure:
  1. Build the VSIX: `cd extensions/iris-mcp-launcher && npm run build && npx vsce package --allow-missing-repository` (self-contained zero-runtime-dep VSIX; `@iris-mcp/client-config` is NOT bundled — engine access is subprocess-only).
  2. Install into a real VS Code with the InterSystems Server Manager extension; set `irisMcpLauncher.developmentRepoPath` to this checkout (User settings) so the panel runs the repo's built `packages/client-config/dist/cli/clients-cli.js`.
  3. Run "IRIS MCP Launcher: Manage MCP Clients…". Verify: detected clients render with checkboxes (all selected by default), undetected clients collapsed, the Pi "not MCP-capable" info row + roadmap rows, and (toggle one client off, reload the window) the roster persists.
  4. Expand Claude Code and one OTHER detected client (e.g. Cursor); for each: check `iris-dev-mcp` in the apply row (env-reference mode, user scope), "Preview apply…" (the CLI's diff render appears — nothing written yet), Confirm.
  5. Restart both clients; verify both agents list the iris-dev-mcp tools (for Claude Code: `claude mcp list` or a new session's tool roster).
  6. In the UI, Disable `iris-dev-mcp` for ONE of the two clients (staged → Confirm); restart that client; verify the tools are ABSENT there and still PRESENT in the other (the F3 success metric).
  7. Restore the disabled client's config via "Restore backup…" (staged → Confirm) and verify the entry returns after restart; record VS Code version, both client versions, the CLI's `adapterDataVersion`, and outcomes back into this story.
- **Gates (all run 2026-07-28)**: extension `npx tsc --noEmit` clean; extension `npx vitest run` 25 files / 412 tests green (+5 files / +83 over HEAD's 20 / 329 — mechanically derived from the vitest JSON reporter, Rule #51); `pnpm turbo run build test lint type-check` 29/29; `pnpm gen:governance-baseline:check` (`:check` ONLY) exit 0 — frozen `1e62c5ad5bf7` / 141 / 201 / 60 unchanged (no new MCP tool/governance key — a CLI change is not an MCP tool; Rules #28/#31/#53 untriggered); NUL scan clean across all touched files; extension CHANGELOG entry added (Rule #43). No `bootstrap-classes.ts`/`BOOTSTRAP_VERSION`/`src/ExecuteMCPv2` contact. Changes left UNCOMMITTED for the lead's per-story smoke gate + commit.

### Post-merge amendment (2026-07-28, Project Lead decisions during the AC 33.3.4 smoke)

Two spec changes, epics.md amended in place (Rule #42), implemented in a post-merge patch on the feature branch:
1. **`iris-mcp-all` removed from the managed server set** (AC 33.3.2): the matrix/apply surface is the 5 leaf servers; aggregate entries are foreign/read-only. Rationale: a peer row invited applying all 5 + the aggregate, double-registering every tool.
2. **"Other clients considered" section removed from the view** (AC 33.3.1): Pi/roadmap dispositions live in the package README's adapter table, not the working surface. The CLI's `detect --json` keeps `dispositions` (read surface).

### File List

- `packages/client-config/src/cli/clients.ts` (sanctioned additive: `dispositions` in `detect --json` + envelope doc; **QA**: `diff --json` redaction fix)
- `packages/client-config/src/__tests__/clients-cli.test.ts` (+1 dev regression test; **QA** +4 JSON-redaction regression tests)
- `packages/client-config/README.md` (envelope doc sentence; **QA**: redaction sentence)
- `extensions/iris-mcp-launcher/src/clientsEngine.ts` (new; **QA**: stale leak-claim comments updated post-fix)
- `extensions/iris-mcp-launcher/src/clientsView.ts` (new)
- `extensions/iris-mcp-launcher/src/clientsPanel.ts` (new)
- `extensions/iris-mcp-launcher/src/extension.ts` (manageClients registration + engine/roster/input adapters)
- `extensions/iris-mcp-launcher/package.json` (contributes.commands entry)
- `extensions/iris-mcp-launcher/CHANGELOG.md` (Rule #43 entry)
- `extensions/iris-mcp-launcher/src/__tests__/clientsEngine.test.ts` (new, 32)
- `extensions/iris-mcp-launcher/src/__tests__/clientsEngineRealCli.test.ts` (new, 5 — spawn-level real-bin e2e)
- `extensions/iris-mcp-launcher/src/__tests__/clientsView.test.ts` (new, 25)
- `extensions/iris-mcp-launcher/src/__tests__/clientsPanel.test.ts` (new, 18)
- `extensions/iris-mcp-launcher/src/__tests__/clientsActivationFlow.test.ts` (new, 3)
- `extensions/iris-mcp-launcher/src/__tests__/containment.test.ts` (positive write pin: exactly three sanctioned non-secret writes)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status + last_updated append)
- **QA**: `extensions/iris-mcp-launcher/src/__tests__/clientsPanelRealCli.test.ts` (new, 8 — panel journeys through the REAL built CLI)
- **QA**: `extensions/iris-mcp-launcher/src/__tests__/clientsActivationFlowWrites.test.ts` (new, 2 — write journeys through the REAL extension.ts)
- **QA**: `extensions/iris-mcp-launcher/src/__tests__/vscodeMock.ts` (Rule #54 addition: `window.showInputBox` scripted responder — the one adapter with zero prior coverage)

## QA Agent Record

### Agent Model Used

Claude Code (k3[1m]) — QA stage (bmad-qa-generate-e2e-tests), 2026-07-27/28.

### QA Findings + Dispositions

- **QA-FOUND PRODUCT DEFECT (fixed CLI-side, regression-pinned): `diff --json` explicit-mode password leak.** Confirmed LIVE against the built bin: `iris-mcp-clients diff --client claude-code --servers iris-dev-mcp --mode explicit --confirm-secret iris-dev-mcp --password-stdin --json` emitted the literal probe password in `data.servers[].text` (only the text/stderr renders went through `redactPlanSecrets`; the JSON envelope emitted raw `plan.diffText`). Fixed in `cmdDiff` by routing the envelope's `text` through `redactPlanSecrets` — the text-render discipline applied to the envelope — re-probed live post-fix (envelope carries `********`, secret absent), with 4 regression tests in `clients-cli.test.ts` (long verbatim secret masked; below-gate secret withheld; serializer-escaped secret withheld; non-explicit envelope byte-identical = back-compat proof). Module banner + README envelope docs updated; the extension's stale leak-claim comments in `clientsEngine.ts` updated (the engine keeps the explicit-preview-via-text choice as belt-and-braces). This resolves the dev-flagged "possible 33.2.x hardening item" IN this story — the retro ledger entry should be marked resolved, not deferred.
- **E2E/edge layer added on top of the dev suite** (dev: engine wrappers with real CLI OR panel with fake engine; QA: panel + REAL engine host composed verbatim like `extension.ts`, driven by webview messages against sandbox HOMEs, asserting observable file effects):
  - Full journey: open → roster default-select → apply `iris-dev-mcp` env-reference → config contains the entry → disable → stashed/absent → enable → present; restart hint rendered after EVERY write; the fixture's third-party entry byte-intact through every write and rendered read-only (never a toggle target); undetected clients collapsed in `<details>`; Pi disposition row rendered.
  - Restore after EXTERNAL corruption (garbage written to the config): UNPARSEABLE banner renders via refresh, staged restore rolls the file back to the pre-apply backup's bytes.
  - Doctor findings rendered (the real env-references/IRIS_PASSWORD-unresolved finding after an env-reference apply).
  - Hostile persisted-roster shapes through the memento seam (non-array → all-detected default; mixed junk array → filtered, never rendered, forgotten at the next toggle; dispose/reopen round-trip honors the persisted selection).
  - npx-unavailable bin failure (no devRepoPath, PATH without npx): ONE typed inline error banner, no crash, nothing further spawned.
  - Explicit-mode secret containment against the CLI's REAL redaction gate, below AND above the length gate: the preview masks (`********`) or withholds (`(render withheld`), no rendered HTML ever carries the secret, and the write lands the literal in the client config.
  - Busy-guard re-entrancy: mid-flight preview ignores stage/confirm/cancel/refresh/roster/doctor gestures (deferred fake engine — the one place a fake is the right tool; shapes from the real-capture fixtures).
  - Two write journeys through the REAL `extension.ts` (33-3-4 env-reference, 33-3-5 explicit) — the first coverage of `extension.ts`'s write path and of the `askInput` adapter (`window.showInputBox`, newly added to vscodeMock per Rule #54: scripted responder, default = the dismissed shape; the `password: true` hidden-input gesture asserted at the real wiring tier).

### Gates (all run 2026-07-27/28)

- `packages/client-config`: 16 files / **328** tests green (+4 over dev's 324, mechanically derived from the vitest run summary, Rule #51); dist rebuilt and the fix re-probed live.
- `extensions/iris-mcp-launcher`: `npx tsc --noEmit` clean; `npx vitest run` 27 files / **422** tests green (+2 files / +10 over dev's 25/412, mechanical).
- `pnpm turbo run build test lint type-check` 29/29; `pnpm gen:governance-baseline:check` (`:check` ONLY) exit 0 (no MCP tool/governance surface touched); NUL scan clean across all QA-touched files. All changes left UNCOMMITTED.



## Code Review Record (2026-07-28)

### Agent Model Used

Claude Code (k3[1m]) — code-review stage (bmad-code-review).

### Review layers

**All three spawned review layers (Blind Hunter bh-33-3, Edge Case Hunter eh-33-3, Acceptance Auditor aa-33-3) failed to return within the review window; their mandates were executed reviewer-direct** (the 32.3 precedent — the fourth consecutive Epic-33 story with silent layers). Reviewer-direct coverage: full read of the three new modules + extension.ts wiring + the CLI changes against @types/vscode and the governance* 32.2 precedent; live verification of the `--help` modes render against the parser regex, the CLI's empty-stdin password refusal (clients.ts:752, fail-closed), the `redactPlanSecrets` gate + its 4 QA regression pins, and the `apply --json` envelope (redacted preview on stderr only, no diff text in the envelope — the leak surface was diff-only and is closed); mechanical gate re-runs.

### Review Findings

- [x] [Review][Patch] **33-3-R1 (LOW): a staged EXPLICIT apply survived `refresh`, but its secret did not — a dead-retry loop** [clientsPanel.ts] — `refresh` wiped `explicitSecret` while `pendingAction` was preserved; Confirm then sent an empty stdin (CLI exit-2 refusal, verified fail-closed at clients.ts:752) and `writeFailed` kept the action for retries that could never succeed. Same loop after ANY failed explicit confirm. Patched: refresh drops a pending explicit apply; a failed explicit confirm drops the staged action and surfaces the error as a banner (non-explicit modes keep the keep-for-retry behavior). Regression pins: 2 new clientsPanel tests (refresh-drop + failed-confirm-drop, incl. a no-re-fire assertion).
- [x] [Review][Patch] **33-3-R2 (LOW): stale `explicitSecret` retention contradicted the documented "cleared on confirm/cancel/dispose/refresh" invariant** [clientsPanel.ts] — staging a toggle/restore OVER a pending explicit apply, and the toggle/restore confirm branches, never cleared the held password. Inert behaviorally (never rendered, never sent — no later path reads it), patched as containment hygiene aligning code with the banner's invariant: the secret is now cleared on every stage-over and every confirm branch.
- [x] [Review][Patch] **33-3-R3 (LOW): `renderDispositions` threw on an OLDER CLI's detect envelope (no `dispositions` key)** [clientsView.ts, clientsEngine.ts] — npx version skew or a stale `developmentRepoPath` checkout serves a pre-33.3 envelope; `detect.dispositions.length` would throw and the panel's `.catch(() => undefined)` would silently freeze the view. Patched: `DetectData.dispositions` is now optional (skew documented) and the render tolerates its absence (section omitted, roster intact). Regression pin: new clientsView skew test; the real-bin e2e assertion updated to still require the key from the CURRENT bin.

### Dismissed (reviewer-direct)

- Typed-confirmation not validated view-side in explicit mode (a typo makes the CLI refuse, fail-closed, error rendered — the CLI gate is the designed enforcement point).
- vscodeMock `showInputBox` not recording `ignoreFocusOut` (recorded tuple covers the asserted gestures; runtime-tolerant).
- `dismissNotices` not busy-guarded (mutates only restart notices; cannot interleave with a write).

### Tally

0 decision-needed · 3 patched (all LOW) · 0 deferred · 3 dismissed · 0 HIGH · 0 MEDIUM. Re-deferral count 0. Nothing added to deferred-work.md (no defer-bucket items).

### Verification (all run at review, mechanically derived — Rule #51)

- AC 33.3-I1: extension reads/writes NO client config file (only fs touch in the clients modules is the CLI-bin existence probe); every view action spawns the `iris-mcp-clients` bin with `--json`; spawn env scrubs `IRIS_*` case-insensitively with the single extension-owned `IRIS_GOVERNANCE_FILE` re-add — the real-bin e2e containment test re-run green at review.
- Sanctioned packages/** exception honored EXACTLY: `git diff HEAD --stat -- packages/` = exactly 3 files (clients.ts — additive `dispositions` + QA redaction fix; clients-cli.test.ts — regression pins; README.md — envelope docs).
- Rules: #54 (vscodeMock `showInputBox` default = the dismissed shape — a real API outcome; scripted responder type matches `string | undefined`), #36 (fixtures captured from the built bin, capture commands in test headers), #51 (rendered counts derive from CLI `counts`), #56 (roster/scopes/modes all derive from `detect`/`--help` output — verified live against the built bin's help render), #47 (no invented probes — the sanctioned `--help` parse only).
- Gates post-patch: extension `npx tsc --noEmit` clean; extension vitest 27 files / **425** tests green (+3 review pins over QA's 422); client-config vitest 16 files / 328 green (unchanged); `pnpm turbo run build test lint type-check` 29/29; `pnpm gen:governance-baseline:check` (`:check` ONLY) exit 0 (frozen `1e62c5ad5bf7` / 141 / 201 / 60); NUL scan clean across all touched files.
- AC 33.3.4 manual GUI smoke remains OPEN for the Project Lead (sanctioned pattern; executable procedure in Completion Notes).

## Change Log

- 2026-07-28 (dev, re-spawn after Option-1 clarification): shipped the "MCP Clients" UI — engine/view/panel mirroring the 32.2 layering over the `iris-mcp-clients` CLI (subprocess-only, IRIS_*-scrubbed env), roster persisted in globalState, diff-preview → explicit-confirm → engine write flow with restart hints, backup restore + doctor surfaces; sanctioned additive `dispositions` in `detect --json` (+regression test + envelope doc); 5 new extension test files (+83 tests), client-config +1 test; AC 33.3.4 manual GUI smoke LEFT OPEN for the Project Lead with the executable procedure in Completion Notes.
- 2026-07-27/28 (qa): CONFIRMED + FIXED the dev-flagged `diff --json` explicit-mode password leak CLI-side (`redactPlanSecrets` applied to the JSON envelope; 4 regression tests; live re-probe clean) — QA-found product defect, resolves the dev's deferred hardening item in-story. Added the E2E/edge layer: `clientsPanelRealCli.test.ts` (8 — full panel journeys through the REAL built CLI against sandbox HOMEs: apply→disable→enable lifecycle with restart hints, restore after external corruption, doctor findings, hostile roster shapes, npx-unavailable typed failure, explicit-mode containment below AND above the redaction gate, busy-guard re-entrancy) + `clientsActivationFlowWrites.test.ts` (2 — write journeys through the REAL `extension.ts`, incl. the previously-uncovered `askInput` adapter; `window.showInputBox` added to vscodeMock per Rule #54). Gates: client-config 328 (+4), extension 422 (+2 files/+10), turbo 29/29, baseline check exit 0, NUL scan clean.
- 2026-07-28 (code review): all three review layers silent (fourth consecutive Epic-33 story; 32.3 reviewer-direct precedent). 3 LOW patched in-story (33-3-R1 explicit-apply dead-retry loop after refresh/failed confirm; 33-3-R2 stale explicitSecret retention vs the documented invariant; 33-3-R3 renderDispositions crash on older-CLI envelopes missing `dispositions`) + 3 regression pins; 0 deferred, 3 dismissed, 0 HIGH/MEDIUM. Gates: extension 425 (+3), client-config 328, turbo 29/29, baseline check exit 0. Story → done; AC 33.3.4 manual smoke stays OPEN for the Project Lead.
