# IRIS MCP Launcher

A VS Code extension that registers the [IRIS MCP Server Suite](../../README.md) with VS Code's built-in
Model Context Protocol server registry, resolving IRIS connection credentials from the
[InterSystems Server Manager](https://marketplace.visualstudio.com/items?itemName=intersystems-community.servermanager)
extension at spawn time — **zero manual config, no password ever written to a file.**

> **Status: not yet published.** This extension is an optional, standalone deliverable of the IRIS MCP Server
> Suite (Epic 31, Story 31.4). It lives at `extensions/iris-mcp-launcher/` in the suite's repository, deliberately
> _outside_ the npm workspace (`pnpm-workspace.yaml` globs only `packages/*`) — nothing in `packages/**` depends on
> it, and it depends on nothing in `packages/**` at build time. It talks to the published `@iris-mcp/*` npm
> packages only at _runtime_, via `npx`. **Because no `@iris-mcp/*` package is published yet, `npx -y @iris-mcp/<pkg>`
> currently fails to start on every machine** — see [Development mode](#development-mode) below for the only way
> to run this extension against a real server before publication.

## What it does

1. On activation, it acquires the Server Manager extension's API (`extensionDependencies` guarantees Server
   Manager is installed alongside this extension).
2. It registers an MCP server definition provider (`vscode.lm.registerMcpServerDefinitionProvider`) that
   enumerates your Server Manager server roster (`api.getServerNames()`) and, per your settings, plans one MCP
   server definition per (suite package, Server Manager server) pair — e.g. "IRIS Dev Tools — myServer".
3. When Copilot (or another client that consumes VS Code's MCP registry — see
   [Client-coverage boundary](#client-coverage-boundary) below) actually starts one of those servers, this
   extension resolves the credentials for the underlying IRIS connection:
   - `api.getServerSpec(name)` — if the spec already carries a password, use it directly.
   - Otherwise: `api.getAccount(spec)`, then `vscode.authentication.getSession("intersystems-server-credentials",
[name, username], { silent: true, account })` (try the cached session first), falling back to
     `{ createIfNone: true, account }` (prompt the user).
   - The resolved password is `session.accessToken`. Username resolves through a fallback chain: the spec's own
     `username`, then `session.scopes[1]`, then `session.account.id`.
   - If the user declines the credential prompt, the server is reported as **not started**, with one clear
     message — never a repeated prompt, never an error toast storm.
4. It spawns `npx -y @iris-mcp/<pkg>` (or, in [Development mode](#development-mode), `node
   <developmentRepoPath>/packages/<dir>/dist/index.js`) with the resolved connection synthesized into the suite's
   own documented env contract (`IRIS_HOST`/`IRIS_PORT`/`IRIS_HTTPS`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE`
   for a single server, or `IRIS_PROFILES` JSON for several — see [`irisMcpLauncher.combineProfiles`](#settings)
   below), plus whatever governance/audit/visibility variables you've set in this extension's own settings,
   **passed through unchanged**. This extension is a launcher, not a policy authority.

Credentials exist **only** in the spawned process's environment. This extension never writes a password to VS
Code settings, `globalState`, `workspaceState`, or any log/output channel — see
[Credential handling](#credential-handling) below.

## Requirements

- VS Code 1.101 or later (the version that stabilized `contributes.mcpServerDefinitionProviders` — see the
  [May 2025 (v1.101) release notes](https://code.visualstudio.com/updates/v1_101)).
- The [InterSystems Server Manager](https://marketplace.visualstudio.com/items?itemName=intersystems-community.servermanager)
  extension (`extensionDependencies` installs it automatically when you install this extension from the
  Marketplace).
- At least one server defined in Server Manager (`intersystems.servers` in your VS Code settings, or added via
  Server Manager's own UI).
- A Copilot-family agent that consumes VS Code's MCP registry — see the next section.

## Client-coverage boundary

**This extension only helps Copilot-family agents (GitHub Copilot Chat and anything else that reads VS Code's
built-in MCP server list via `contributes.mcpServerDefinitionProviders`).**

**Claude Code does NOT consume this registry.** The Claude Code VS Code extension manages its own, separate MCP
server configuration — added via the CLI (`claude mcp add`) or the project's `.mcp.json` — independent of VS
Code's native MCP registry that this extension publishes into. Verified 2026-07-25 against the current Claude
Code documentation:

- [Use Claude Code in VS Code](https://code.claude.com/docs/en/vs-code) — the "VS Code extension vs. Claude Code
  CLI" comparison table lists MCP server config as "Partial (add servers via CLI; manage existing servers with
  `/mcp` in the chat panel)" for the extension, and the "Connect to external tools with MCP" section says
  explicitly: _"To add an MCP server, open the integrated terminal ... and run `claude mcp add`."_ Nothing on
  this page mentions consuming `contributes.mcpServerDefinitionProviders`-registered servers.
- [`anthropics/claude-code` issue #47344](https://github.com/anthropics/claude-code/issues/47344), "[FEATURE]
  Allow Claude Code VS Code extension to read MCP servers from VS Code's mcp.json" — a feature request **closed
  as not planned**, confirming this integration does not exist and is not on the roadmap. (Re-checked
  2026-07-25 via `gh issue view 47344 --repo anthropics/claude-code`: `state: CLOSED`,
  `stateReason: NOT_PLANNED`.)

**If you use Claude Code**, this extension has nothing for you — use the suite's other Epic 31 path instead:
[Server Manager connections](../../README.md#server-manager-connections-optional) (`IRIS_SERVER_MANAGER=auto`),
the credential chain (OS keychain / `IRIS_CREDENTIAL_HELPER` / `IRIS_PROFILES`), and the `iris-mcp-credentials`
CLI, all documented in the suite's root README.

## Development mode

`irisMcpLauncher.developmentRepoPath` (Story 31.6) makes this extension usable **before** any `@iris-mcp/*`
package is published: set it to the absolute path of a local monorepo checkout, and every registered definition
spawns `node <developmentRepoPath>/packages/<dir>/dist/index.js` instead of `npx -y @iris-mcp/<pkg>`. Empty
(the default) leaves spawning untouched — byte-identical `npx` behavior.

- **Development only, opt-in, and security-relevant.** This setting makes the extension execute an **arbitrary
  local file path** you configure — effectively arbitrary code execution scoped to whatever `dist/index.js` your
  checkout builds. It defaults to empty; only set it to a checkout you trust, on a machine where you trust every
  other user with write access to that path. There is no sandboxing beyond what the spawned Node process itself
  does.
- **Machine-scoped, so a repository cannot set it for you.** The setting is declared `"scope": "machine"`, which
  means it can only be set in your own **User/Machine** settings — a workspace's `.vscode/settings.json` (or a
  `.code-workspace` file) **cannot** set it. Without that scope, merely opening a cloned repository that shipped
  its own settings file plus a checked-in `dist/index.js` would hand this extension an attacker-chosen executable.
  Every other `irisMcpLauncher.*` setting is inert env pass-through or a server/package name; this is the only one
  that names something the extension executes, and it is the only one that is machine-scoped.
- **The path must be absolute.** A relative path is rejected with a warning, never resolved. The extension would
  resolve it against the extension host's working directory, but the spawned server resolves it against VS Code's
  MCP spawner working directory — so a relative path can validate against one file and then start a different one
  (or none). Absolute paths have no such ambiguity.
- **Until `@iris-mcp/*` is published to npm** (see the [status note](#iris-mcp-launcher) at the top of this file),
  this is the **only** way to start an IRIS MCP server through this extension — the default `npx -y @iris-mcp/<pkg>`
  path has no published package to resolve and fails to start on every machine.
- **Package-key -> directory mapping is explicit, not derived.** All five suite packages happen to follow the
  `iris-<key>-mcp` directory-naming pattern today — which is exactly what makes a derivation rule tempting. The
  counterexample is real and recent: the `all` meta-package's directory was `iris-mcp-all`, **not** the
  `iris-all-mcp` such a rule would produce, and it was removed in this same story for unrelated reasons — see
  [Removed: the `all` package key](#removed-the-all-package-key) below. `src/definitions.ts`'s `PACKAGE_DIR_NAME`
  is therefore an explicit map, and `src/__tests__/definitions.test.ts` cross-checks each entry against the
  directory's own `package.json` `name` on disk (not merely that the directory exists, which a transposed mapping
  would also satisfy).
- **Fails closed.** If `developmentRepoPath` is relative, does not exist, is not a directory, is not a checkout
  (no `packages/` inside), or a selected package's `dist/index.js` is missing (not yet built — run
  `pnpm --filter @iris-mcp/<pkg> build`), that package registers no definition and you get exactly one warning
  naming the offending path and the setting that produced it. A missing build for one package never suppresses
  the others.

### Removed: the `all` package key

`@iris-mcp/all` declared no `main`, `bin`, or `files` and shipped no `dist` — its own README states it "contains
no source code of its own". `npx` needs a `bin` to execute, so `npx -y @iris-mcp/all` could never start a server,
published or not, and local mode has no `dist/index.js` to target for it either. The `"all"` key has been removed
from `irisMcpLauncher.packages`'s allowed values (Story 31.6). If your settings still list it, you'll see one
warning naming the removal; select the five individual packages instead (`admin`, `data`, `dev`, `interop`,
`ops` — already this setting's default).

## Settings

All settings live under `irisMcpLauncher.*` (Settings UI: search "IRIS MCP Launcher").

| Setting                            | Default                                  | Description                                                                                                                                                                                                                                                                       |
| ---------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `irisMcpLauncher.servers`          | `[]` (all)                               | Server Manager server names to expose. Empty means every server Server Manager currently reports.                                                                                                                                                                                 |
| `irisMcpLauncher.packages`         | `["admin","data","dev","interop","ops"]` | Which `@iris-mcp` suite packages to register. (The `"all"` meta-package key was removed in Story 31.6 — `@iris-mcp/all` ships no `dist`/`bin` and could never be started; select the individual packages you need.)                                                              |
| `irisMcpLauncher.namespace`        | `"HSCUSTOM"`                             | Default `IRIS_NAMESPACE` for every spawned server (matches the suite's own `loadConfig()` default). Server Manager has no per-server namespace concept, so this is the one connection field this extension cannot read from Server Manager.                                       |
| `irisMcpLauncher.combineProfiles`  | `false`                                  | `false` (default): one definition per (package, server) pair, each single-profile. `true`: one definition **per package**, covering **every selected server** via the suite's multi-profile `IRIS_PROFILES` env var — address a specific server with the `server` tool parameter. |
| `irisMcpLauncher.developmentRepoPath` | `""` (unset)                          | **Development only, machine-scoped** (User/Machine settings only — a workspace cannot set it) — see [Development mode](#development-mode) above. **Absolute** path to a local monorepo checkout; spawns `node <path>/packages/<dir>/dist/index.js` instead of `npx -y @iris-mcp/<pkg>`.                                    |
| `irisMcpLauncher.governance`       | `""` (unset)                             | Passed through unchanged as `IRIS_GOVERNANCE`.                                                                                                                                                                                                                                    |
| `irisMcpLauncher.governancePreset` | `""` (unset)                             | Passed through unchanged as `IRIS_GOVERNANCE_PRESET`.                                                                                                                                                                                                                             |
| `irisMcpLauncher.auditLog`         | `""` (unset)                             | Passed through unchanged as `IRIS_AUDIT_LOG`.                                                                                                                                                                                                                                     |
| `irisMcpLauncher.auditLogMaxMb`    | `""` (unset)                             | Passed through unchanged as `IRIS_AUDIT_LOG_MAX_MB`.                                                                                                                                                                                                                              |
| `irisMcpLauncher.auditLogParams`   | `""` (unset)                             | Passed through unchanged as `IRIS_AUDIT_LOG_PARAMS`.                                                                                                                                                                                                                              |
| `irisMcpLauncher.toolsPreset`      | `""` (unset)                             | Passed through unchanged as `IRIS_TOOLS_PRESET`.                                                                                                                                                                                                                                  |
| `irisMcpLauncher.toolsDisable`     | `""` (unset)                             | Passed through unchanged as `IRIS_TOOLS_DISABLE`.                                                                                                                                                                                                                                 |
| `irisMcpLauncher.toolsEnable`      | `""` (unset)                             | Passed through unchanged as `IRIS_TOOLS_ENABLE`.                                                                                                                                                                                                                                  |

Every governance/audit/visibility setting defaults to `""` (unset) — with none configured, every spawned server
behaves exactly as it does when launched with none of those env vars set (today's default suite behavior). See
the [root README's environment variable table](../../README.md) for what each variable does.

**Known limitation — settings changes need a window reload.** The provider does not yet implement
`onDidChangeMcpServerDefinitions`, and it registers no `workspace.onDidChangeConfiguration` listener, so
changes to `irisMcpLauncher.*` (and servers added to or removed from Server Manager) take effect after
**Developer: Reload Window**. The extension's own messages say so where it matters.

**Known limitation — `webServer.pathPrefix`.** If a Server Manager server definition sets a non-root
`webServer.pathPrefix` (used by e.g. some HealthShare/IRIS for Health deployments), this extension surfaces a
one-time warning and connects **without** it: the suite's `IRIS_*` / `IRIS_PROFILES` environment-variable
connection contract has no path-prefix field today. Reload the window to try again after fixing the underlying
suite support, or connect to that server via the [Server Manager connections](../../README.md#server-manager-connections-optional)
path instead, which does support it.

## Credential handling

- Credentials resolved from Server Manager / `vscode.authentication` are handed to VS Code **only** as the
  `env` of the spawned `npx` child process, at the moment that server is started.
- This extension never calls a write API with a credential: no `context.globalState.update(...)`, no
  `context.workspaceState.update(...)`, no `vscode.workspace.getConfiguration(...).update(...)`, no
  `SecretStorage.store(...)`, and no log/output-channel write ever receives a resolved password or session
  token. Enforced by two regression tests in `src/__tests__/containment.test.ts`: a source-grep guard whose
  file roster is enumerated from disk (so a new source file cannot escape it), and behavioral tests that flow a
  distinctive secret through the real resolve path — including the error/cancel branches — and assert it never
  reaches a user-visible message.
- **Scope of that guarantee.** It covers what _this extension_ does. Once the resolved `env` is returned from
  `resolveMcpServerDefinition`, what the editor does with it is VS Code's behavior, not something this
  extension can constrain or that these tests verify. Note also that a child process's environment is readable
  by the user's own account on every platform (e.g. `/proc/<pid>/environ` on Linux) — that is inherent to the
  stdio-MCP env contract, not specific to this extension.
- **`combineProfiles` widens the blast radius.** With `combineProfiles: true`, one definition per package
  carries **every** selected server's credentials in `IRIS_PROFILES`, so each spawned `@iris-mcp/*` process
  holds passwords for servers you may only have wanted in a different one. The default (`false`) gives each
  process exactly one server's credentials. Prefer the default unless you specifically want cross-server
  addressing via the `server` tool parameter.
- **The launcher owns its variables.** `McpStdioServerDefinition.env` is _additive_ over the extension host's
  own environment, so every connection/governance variable this extension manages is emitted explicitly —
  including as `null` (VS Code's "remove this variable" signal) when a setting is unset. Without that, an
  ambient `IRIS_PROFILES` / `IRIS_GOVERNANCE` / `IRIS_SERVER_MANAGER` exported in your shell would silently
  leak into every spawned server. Variables the extension exposes no setting for (`IRIS_TIMEOUT`,
  `IRIS_SQL_MAX_ROWS`, `IRIS_SQL_TIMEOUT`) are deliberately left alone and still inherit.
- User cancellation of the credential prompt is a first-class, expected outcome: the server is reported as not
  started with one clear message. It is never retried automatically and never produces a toast storm. (The real
  `vscode.authentication.getSession({createIfNone:true})` signals cancellation by **rejecting**, not by
  resolving `undefined` — both shapes are handled; see `src/credentials.ts`.)

## Development

This extension is built and tested independently of the suite's root `turbo` pipeline (own `package.json`, own
`tsconfig.json`, own dev dependencies — `@types/vscode`, `typescript`, `vitest`, `@vscode/vsce`).

```bash
cd extensions/iris-mcp-launcher
npm install
npm run build        # tsc --project tsconfig.build.json -> dist/
npm run type-check    # tsc --noEmit (includes tests)
npm test              # vitest run
npm run package        # vsce package -> iris-mcp-launcher-<version>.vsix (not published anywhere by this command)
```

Every module except `src/extension.ts` (the activation entry point) is written with **no value-level dependency
on the `vscode` module**, so the pure planning/credential/env logic is unit-testable in a plain Node process by
injecting fakes shaped to the interfaces in `src/types.ts` — see `src/__tests__/`.

## Marketplace / Open VSX publish checklist (not yet actioned)

This extension has **not** been published anywhere. Publishing is a separate decision for the project lead. When
that decision is made:

- [ ] Choose and register a real `publisher` id (currently the placeholder `"TBD-at-publish-time"` in
      `package.json`) — a [Marketplace publisher](https://marketplace.visualstudio.com/manage) is required for
      both the VS Code Marketplace and (for parity) [Open VSX](https://open-vsx.org/).
- [ ] Add an icon (`"icon"` field in `package.json`, e.g. a 128x128 PNG) — the Marketplace listing looks bare
      without one.
- [x] `"repository"`, `"bugs"`, and `"homepage"` fields are already set in `package.json`, pointing at the
      suite's GitHub repo (`extensions/iris-mcp-launcher` subdirectory).
- [ ] Review/expand `categories` and `keywords` in `package.json` for Marketplace discoverability.
- [ ] Confirm `CHANGELOG.md` is current for the version being published.
- [ ] Confirm `.vscodeignore` excludes source/test/config files and includes only `dist/**/*.js` + `package.json` + `README.md` + `CHANGELOG.md` + `LICENSE` in the packaged VSIX (`npm run package` and inspect the "Files
      included in the VSIX" listing it prints).
- [ ] `npm run package` to produce the VSIX, then either `vsce publish` (needs a Personal Access Token) or upload
      the VSIX manually via the [Marketplace publisher management page](https://marketplace.visualstudio.com/manage).
- [ ] For Open VSX: `npx ovsx publish <file>.vsix -p <token>` (needs a separate Open VSX access token/namespace).
- [ ] Decide a release cadence relative to the `@iris-mcp/*` npm packages this extension spawns via `npx` — a
      version bump here is independent of theirs (this extension pins no version of the spawned packages; `npx -y`
      always resolves the latest published `@iris-mcp/<pkg>`).

## License

MIT — see [LICENSE](LICENSE).
