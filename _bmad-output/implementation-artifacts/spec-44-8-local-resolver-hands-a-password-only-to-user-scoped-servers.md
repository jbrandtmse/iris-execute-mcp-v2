---
title: 'Story 44.8: Local Resolver Hands a Password Only to User-Scoped Servers'
type: 'bugfix'
created: '2026-11-23'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Under VS Code's Local harness, `resolveEnvForLabel` takes a server's host, port, scheme and username from Server Manager's `getServerSpec` (VS Code's merged `intersystems.servers` view, which a workspace, folder or language-specific `settings.json` can override field by field) and the password from that spec's inline value or from Server Manager's session, which is keyed by server name and username only. So an opened repository that overrides a user-defined server's `webServer.host` receives that user's stored password (DW-752; confirmed by probe, Design Notes P-1/P-2).

**Approach:** Before any credential step, the Local resolver applies DW-749's `isUserScopedServer` rule to every server of the plan, inspected in the scope the server was enumerated in. A server that any workspace, folder or language-specific layer defines, or whose inspection fails, is not started: no `getServerSpec`, `getAccount` or `getSession` call, and one clear warning that names the workspace override (P-3). User-only servers resolve exactly as today. This is a sanctioned AD-15 change.

## Boundaries & Constraints

**Always:**
- The guard runs in `resolveEnvForLabel` after the settings read and before the per-server credential loop, for every server of the plan, so a refused plan never prompts, never calls `getServerSpec`/`getAccount`/`getSession`, and never reaches Server Manager's auth provider (whose own session check sends the stored password to the merged host, P-2). A token already cancelled on entry still returns `undefined` silently, before the guard.
- Reuse, do not copy: `isUserScopedServer` is unchanged. One private helper on `LauncherProvider` (inspect in try/catch, then `isUserScopedServer`) returns a tri-state verdict (`user` / `not-user` / `uninspectable`) and is used by BOTH `lookUpProvidedConnection` (provide: anything but `user` gives `{}`, as today) and the resolve guard. An absent `inspectServerManagerServers` dependency, a throw, or an `undefined`/non-object result is `uninspectable`.
- Exactly one `showWarning` per refused resolve call, no secret in it, with these texts (pinned verbatim by tests):
  - `not-user`: `IRIS MCP Launcher: "<label>" was not started — IRIS server "<server>" is defined or overridden in this workspace's settings (an intersystems.servers entry in a workspace, folder or language-specific settings layer), so its stored password was not used: a workspace must not choose where that password is sent. Define the server in your user settings under a name no workspace settings use, and select that name in irisMcpLauncher.servers.`
  - `uninspectable`: `IRIS MCP Launcher: "<label>" was not started — the intersystems.servers settings that define IRIS server "<server>" could not be inspected, so its stored password was not used. Try reloading the window.`
  - In a multi-server (`combineProfiles`) plan the first refused server in plan order is named.
- Back-compat (AC 44.8.3, Rule #19): for a server defined in user (or default) settings alone, the resolved env, the `getSession` call sequence and options, every warning text and the cancellation outcome are exactly today's. The existing pins keep their expected literals; the only edit to them is wiring `inspectServerManagerServers: () => userScopeServers([...])` into providers that lack it.
- Every fake returns a shape the real API returns (Rule #54): Server Manager keying per its 3.16.0 source, VS Code's deep merge per 1.147.0, `inspect` and `AuthenticationSession` per the installed `@types/vscode` 1.125.0 (P-1). The fixtures' headers cite those sources.
- Docs and release (AC 44.8.2): both CHANGELOGs name the sanctioned AD-15 change; the 44.6 "Local harness unchanged" claims are corrected, not appended to; one changeset (P-6).

**Never:**
- No change to the provide (Copilot-harness) path's behaviour, to `isUserScopedServer`, to `credentials.ts`, to `packages/shared` source, or to any tool, action, governance key or description. `GOVERNANCE_BASELINE` stays `1e62c5ad5bf7`/141; the tools-list snapshot is unchanged.
- No launcher-own password prompt and no `forceNewSession`; no new setting.
- Never read or list the real VS Code profile (`~/.vscode*`, `~/Library/Application Support/Code`), `~/.claude`, `~/.copilot` or the keychain; credential proofs use a scratch `HOME` and `scripts/lib/fake-keyring-preload.mjs`. No IRIS is needed; never touch the shared instance.
- No publish, `changeset version`, `pnpm run version`, `vsce`, `gen:bootstrap`, `gen:ipm` (`:check` only), or the bare governance generator. No edit of the spine, `epics.md`, `deferred-work.md`, `sprint-status.yaml`, `.claude/rules/*`, `CLAUDE.md`, `irislib/`, `irissys/`.

## I/O & Edge-Case Matrix

Fixture: user layer `dev1 = {webServer:{scheme:"https",host:"user-iris.corp.example",port:443},username:"svc44"}`; Server Manager holds a stored password for `dev1/svc44`. "Nothing called" = no `getServerSpec`, `getAccount` or `getSession` call.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| User-only, stored session | `globalValue` only | Today's env (user host, stored password); `getSession` silent then as today | none |
| User-only, inline password / cancel | existing fixtures (`LOCAL_ENV_CAPTURE`; refusal) | Literals unchanged; cancel = one `credentials for IRIS server "a" were not provided` warning, `undefined` | unchanged |
| Workspace overrides host | `+ workspaceValue {dev1:{webServer:{host:"127.0.0.1",port:52799,scheme:"http"}}}` | `undefined`; the `not-user` warning; nothing called | fail safe |
| Override + user's inline password | user layer adds `password`; workspace overrides host only | `undefined`; `not-user`; nothing called (the merged spec would carry the user's inline password) | fail safe |
| Folder / language layers | `workspaceFolderValue`, `workspaceLanguageValue` or `workspaceFolderLanguageValue` overriding port, scheme or username | `undefined`; `not-user`; nothing called | fail safe |
| Workspace-only server | name only in `workspaceValue` | `undefined`; `not-user` (behaviour change, P-4) | fail safe |
| Name-level rule | workspace layer sets only `description`, or is not an object | `undefined`; `not-user` | fail safe |
| Inspection fails | dep absent, throws, or returns `undefined` | `undefined`; `uninspectable`; nothing called | fail safe |
| Combined plan | `combineProfiles`, servers `[a (user), b (workspace)]` | `undefined`; one `not-user` naming `b`; nothing called for `a` either | fail safe |
| Folder scope | server enumerated with folder scope `S` | inspect is called with `S` (the scope `getServerSpec` would read) | — |

</intent-contract>

## Code Map

- `extensions/iris-mcp-launcher/src/serverDefinitionProvider.ts` -- `isUserScopedServer` `:109-127` (reused unchanged); `ProviderDeps.inspectServerManagerServers` `:94-99` (doc comment widens to the resolve path); `lookUpProvidedConnection` `:456-472` (switch its inline `isUserScopedServer(...)` call to the new helper); `resolveEnvForLabel` `:625-776` -- the guard goes between the settings read (`:647-657`) and the loop (`:663`), keeping the loop's token check first; `scopesByServerName` `:167` is the scope source for both paths; the class doc comment `:1-19` and `resolveEnvForLabel`'s doc `:613-624` list the new `undefined` outcome.
- `extensions/iris-mcp-launcher/src/credentials.ts:68-195` -- `resolveServerCredentials` (read-only here): `getServerSpec(name, scope)` then inline `spec.password` (`:105`) or `getSession([name, username])` silent then `createIfNone` (`:143-166`); `host` from the merged spec. This is the leak path the guard now precedes.
- `extensions/iris-mcp-launcher/src/extension.ts:593-596` -- `inspectServerManagerServers` wiring (`getConfiguration("intersystems", scope).inspect("servers")`), unchanged; `:689-695` -- `resolveMcpServerDefinition` returns `undefined` when the provider does (VS Code then does not start the server).
- `extensions/iris-mcp-launcher/src/types.ts:136-145` -- `ServerManagerServersInspection`.
- `extensions/iris-mcp-launcher/src/__tests__/serverManagerInspection.ts` -- the inspection fixture (`userScopeServers`); extend it here (P-5).
- `extensions/iris-mcp-launcher/src/__tests__/serverDefinitionProvider.test.ts` -- `makeDeps` `:118-157` (already wires `userScopeServers`); `makeRejectingDeps` `:366-394` and the "unavailable" test `:417-440` lack the dep; Story 44.6 AC-11 block `:2022-2120` (`LOCAL_ENV_CAPTURE`, the prompts/cancellation pin; its `refusing` provider lacks the dep).
- `extensions/iris-mcp-launcher/src/__tests__/pinnedDefinitionsActivationFlow.test.ts:211-225` -- the DW-749 activation test whose last line pins the defect (`launched[0]!.env["IRIS_PASSWORD"]).toBe("SYS")` for a workspace override); `vscodeMock.ts:360-372` (`inspect` returns `globalValue`/`workspaceValue`), `:408-425` (`authentication.getSession` records `mockState.getSessionCalls`).
- `extensions/iris-mcp-launcher/src/__tests__/dw749Characterization.test.ts` -- fresh-process precedent: real `LauncherProvider`, built `iris-dev-mcp`, `fake-iris-listener.mjs` (`authorizations` list), fake keyring preload, scratch `HOME`, `skipUnbuilt`, a control leg proving the oracle varies.
- Other test files that construct `LauncherProvider` and resolve: `containment.test.ts`, `selectServers.test.ts:825-910` (byte-identical pin), `copilotProvidedEnv.test.ts`, `copilotEmptyOverrides.test.ts`, `localSpawnIntegration.test.ts` (already wired), `governanceActivationFlow.test.ts` (through `extension.ts`). 80 `new LauncherProvider` sites in total.
- Docs: `extensions/iris-mcp-launcher/README.md:152` (its last sentence "the Local harness still prompts for such a server as before" becomes false), `:363-380` (Credential handling); `extensions/iris-mcp-launcher/CHANGELOG.md` `## [Unreleased]` (the "Local harness unchanged." bullet becomes false for these servers); root `CHANGELOG.md` (newest block first; the Story 44.6 block's "Under the Local harness the resolve step still runs and returns exactly the env it returned before." needs the same correction); `.changeset/story-44-6-*.md` (shape).
- `packages/iris-mcp-all/src/__tests__/story-44-6-doc-claims.test.ts` -- sibling doc-claims test (Rule #45 location; `squash`, `read`, the `it.skipIf(!changesetPresent)` changeset pattern); it pins "**Only servers defined in your user settings get a connection.**" and "start in a Copilot-harness chat session", which must stay.

## Tasks & Acceptance

**Execution (in dependency order):**
- `extensions/iris-mcp-launcher/src/__tests__/serverManagerInspection.ts` -- Add the Rule #54 fakes (P-5): a layered inspection builder (any of the eight `inspect` layers), `mergedSpec(layers, name)` applying VS Code's `mergeContents` deep merge in layer order and Server Manager's normalisation (scheme default `http`, `password` kept only with a `username`), and a session-store `AuthApi` keyed `${serverName}/${userName.toLowerCase()}` (silent: the stored session or `undefined`; `createIfNone`: the stored session without a prompt, else a rejection). Header cites P-1's sources.
- `extensions/iris-mcp-launcher/src/serverDefinitionProvider.ts` -- The tri-state helper, the resolve guard and the two warnings per the Boundaries; `lookUpProvidedConnection` uses the helper; doc comments state the new contract.
- `extensions/iris-mcp-launcher/src/__tests__/dw752LocalResolve.test.ts` (new) -- Every I/O matrix row over the real `LauncherProvider` with the P-5 fakes, asserting the env (or `undefined`), the exact warning text, and call counts on `getServerSpec`/`getAccount`/`getSession`/`inspect` (and the inspect scope); plus the fresh-process wire leg (AC-3). If the spawn/listener plumbing is shared with `dw749Characterization.test.ts`, factor it into one test helper module both use rather than copying it.
- `extensions/iris-mcp-launcher/src/__tests__/` (sweep) -- Wire `inspectServerManagerServers: () => userScopeServers([...])` into every provider whose test resolves a user-scope server and lacks it (`makeRejectingDeps`, the "unavailable" test, AC-11's `refusing`, `selectServers.test.ts`, `containment.test.ts`, others found by grep); no expected literal changes. Change `pinnedDefinitionsActivationFlow.test.ts`'s DW-749 test so a workspace override's `resolveMcpServerDefinition` returns `undefined`, shows the `not-user` warning and records no `getSessionCalls`; add a user-only control there. Extend `containment.test.ts` with a distinctive stored password flowing through both refusal paths and never appearing in a warning or the diagnostic log.
- `extensions/iris-mcp-launcher/README.md` -- `:152`: replace the Local-harness sentence (both harnesses now refuse such a server; name the remedy); Credential handling: one bullet saying the Local resolve step starts only servers defined in user settings alone, never calls Server Manager's credential API for the others, and shows the warning.
- `extensions/iris-mcp-launcher/CHANGELOG.md` -- Under `## [Unreleased]`: correct the "Local harness unchanged." bullet (unchanged for servers defined in user settings alone); add a bullet for Story 44.8 (DW-752) naming the sanctioned AD-15 change, the refused cases, the warning and the remedy.
- `CHANGELOG.md` -- New top block `## [Unreleased] — Story 44.8: Local Resolver Hands a Password Only to User-Scoped Servers` (`### Fixed` DW-752; `### Changed` "sanctioned AD-15 change, wave-9 decision #153" with the behaviour change for workspace-defined servers and the remedy); correct the Story 44.6 block's Local sentence to point at it.
- `.changeset/story-44-8-local-resolver-hands-a-password-only-to-user-scoped-servers.md` (new) -- `"@iris-mcp/shared": patch`, text per P-6.
- `packages/iris-mcp-all/src/__tests__/story-44-8-doc-claims.test.ts` (new, default suite) -- Pins: the root block exists and contains "sanctioned AD-15 change" and "DW-752"; the extension CHANGELOG's first section names Story 44.8 and no longer claims the Local harness is unchanged without qualification; README `:152`'s bullet no longer says the Local harness still prompts and the Credential-handling section names the refusal; the changeset (guarded `it.skipIf`, as in 44.6) is one `@iris-mcp/shared` patch.

**Acceptance Criteria:**
- AC-1 (44.8.1, probe): Given Design Notes P-1/P-2, when the story closes, then the spec records Server Manager's keying (name + username, no scope or host), VS Code's deep merge, and the probe run on the built launcher dist showing the leak on the Local path; DW-752 is not closed with evidence (the defect is real).
- AC-2 (44.8.2): Given each I/O matrix row, when `resolveEnvForLabel` runs for its label, then the outcome, the exact warning text and the call counts are as the row says.
- AC-3 (44.8.2/44.8.4, Integration; consumer: the process VS Code's Local harness spawns): Given a scratch `HOME`, an empty fake keyring (preload), the fake IRIS listener as the workspace author's host, and a stored password for `dev1/svc44` in the session fake, when the env returned by `resolveEnvForLabel` (if any) is spawned the way the Local harness does (`null` entries deleted, over a scrubbed base env) as a fresh built `iris-dev-mcp`, then for the workspace-override fixture nothing is spawned and the listener never sees `Basic base64(svc44:<stored>)`; and the control (user-only, the user host = the listener) does see it, so the oracle can fail. Skips with a logged reason when unbuilt, fails on CI.
- AC-4 (44.8.2, the editor surface): Given the real `extension.ts` over `vscodeMock` with a `workspaceValue` overriding `prod`'s host, when the editor resolves the definition, then `resolveMcpServerDefinition` returns `undefined`, the `not-user` warning is shown once, and `mockState.getSessionCalls` is empty; the user-only control still resolves `IRIS_PASSWORD: "SYS"`.
- AC-5 (44.8.3, Rule #19): Given user-only servers, when the existing Local pins run (`LOCAL_ENV_CAPTURE`, the prompts/cancellation test, `selectServers.test.ts`'s byte-identical pin, `governanceActivationFlow` 32-2-5, `pinnedDefinitionsActivationFlow`'s resolved-env tests), then they pass with their expected literals unchanged; `git diff` on those files shows only the added inspection wiring (and AC-4's named DW-749 test change).
- AC-6 (Rule #59/#19): Given the planned mutations in `## Verification`, when each is applied, then the named tests go red on the Local path, and the tree is byte-identical after each revert.
- AC-7 (docs/release): Given this story's diff, when `story-44-8-doc-claims.test.ts` and `story-44-6-doc-claims.test.ts` run, then both pass.
- AC-8: Given a fresh build, when the launcher suite, `pnpm gen:governance-baseline:check`, `pnpm gen:tools-list-snapshot:check` and `pnpm gen:ipm:check` run, then all are green with no tool, key or snapshot change, and the added and changed tests pass forward and in reverse order.

- DW-761 *(lead, spec gate, decision #154; was this plan's `deferred:` item; same class as DW-752)*: the shared Server Manager import (`IRIS_SERVER_MANAGER=auto`, `packages/shared/src/server-manager-source.ts:288-310`) takes a server's definition from the first settings file that names it, with workspace `.vscode/settings.json` and `*.code-workspace` before user settings. It then looks the password up in the keychain by server name, so a workspace file may direct a stored password to its own host. **Probe first** (Rule #16), with fixtures under a scratch HOME and the fake keyring preload, never the real profile or keychain: does a workspace entry (full, or host-only) claim the slot, and is the keychain password then sent to the workspace's host? **If yes**, apply the same rule as the launcher: a keychain or helper password goes only to a server whose connection fields come from user settings alone. A workspace-defined or workspace-overridden server gets no stored password and a clear error naming the override, unless its own definition carries the password inline in that same file. Pin user-only servers byte-identical (Rule #19), mutation-prove the guard on the path it guards (Rule #59), and record the change as a sanctioned AD-15 change in the CHANGELOG. **If no**, close it with the probe evidence. Either way the disposition is terminal.

## Spec Change Log

- 2026-11-23 (lead, spec gate, decision #154): accepted P-3 (the fail-safe warning, with no Server Manager prompt) and P-4 (workspace-only servers get the warning under Local: the sanctioned AD-15 change, short-lived because the Local harness is removed in February 2027). The `deferred:` shared-import item is harvested as DW-761 and taken into this story: same class, before the release. The spine is amended at the gate: an AD-15 Story 44.8 entry, and AD-9 extended to the Local resolve step and the shared import. The changeset is `@iris-mcp/shared` patch, and the extension follows the fixed group (P-6).

## Review Triage Log

## Design Notes

**P-1 Sources (probe 2026-11-23; nothing read from any real VS Code profile, `~/.claude`, `~/.copilot` or keychain).** Server Manager v3.16.0 (latest release 2026-11-04; tag commit `7fb0df1a9e72013a7643ee002316cc02c6148d22`) fetched with `gh api` into `scratchpad/sm-src-44-8/`: `src/authenticationProvider.ts` (sha256 `dc8599e2…`), `src/authenticationSession.ts` (`1340c404…`), `src/api/getServerSpec.ts` (`73ccdd7d…`). VS Code 1.147.0 `src/vs/platform/configuration/common/configurationModels.ts` (`1c2e41bd…`, `mergeContents` `:218-228`) and `configuration.ts` (`merge` `:341-355`). Installed types: `@types/vscode` 1.125.0 (`AuthenticationSession` `index.d.ts:17823-17846`, `WorkspaceConfiguration.inspect` `:6867`), `@intersystems-community/intersystems-servermanager` 3.10.2.

**P-2 Findings.**
1. **Keying is by name and username only.** `sessionId(serverName, userName) = "<serverName>/<userName lowercased>"` and the stored password lives in SecretStorage under `credentialProvider:<sessionId>` (`authenticationProvider.ts:47-53`); `getSessions` filters by positional, case-insensitive scopes `[serverName, userName]` (`:88-112`). No scope, host, port or scheme takes part.
2. **The spec is the merged view.** `getServerSpec(name, scope)` reads `getConfiguration("intersystems.servers", scope).get(name)` (`getServerSpec.ts:82`), and VS Code merges object settings recursively, key by key (`mergeContents`), so a workspace entry with only `webServer.host` keeps the user's username, port, scheme and inline password.
3. **Server Manager itself sends the stored password to the merged host.** When exactly one session matches, `getSessions` runs `_isStillValid`, which calls `getServerSpec(session.serverName)` (no scope: the window's merged view) and makes a `HEAD` with the session's password (`authenticationProvider.ts:330-359`). So calling `getSession` at all, even silently, can leak; the guard must run before it.
4. **Server Manager's "prompt" uses the stored password first.** `createSession` returns an existing session (`findExistingSession`, which validates as in 3) or the SecretStorage value for that key before it would ever prompt (`:119-158`); `forceNewSession` goes through the same `createSession`.
5. **The Local path leaks (probe run).** `scratchpad/probe-44-8/probe-local-resolve.cjs` drove the built launcher dist (`extensions/iris-mcp-launcher/dist`, built from HEAD `78a688fb85df39e7864fa74396fa652eac531402`) with fakes modelling 1-2, Node 26.8.1. User-only: `IRIS_HOST=user-iris.corp.example`, stored password, one silent `getSession(["dev1","svc44"])`. Workspace overrides host/port/scheme: `IRIS_HOST=127.0.0.1`, `IRIS_PORT=52799`, `IRIS_PASSWORD=users-stored-password`, no warning (the provide env was already `{}`, DW-749). Workspace overrides host and the user layer has an inline password: `IRIS_HOST=127.0.0.1`, `IRIS_PASSWORD=users-inline-password`, no `getSession` call. DW-752 is real; it is not closed with evidence.

**P-3 The choice for a non-user-scoped server: the fail-safe message (owner condition 3).** Server Manager's own prompt is not a safe option: by P-2.3 and P-2.4 every route into it (silent lookup, `createIfNone`, `forceNewSession`) first uses or validates the password stored under the same name and username, against the merged host, so "let Server Manager prompt" would hand over the very password the story protects, silently. The fail-safe message is therefore the least surprising safe behaviour: the server does not start, nothing reaches Server Manager's credential API, and the one warning says why (the workspace override) and how to proceed (define it in user settings under a name no workspace uses). A launcher-own password box was rejected: it is outside the owner's two options, adds UI, and would still send a typed password to a host the workspace chose. The rule is name-level, as `isUserScopedServer` is (a workspace layer defining the name with any field, even `description`, counts); that covers the four fields the AC names and keeps one rule for both harnesses.

**P-4 Behaviour change (sanctioned AD-15 change, decision #153).** A server defined only in workspace settings (a team's committed `.vscode/settings.json`) used to start under the Local harness through Server Manager's prompt or stored session; it now gets the `not-user` warning. The owner's condition 2 covers it (its host comes from a workspace layer). The CHANGELOGs and README name it with the remedy. User-only servers are byte-identical (AC-5).

**P-5 Fakes (Rule #54).** The session-store fake encodes P-2.1 (and returns a session for `createIfNone` without prompting when one is stored, per P-2.4; rejects when none, the real cancel shape the existing suite already pins). `mergedSpec` encodes P-2.2. Inspection layers use only `inspect`'s eight documented fields. The fakes model what the launcher sees; Server Manager's internal `HEAD` (P-2.3) is not modelled: the guard makes it unreachable because `getSession` is never called, which the call-count assertions pin.

**P-6 Changeset and versioning (owner condition 7; correction for the lead, Rule #42).** The extension cannot be named in a changeset: `pnpm-workspace.yaml` lists only `packages/*`, so `changeset version` would reject it (44.6 P-7.1, decision #140). The extension's version follows the fixed `@iris-mcp/*` group (AD-29 lockstep, `scripts/release-version.mjs`), so "a changeset bumps the extension" is met by `.changeset/story-44-8-…md` = `"@iris-mcp/shared": patch`, whose text says the fix is in the launcher vsix (a must-carry of the release), that no `@iris-mcp/*` code changes, and that the extension's version follows the group.

**P-7 Governing ADs (Rule 6).** AD-9 (Credentials: "an untrusted repository injecting configuration"; this extends the 44.6/DW-749 user-scope rule to the Local resolve path), AD-15 (sanctioned change, user-only path pinned byte-identical), AD-29 (lockstep vsix, changeset via the fixed group, no publish), AD-2 (the extension imports nothing from the workspace at runtime). No AC contradicts an AD's Rule. **For the lead (Rule 20):** AD-15's sanctioned list gains a Story 44.8 entry (decision #153), and AD-9's 44.6 Credentials bullet can say the same user-scope rule now also gates the Local resolve step (refuse with a warning; no Server Manager credential call).

**P-8 Integration, Consumes (Rules 1-2).** No new service or module. Consumes: Server Manager API `getServerSpec`/`getAccount` and `vscode.authentication.getSession` (fakes per P-5), `WorkspaceConfiguration.inspect` (wired in `extension.ts`), the built `iris-dev-mcp` and `fake-iris-listener.mjs` (AC-3). Consumer of the changed behaviour: VS Code's Local harness through `extension.ts` `resolveMcpServerDefinition` (AC-4) and the process it spawns (AC-3). Extend, don't copy: the tri-state helper serves both paths; `isUserScopedServer` and `serverManagerInspection.ts` are extended, not duplicated; AC-3 reuses the DW-749 fresh-process plumbing.

**P-9 Ledger inbox (Rule 17).** DW-752 (`routed`, owner this story): addressed by ACs 1-6; resolvable by this story's delivered scope. New out-of-footprint observation in frontmatter `deferred:` (the shared Server Manager import), for the lead's harvest.

## Verification

`Shared surfaces:` every launcher test that constructs `LauncherProvider` and resolves (the inspection dep now gates resolve); `pinnedDefinitionsActivationFlow.test.ts`'s DW-749 test; the extension CHANGELOG's first section (read by `story-42-7-doc-claims.test.ts` and `story-44-6-doc-claims.test.ts`); the root CHANGELOG block order. Standing criterion: every test added or changed passes on a fresh environment, in either order.

**Commands** (each foreground, `timeout: 600000`):
- `pnpm --filter @iris-mcp/shared build && pnpm --filter @iris-mcp/dev build` -- the dists AC-3 spawns.
- `cd extensions/iris-mcp-launcher && npx vitest run src/__tests__/dw752LocalResolve.test.ts src/__tests__/serverDefinitionProvider.test.ts src/__tests__/pinnedDefinitionsActivationFlow.test.ts src/__tests__/containment.test.ts src/__tests__/dw749Characterization.test.ts` (loop) -- green, AC-3 not skipped.
- `cd extensions/iris-mcp-launcher && npx vitest run` and `npm run type-check` (once) -- green.
- `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-44-8-doc-claims.test.ts src/__tests__/story-44-6-doc-claims.test.ts src/__tests__/story-42-7-doc-claims.test.ts src/__tests__/story-42-1-qa-changeset-readers.test.ts` -- green.
- `pnpm gen:governance-baseline:check`, `pnpm gen:tools-list-snapshot:check`, `pnpm gen:ipm:check` (once each) -- unchanged.
- `git status --short` (end) -- only Code Map files, the new tests, the changeset.

**Planned mutations (Rule #19/#59; path guarded: `resolveEnvForLabel`, the Local resolve step, and the process it spawns; record the observed red next to each):**
- The resolve guard removed -> `dw752LocalResolve.test.ts` override rows and the AC-3 wire leg red (the listener receives the stored password), AC-4 red.
- `uninspectable` treated as `user` -> the inspection-failure rows red.
- The guard moved after `resolveCredentialsCoalesced` -> the "nothing called" assertions red.
- The guard applied per server inside the loop (after earlier servers resolve) -> the combined-plan row red (`getSession` called for `a`).
- The guard refuses every server -> AC-5's `LOCAL_ENV_CAPTURE` and prompts/cancellation pins red.
- `lookUpProvidedConnection` switched to treat `not-user` as user -> the DW-749 provide rows red (the shared helper serves both paths).
- The root CHANGELOG's Story 44.8 block deleted -> `story-44-8-doc-claims.test.ts` red.

**Manual checks:**
- Lead smoke (no IRIS needed): run `scratchpad/probe-44-8/probe-local-resolve.cjs` against the rebuilt launcher dist (`cd extensions/iris-mcp-launcher && npm run build`, output is gitignored): user-only resolves as before; both override cases return `undefined` with the `not-user` warning and no `getSession` call.

## Auto Run Result

Status: ready-for-dev
Blocking condition: none

Planning only (the dispatch said "Halt after planning."). Probe done (AC 44.8.1): Server Manager 3.16.0 keys a session and its stored password by server name and username only; VS Code 1.147.0 deep-merges `intersystems.servers` across layers; a probe of the built launcher dist reproduced the leak on the Local path (stored and inline passwords sent to a workspace-chosen host). DW-752 is real, so it is not closed with evidence. Chosen behaviour: the fail-safe warning, because every route into Server Manager's prompt uses or validates the stored password first (P-3). Notes for the lead: P-6 (the changeset names `@iris-mcp/shared`, since the extension cannot be named and follows the fixed group), P-7 (the AD-15/AD-9 spine entries are the lead's, Rule 20), and one out-of-footprint `deferred:` item (the shared Server Manager import). The working tree at dispatch held one uncommitted lead file (`cycle-log-epic-44.md`, a `ci_superseded` line appended after the spawn). It is outside this story's footprint and was left untouched. This run wrote only this spec file and scratchpad probe files.
