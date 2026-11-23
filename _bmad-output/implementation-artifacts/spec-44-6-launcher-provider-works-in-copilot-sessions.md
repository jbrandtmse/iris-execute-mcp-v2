---
title: 'Story 44.6: Launcher Provider Works in Copilot Sessions'
type: 'bugfix'
created: '2026-11-22'
status: 'blocked'
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

**Problem:** The IRIS MCP Launcher's `provideMcpServerDefinitions` returns every server with an empty `env`; the connection settings and the password are added only in `resolveMcpServerDefinition`, which the Copilot harness never runs. So in a Copilot-harness chat session (the default since VS Code 1.143, the only harness after February 2027) the launcher's servers start with no `IRIS_*` and fail at startup (DW-731).

**Approach (pending the owner's decision, see `## Auto Run Result`):** the provided definition carries the non-secret `IRIS_*` settings the resolver sets today plus a named, non-literal secret path; the resolver keeps running exactly as today under the Local harness. The probe found that no non-literal secret path for the server's `default` profile exists today, so the shape of the fix is an owner decision (Design Notes P-3).

## Boundaries & Constraints

**Always:**
- The provided definition carries only non-secret values: `IRIS_HOST`, `IRIS_PORT`, `IRIS_HTTPS`, `IRIS_USERNAME`, `IRIS_NAMESPACE` (and `IRIS_PROFILES` without any `password` member under `combineProfiles`), the governance pass-through variables (`buildGovernanceEnv`), and the variables of the chosen secret path. Every other launcher-owned variable is `null` (`withOwnedVarsCleared`, the env.ts allowlist).
- No literal secret in a provided definition unless the user takes the typed-confirmation opt-in of 44.2's `explicit` mode (AC 44.6.2).
- Under the Local harness `resolveMcpServerDefinition` still runs and returns exactly today's env, prompts and cancellation outcomes (AC 44.6.3), pinned with `toEqual` against a pre-story capture.
- `provideMcpServerDefinitions` never prompts and never calls `getSession({createIfNone:true})`: the `vscode.d.ts` contract says it is called eagerly and must not take actions that need user interaction.
- Every fake of a VS Code or Server Manager API returns a shape the real API can return (Rule #54).

**Never:**
- No publish (`npm`/`pnpm publish`, `changeset version`, `pnpm run version`, `vsce`, `ovsx`, IPM, `mcp-publisher`); no release vsix (a local `vsce package` only into the scratchpad, if at all).
- Never read or write the developer's real VS Code profile, `~/.copilot`, `~/.claude` or keychain; tests inject keychain/auth fakes and use a scratch `HOME`.
- No change to `packages/client-config` (Story 44.2's area) and no new client adapter.
- No new tool, tool action or governance key; `GOVERNANCE_BASELINE` stays `1e62c5ad5bf7`/141.
- No edit of the spine, `epics.md`, `deferred-work.md`, `sprint-status.yaml`, `.claude/rules/*`, `CLAUDE.md`, `irislib/`, `irissys/`.

</intent-contract>

## Code Map

- `extensions/iris-mcp-launcher/src/extension.ts:660-701` -- `registerMcpServerDefinitionProvider`: `provideMcpServerDefinitions` builds `new vscode.McpStdioServerDefinition(label, command, args, {})` with `cwd` = home; `resolveMcpServerDefinition` sets `server.env = env` from `resolveEnvForLabel` (full replacement, so a provided env never leaks into a Local start).
- `extensions/iris-mcp-launcher/src/serverDefinitionProvider.ts:256-344` -- `providePlannedDefinitions` (plans, no credentials); `:496-647` -- `resolveEnvForLabel`, the only credential path, which builds the env with `withOwnedVarsCleared({...synthesizeIrisEnv(profiles, ns), ...buildGovernanceEnv(settings)})` plus `ELECTRON_RUN_AS_NODE=1` for a local build. `PlannedDefinition` (`:43`) is the provide-time shape to extend.
- `extensions/iris-mcp-launcher/src/credentials.ts:68-195` -- `resolveServerCredentials`: source 1 is `spec.password` from `getServerSpec` (a password in `intersystems.servers` settings); source 2 is the Server Manager auth provider session (`intersystems-server-credentials`, `getSession` silent then `createIfNone`), whose password lives in VS Code SecretStorage. `deriveConnection` (`connection.ts`) gives host/port/https and needs no secret.
- `extensions/iris-mcp-launcher/src/env.ts:37-72` -- `synthesizeIrisEnv` (always emits `IRIS_PASSWORD`, and `password` in each `IRIS_PROFILES` member); `:92-101` `buildGovernanceEnv`; `:122-167` `LAUNCHER_OWNED_VARS` / `withOwnedVarsCleared` (the allowlist AC 44.6.2 keeps).
- `packages/shared/src/config.ts:162-176` -- `loadConfig` throws `IRIS_USERNAME ... is required` / `IRIS_PASSWORD ... is required`; it builds the `default` profile before any Server Manager import.
- `packages/shared/src/profiles.ts:554-648` -- `loadProfileRegistry`: `loadConfig(env)` first, then Server Manager import; a name already in the registry (always `default`) is filtered out before the credential chain runs.
- `packages/shared/src/credential-chain.ts` -- env -> OS keychain (service `iris-mcp`, account `<name>`, `@napi-rs/keyring` optional) -> `IRIS_CREDENTIAL_HELPER`; serves Server-Manager-imported profiles only. `packages/shared/src/server-manager-source.ts` -- reads `intersystems.servers` from settings files; its module doc records that Server Manager SecretStorage passwords are unreachable from any external process.
- `extensions/iris-mcp-launcher/src/__tests__/vscodeMock.ts:469-490` -- the `McpStdioServerDefinition` fake (readonly `label`, mutable `env`/`cwd`); `serverDefinitionProvider.test.ts`, `activationFlow.test.ts`, `pinnedDefinitionsActivationFlow.test.ts`, `envContract.test.ts` (round-trips the env through the real `packages/shared` oracle), `containment.test.ts` (secret-never-leaks guards) -- the suites a fix extends.
- `extensions/iris-mcp-launcher/README.md:147-149` (Copilot-harness paragraph and the "Known limitation"), `:354-386` (Credential handling); `extensions/iris-mcp-launcher/CHANGELOG.md` (`[Unreleased]`) -- the AC 44.6.4 docs.
- `docs/client-config/README.md:29-58`, root `README.md:155-190` -- the documented limitation the probe confirms: the six base variables are always required, and the keychain does not cover `IRIS_PASSWORD`.

## Tasks & Acceptance

Not planned: the story is blocked on the owner's decision (Design Notes P-3). After the decision the lead resets `status: draft` and re-dispatches; the re-plan builds on this Code Map and Design Notes.

## Spec Change Log

## Review Triage Log

## Design Notes

**P-1 Sources (AC 44.6.1; all read or fetched 2026-11-22).**
- VS Code 1.147.0, commit `8a14f0cc1b08d531eb83255ea3764ae22aa932b5` (2026-11-17), the installed bundle under `Contents/Resources/app/out/`: `vs/workbench/workbench.desktop.main.js` (WB), `vs/workbench/api/node/extensionHostProcess.js` (EH), `vs/platform/agentHost/node/agentHostMain.js` (AH), `main` process `mainImpl.js`, and the shipped `vscode-dts/vscode.d.ts` (its MCP stdio section equals the repo's `@types/vscode` 1.125.0).
- Docs: [API] code.visualstudio.com/api/extension-guides/ai/mcp; [CFG] code.visualstudio.com/docs/agents/reference/mcp-configuration (`#_editor-forwarding-to-copilot`); docs/agents/concepts/agent-host (nothing relevant).
- Repo: the launcher source (Code Map) and `packages/shared` (`config.ts`, `profiles.ts`, `credential-chain.ts`, `server-manager-source.ts`), plus one live probe of the built `packages/shared/dist/profiles.js` (scratch `HOME`, keychain and helper injected as fakes, no real keychain touched).
- No VS Code GUI was launched and no real profile was read. A Copilot-harness session needs a signed-in user, so the open rows are in P-6.

**P-2 What the Copilot harness gets from a provided definition** (re-derived; agrees with the 44.2 probe except where noted).
- **Fields.** `label` (the server key), `command`, `args`, `env` and `cwd` are forwarded. `version`, `id` and `metadata` are not. EH `ph.from` `{type:1,cwd:o.cwd?.fsPath,args,command,env:o.env,...}`; WB `PVn` `env:Object.keys(s.env).length>0?{...s.env}:void 0`.
- **`null` does not unset** (new). AH `DZe` drops null entries and stringifies numbers: `.filter(([,i])=>i!==null).map(([i,e])=>[i,String(e)])`. So `withOwnedVarsCleared` cannot clear an ambient variable under the Copilot harness; it does under Local (EH `startNodeMpc`: `c===null?void 0:String(c)`).
- **Any `${…}` blocks delivery** (new). WB `qls`/`OVn`: `${input:}`/`${command:}` -> `requiresUserInteraction`; any other `${…}` (`${env:X}`, `${HOME}`, `${secret:X}`), in a value or a key -> `unresolvedConfiguration`; either way the server is `notDelivered`. Nothing is resolved before forwarding. So the provided env must hold literals only, and `${IRIS_PASSWORD}` is not available.
- **Who spawns it.** The native `copilot-runtime` (`runtime.node`) spawns `{type:"stdio",command,args,tools:["*"],env,cwd}` (AH `ru`). The runtime's own env is the Agent Host's `process.env` (filtered), which is the main-process env merged with the resolved login-shell env (`mainImpl.js` `_resolveShellEnv`). Whether the runtime passes its env on to the child is inside the native binary (P-6 row 1).
- **The resolver never runs for forwarding**, interactively or not. WB registry start is the only `resolveServerLanch` call site: `let h=l.launch;if(!(c.resolveServerLanch&&(h=await c.resolveServerLanch(l),!h)))`. [API]: "Don't rely on an interactive resolver running during background forwarding to Copilot."
- **The provider cannot tell which harness asked.** EH calls `provideMcpServerDefinitions(CancellationToken.None)` and `resolveMcpServerDefinition(server, CancellationToken.None)`; no harness, agent or session field exists. Forwarding reads the registry's existing definitions (WB `xVn` `servers.get()` -> `readDefinitions()`), which can be the cached copy from before the extension activates (P-2 persistence); it never triggers a fresh `provide`.
- **No secret channel for a forwarded stdio server.** No harness-resolved input, no SecretStorage access from the Agent Host, and `auth` exists only on HTTP definitions (proposed API). The runtime's `${secret:…}` keychain store is unreachable because WB blocks any `${`. [CFG]: "Support for environment variables does not include `envFile`, input prompting, or a bridge to VS Code `SecretStorage`."
- **Provided definitions are persisted** (new). (1) WB stores every extension collection's provided definitions, env included, in workspace storage `mcp.extCachedServers` (`FW.toSerialized` returns the launch unchanged). (2) For forwarding, WB writes `{mcpServers:{<label>:<projected config>}}` to an in-memory `.mcp.json`, and AH copies it to `<userDataPath>/agentPlugins/<key>/<nonce>/.mcp.json`, keeping up to 8 nonces per plugin and 64 revisions in total. A literal secret in a provided definition is therefore written to several files and outlives a later change.

**P-3 Local harness (AC 44.6.3).** Resolve still runs on every Local start. EH `$resolveMcpLaunch` finds the latest provided object by label (`o.servers.find(a=>a.label===n)`) and passes it, env included, to `resolveMcpServerDefinition`; the returned launch replaces the provided one wholesale. The launcher assigns `server.env = env` (`extension.ts:700`), a full replacement, so Local's spawn env stays exactly today's whatever `provide` puts in `env`. A changed provided definition re-upserts the collection (extension collections are `Trusted`: no trust prompt; no restart prompt found, confidence medium); `version` (`cacheNonce`) only invalidates the tool cache. One new on-disk effect even on Local: the non-secret settings `provide` would carry (host, port, username, namespace) land in `mcp.extCachedServers`.

**P-4 The secret path per credential source (the blocking finding).** The server's `default` profile has no non-literal secret path today:
- `loadConfig` (`config.ts:162-176`) requires `IRIS_PASSWORD` in the process environment, and `loadProfileRegistry` builds `default` before any import. Live probe (`loadProfileRegistry` from `packages/shared/dist`, fake keychain returning a password): non-secret `IRIS_HOST/PORT/USERNAME/NAMESPACE/HTTPS` + `IRIS_SERVER_MANAGER=auto` + `IRIS_SM_SERVERS=dev1` -> throws `IRIS_PASSWORD environment variable is required`; `IRIS_SERVER_MANAGER=auto` alone -> throws `IRIS_USERNAME environment variable is required`.
- The OS keychain (service `iris-mcp`, account `<name>`, set by `iris-mcp-credentials set <name>`) and `IRIS_CREDENTIAL_HELPER` serve only Server-Manager-imported profiles; a `default` keychain entry has no effect (`docs/client-config/README.md` caveat 2, documented as verified; `profiles.ts` filters `default` out before the chain).

| Credential source the launcher supports today | Where the password is | Reachable by a Copilot-session server with no literal? |
|---|---|---|
| `spec.password` from `getServerSpec` (a `password` in `intersystems.servers.<name>` settings, deprecated) | the user's settings file, plaintext | Only for a Server-Manager-imported profile (`IRIS_SERVER_MANAGER=auto` reads the settings file itself and honours the inline password with a warning), never for `default` |
| The Server Manager auth session (`intersystems-server-credentials`, prompted or saved) | VS Code SecretStorage (Electron `safeStorage`, app-bound) | No. No external process can read it (`server-manager-source.ts` module doc; [CFG]). A copy the user stores with `iris-mcp-credentials set <name>`, or an `IRIS_CREDENTIAL_HELPER`, again serves only imported profiles |
| (any source) an `IRIS_PASSWORD` in the environment VS Code was started from | the login-shell or launch env | Unverified: depends on the runtime passing its env to the child (P-6 row 1); one password for every server; requires the provided env to leave `IRIS_PASSWORD` out (a `null` is dropped anyway, P-2) |

So AC 44.6.2's "the secret path from AC 44.6.1" names something that does not exist for `default` without a change outside the extension. The options, with observably different outcomes:
- **A (recommended).** Widen the story into `@iris-mcp/shared`: an opt-in (a new documented `IRIS_*` variable naming the Server Manager server, unset = byte-identical, AD-15 "Unused features") lets `default`, and each `IRIS_PROFILES` member under `combineProfiles`, take its password from the existing chain (keychain `iris-mcp`/`<name>`, then `IRIS_CREDENTIAL_HELPER`) when `IRIS_PASSWORD` / the member's `password` is absent. The provided definition carries the non-secret `IRIS_*` plus that variable; the user stores each password once with `iris-mcp-credentials set <name>` (or configures a helper). Costs: an AD-9 "Channels"/"Credentials" amendment and an AD-15 sanctioned change (a configuration that fails at startup today would start); the release must carry `@iris-mcp/shared` (the fixed group moves together anyway); `server-base.ts:2707` calls the synchronous `loadConfig()` before the async registry, so the change touches the startup path every server uses. A server-side rule keyed on an SM-only env could also fix the 44.2 observation in P-7, if the owner wants that.
- **B1. Literal behind the typed confirmation only, no server change.** Not recommended: VS Code persists the provided env (P-2) so the literal is written to workspace storage and up to 8 `agentPlugins` copies that outlive a revocation (AD-9 "no literal credential to a file without FR141's confirmation" would be met only formally), and the opt-in needs a surface while AC 44.6.3 freezes the settings, commands and status bar (a Local-resolve prompt would change Local's prompts).
- **B2. The inherited environment only.** Not recommended as the path: unverified (P-6 row 1), one password for all servers, and it gives up the env.ts clearing for `IRIS_PASSWORD`. Usable as a documented fallback under A.
- **C. A credential-helper bridge** (the extension answers an `IRIS_CREDENTIAL_HELPER` script from SecretStorage over local IPC). A new channel, security-sensitive, and it still needs A's server change for `default`. Not recommended.

**P-5 The env.ts allowlist under the Copilot harness.** Because AH drops `null` entries (P-2), the definition cannot clear an ambient `IRIS_PROFILES`, `IRIS_GOVERNANCE`, `IRIS_SERVER_MANAGER`, `MCP_TRANSPORT`, … in a Copilot session, whatever the extension does, if the runtime passes its env on (P-6 rows 1-2). AC 44.6.2's "the env allowlist still holds" therefore holds for Local only, unless the provided env overrides with an empty-string value wherever the server treats `""` as unset (each variable's empty-string semantics would need verifying). Owner question Q-B.

**P-6 Human-only rows (the owner's sitting; a signed-in Copilot user, VS Code >= 1.146, throwaway IRIS via `node scripts/throwaway-iris.mjs`, never shared data).**
1. Env passthrough: start VS Code from a shell with `FOO=1`; forward a server whose env omits `FOO` and that logs `process.env.FOO` to stderr; record whether the child sees it.
2. `null` keys: forward a definition with `"FOO": null` under the same shell; record whether the child sees `FOO`.
3. A literal `${X}` in env: confirm the server is listed as not delivered in the agent-host MCP list.
4. Cache before activation: open a fresh window, inspect `<userDataPath>/agentPlugins/*/.mcp.json` before the launcher activates, and record what it holds.
5. Record the `agentPlugins` path and how many copies remain after two env changes.
6. AC 44.6.5 (44.2 D-6 step 6): on the build carrying 44.2 and 44.6, enable the launcher's servers in a Copilot session; record connect and authenticate.

**P-7 Corrections and observations for the lead (Rule #42; the epic text is not edited here).**
1. AC 44.6.4 "A changeset bumps the extension package" cannot hold as worded: `pnpm-workspace.yaml` lists only `packages/*`, so changesets does not know the extension; its version follows the fixed `@iris-mcp/*` group through `pnpm run version` (AD-29 lockstep), and its CHANGELOG `[Unreleased]` entry names the change. An extension-only story needs a changeset on a fixed-group package for a release to move at all.
2. AC 44.6.2 vs AC 44.6.3: a literal opt-in needs a UI surface, and 44.6.3 freezes the settings, commands and status bar, and Local's prompts.
3. Out of this story's footprint (44.2's area, not touched): a client-config `server-manager` entry writes only `IRIS_SERVER_MANAGER=auto` + `IRIS_SM_SERVERS` (`synthesize.ts:145-150`), which fails at startup (`IRIS_USERNAME ... is required`, live probe above) unless the client's environment supplies the six base variables (documented caveat 1). So 44.2's D-6 step 2 "`--mode server-manager` ... expect `iris_server_info` to succeed" fails unless `IRIS_*` is exported, and the launcher README `:147` and `:264` ("use the `server-manager` mode (the OS keychain)") overstate it.

**P-8 Governing ADs (Rule 6).** AD-9 (credential channels; no literal credential to a file without FR141's confirmation; P-2 shows a provided definition IS written to files), AD-15 (Local byte-identical; any server change is a sanctioned change), AD-29 (lockstep vsix; no publish), AD-2 (the extension is never a server dependency; any server change lives in `@iris-mcp/shared`), AD-23 (stdio only, so `MCP_TRANSPORT` stays owned). Option A amends AD-9's Channels/Credentials bullets (Rule 20, the lead). No AC contradicts an AD's Rule as worded; B1 meets AD-9 only formally.

**P-9 Integration ACs / Consumes / Consumed-by (Rules 1-2) and extend-don't-copy.** Set at re-plan. Known now: consumers are the Copilot harness (human-only, P-6 row 6) and the Local harness (`activationFlow.test.ts` drives the real `extension.ts` against the faked editor); the provide-time env extends `resolveEnvForLabel`'s builder (`synthesizeIrisEnv` + `buildGovernanceEnv` + `withOwnedVarsCleared`) with a no-password variant, not a copy; under A the server-side default-profile lookup reuses `credential-chain.ts` `resolveCredential`.

**P-10 Ledger inbox (Rule 17).** DW-731 (`routed`, owner this story): addressed, not declined. This story owns it; it stays open until the owner's decision lets the fix be planned.

## Verification

Not planned (blocked before tasks). `Shared surfaces:` to be named at re-plan.

## Auto Run Result

Status: blocked
Blocking condition: intent gap

- Run: plan stage only (`Halt after planning.`), 2026-11-22. Epic context `epic-44-context.md` reused (valid, no newer planning file); previous `done` story 44.2 loaded for continuity. Tree was clean at the step-01 check; this spec is the only file written. Nothing implemented, committed or published.
- Why blocked: AC 44.6.2 requires the provided definition to carry "the secret path from AC 44.6.1", and the probe (Design Notes P-4) finds no non-literal secret path for the server's `default` profile: `loadConfig` requires `IRIS_PASSWORD` in the environment, and the keychain/helper chain serves only Server-Manager-imported profiles (live-probed). VS Code adds no secret channel for a forwarded server, blocks any `${…}` in its env, and persists a provided definition's env to disk (P-2). The fixes that remain lead to observably different products and need the owner (Rule 5, ask-first tier):
  - **Q-A (the secret path).** Choose A (recommended): extend `@iris-mcp/shared` so `default`, and each `IRIS_PROFILES` member, can take its password from the existing credential chain (keychain `iris-mcp`/`<server name>`, then `IRIS_CREDENTIAL_HELPER`) under a new opt-in variable naming the server; unset = byte-identical; the user stores each password once with `iris-mcp-credentials set <name>`; the release carries `@iris-mcp/shared`; AD-9 and AD-15 amendments (Rule 20). Or B1 (a literal only behind a typed confirmation; VS Code writes it to workspace storage and up to 8 `agentPlugins` copies, and the opt-in needs a surface AC 44.6.3 freezes), B2 (only the environment VS Code was started from; unverified, one password for all servers), or C (an IPC credential-helper bridge to SecretStorage; new channel, still needs A).
  - **Q-B (the env allowlist under Copilot).** The Agent Host drops `null` env entries, so the definition cannot clear ambient launcher-owned variables in a Copilot session (P-5). Accept that as a documented residual risk, or require empty-string overrides wherever the server treats `""` as unset (per-variable verification in the story)?
  - **Q-C (`combineProfiles`).** Must the Copilot path support `combineProfiles` (under A, per-profile chain resolution), or is `combineProfiles` documented as Local-only?
- Recommended amendments (for the lead, if A is chosen): AC 44.6.2 names the secret path as "the server resolves each named profile's password through its credential chain (OS keychain `iris-mcp`/`<server name>`, then `IRIS_CREDENTIAL_HELPER`) under `<new variable>`, added to `@iris-mcp/shared` as a sanctioned AD-15 change", and drops the literal opt-in for this story; AC 44.6.4's changeset names `@iris-mcp/shared` (P-7 item 1); AC 44.6.5's sitting adds the one-time `iris-mcp-credentials set <name>` step; the epic's release line adds `@iris-mcp/shared` as must-carry; the spine's AD-9 "Channels" and "Credentials" bullets gain the default/`IRIS_PROFILES` keychain path (Rule 20).
- Also for the lead: P-7 item 3, an observation in 44.2's area (client-config `server-manager` entries fail at startup without the six base variables, so D-6 step 2's expectation and the launcher README `:147`/`:264` overstate that mode). Not touched here.
- Ledger inbox: DW-731 addressed (P-10), stays open with this story.
- Re-dispatch: after the decision the lead amends `epics.md`, re-runs the epic-context pre-warm, sets this spec's `status: draft`, and re-dispatches; the re-plan keeps Design Notes P-1 to P-10 and the Code Map.
