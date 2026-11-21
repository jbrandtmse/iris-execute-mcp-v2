# Changelog

All notable changes to the IRIS MCP Launcher VS Code extension are documented in this file.

## [1.1.0] — 2026-11-21

### Changed

- **The extension is ready for the Visual Studio Marketplace and Open VSX, but not on them yet** (Story 42.7), as
  `iris-mcp.iris-mcp-launcher`: the publisher is `iris-mcp` (the Marketplace publisher id and the Open VSX namespace),
  `package.json` carries `"private": true` so that `npm publish` can never send it to npm, and the release workflow is the
  only way it is published. The release's Marketplace channel is off until the publisher is registered, and Open VSX is
  skipped until its namespace exists (DW-719), so 1.1.0 installs from the vsix attached to the `v1.1.0` GitHub Release.
- **The extension's version equals the shared `@iris-mcp/*` version** (Story 42.7, the lockstep policy): `pnpm run version` stamps the
  manifest and the lock and renames the `## [Unreleased]` heading of this file to `## [<version>] — <date>`, and the release
  refuses a manifest, a lock or a heading that is off the release version.
- **The clients and governance CLI spawns pass an explicit working directory** (Story 42.7, DW-663). The MCP Clients view runs
  the clients CLI in the first workspace folder, or in the user's home directory when no folder is open, so its project scope
  means "this workspace" however the editor was launched. The governance editor runs its CLI in the user's home directory,
  the directory the server definitions start in, so a relative `irisMcpLauncher.governanceFile` resolves the same way for both.
- **The launcher's whole test suite passes on macOS, Linux and Windows, and CI runs it on all three** (Story 42.7, DW-532): four
  tests no longer pin a `C:\` path that is not absolute on POSIX, and the clients-view activation test waits for a render that
  happens after its refresh instead of one that was already on screen.
- **Every `npx` spec the launcher spawns is pinned to the suite's major** (Story 42.1, DW-260): a server starts as
  `npx -y @iris-mcp/<pkg>@1`, the clients view as `npx -y -p @iris-mcp/client-config@1 iris-mcp-clients`, and the
  governance editor as `npx -y -p @iris-mcp/shared@1 iris-mcp-governance` (`universe` also installs each server as
  `-p @iris-mcp/<pkg>@1`), so a later major never reaches an installed launcher unasked. The major is a literal mirror of
  `IRIS_MCP_MAJOR` from `@iris-mcp/client-config`, pinned equal by a test in `@iris-mcp/all`. Every server definition
  the launcher provides also starts in the user's home directory (VS Code's own default, now explicit), and so do the
  CLI spawns (see the entry on the working directory above).
- **The launcher clears `MCP_TRANSPORT` in every server it starts** (Story 38.7, DW-539): `MCP_TRANSPORT` joins the
  launcher-owned variables, so a definition's `env` carries `MCP_TRANSPORT: null`, which removes the variable from the
  extension host's own environment. The launcher spawns only stdio servers, and a server refuses any other configured
  transport at startup, so an `MCP_TRANSPORT=http` exported in the shell that started the editor used to stop every
  spawned server before it answered `initialize`.
- **`irisMcpLauncher.namespace` now defaults to `USER`** (Story 38.0, DW-469): the extension's default
  `IRIS_NAMESPACE` moved from `HSCUSTOM` to `USER`, following `@iris-mcp/shared`'s `loadConfig()` default and
  every documented table (`USER` exists on every IRIS instance). Users who relied on the old default (for
  example on a HealthShare instance) set `irisMcpLauncher.namespace` explicitly.
- **Status bar zero-state now reports the effective count** (Story 32.4, aligned with the 31-5-2/31-6-4
  decisions): with `irisMcpLauncher.servers: []` — expose-ALL, the documented default — the status bar text
  shows the number of servers actually registered (e.g. `IRIS MCP: 3`) instead of `IRIS MCP: none`, which
  contradicted the expose-all semantics the picker teaches. The fresh-install guidance ("no servers selected
  yet… Click to choose specific servers") stays in the tooltip, and `none` is still shown when zero servers
  are registered or the count cannot be computed.
- Warning behavior hardening (Story 32.4): a mis-shaped Server Manager API now warns once per session (named
  as the version mismatch it is) instead of re-toasting on every refresh, and the generic "Server Manager is
  not available" warning is suppressed in that case so the cause is never misattributed; warnings for a fixed-
  then-reintroduced problem (a removed `"all"` package key, a `default`-named server) warn once per occurrence
  instead of once per session; the status bar refresh can no longer render a stale settings read over a newer
  one.

### Added

- **README: install + usage documentation** (2026-07-28 docs rollup): a step-by-step
  [Installing in development mode](README.md#installing-in-development-mode) section (build the VSIX,
  `code --install-extension`, the same-version reinstall and window-reload gotchas, and pointing
  `developmentRepoPath` at a checkout), a [Commands](README.md#commands) table covering all three commands, and
  usage guides for [Selecting servers](README.md#selecting-servers) and the
  [MCP Clients view](README.md#mcp-clients-view) (roster, matrix, apply/toggle/restore/doctor flow, the four
  env modes, secret discipline, and the managed-entry boundary).
- **MCP Clients view** (Story 33.3): a new command "IRIS MCP Launcher: Manage MCP Clients…" opens a webview
  for wiring the iris-mcp servers into any detected MCP client — no more hand-editing client config JSON.
  Detected clients render with user-selectable checkboxes (the roster persists across sessions in extension
  state; every detected client is selected by default); undetected v1 clients list collapsed with a
  "not detected" note. Per selected client: the iris-mcp
  server matrix (the five leaf servers — `iris-mcp-all` is unmanaged by design, since applying it alongside
  the five would double-register every tool) with enable/disable/remove actions, scope and env-mode
  pickers (modes are offered exactly as the CLI's host probes allow), and third-party entries listed
  read-only, names only. Every write flows diff preview → explicit confirm → the `iris-mcp-clients` CLI as a
  subprocess (the same single code path as the terminal CLI — the VSIX stays self-contained with zero runtime
  dependencies), resolved exactly like server spawning: `developmentRepoPath`'s built CLI first, else
  `npx -y -p @iris-mcp/client-config iris-mcp-clients`. The CLI subprocess runs with every `IRIS_*` variable
  scrubbed from its environment (credential containment; the one extension-owned re-add is
  `IRIS_GOVERNANCE_FILE` from `irisMcpLauncher.governanceFile`), the post-write restart hint is surfaced
  inline, and backup restore and `doctor` findings are reachable from the same view.
- **Governance editor** (Story 32.2): a new command "IRIS MCP Launcher: Open Governance Editor" opens a webview
  editor for the shared governance policy file (`IRIS_GOVERNANCE_FILE`). It shows the full governed-key universe
  — derived from the server packages' built dist, never a hand-maintained list — grouped per package with
  read/write and baseline/post-foundation badges, per-key effective values with `configSource` badges (the same
  render a running server's `iris_server_profiles` reports), per-profile tabs, tri-state toggles
  (enabled/disabled/inherit), a pending-changes + file-vs-default diff preview before save, and inline
  validation using the engine's own error text. Every read and write goes through the `iris-mcp-governance` CLI
  as a subprocess (never a bundled copy of `@iris-mcp/shared` — the VSIX stays self-contained with zero runtime
  dependencies), resolved exactly like server spawning: `developmentRepoPath`'s built CLI first, else
  `npx -y -p @iris-mcp/shared iris-mcp-governance`. The CLI subprocess runs with every `IRIS_*` variable scrubbed
  from its environment (credential containment), and the UI edits the governance FILE only — never client
  configs or env. Changes apply on next server start.
- New `irisMcpLauncher.governanceFile` setting (default `""` = unset): passed through unchanged as
  `IRIS_GOVERNANCE_FILE` to every spawned server AND used as the file the governance editor edits. Window scope
  (an inert JSON path, not an executable selector). Empty = no governance file; the editor shows an empty state
  with a Choose File… affordance.
- `irisMcpLauncher.developmentRepoPath` setting (Story 31.6): points the extension at a local monorepo checkout so
  it spawns `node <path>/packages/<dir>/dist/index.js` instead of `npx -y @iris-mcp/<pkg>` — the only way to run
  this extension against a real server before any `@iris-mcp/*` package is published. Empty (default) leaves
  spawning byte-identical to `npx` behavior. The path must be **absolute**; a relative one is rejected rather than
  resolved, because this extension and the spawned server resolve relative paths against different working
  directories. Fails closed on a relative/missing/invalid repo path, a directory that is not a checkout, or an
  unbuilt package: that package registers no definition and one aggregated warning names the offending path and
  setting; other selected packages still register. Because it names a path the extension **executes**, it is
  declared `"scope": "machine"` — settable only in your own User/Machine settings, never by a workspace's
  `.vscode/settings.json`.
- Status bar tooltip now surfaces a "Development mode" line when `developmentRepoPath` is set, so it's never
  ambiguous whether the extension is running local builds or published packages. The status bar `text`, count,
  and zero-state shape (pinned by Story 31.5) are unchanged.
- Initial MVP (Epic 31, Story 31.4): registers an `iris-mcp-launcher` MCP server definition provider that
  enumerates InterSystems Server Manager server definitions and plans one `npx -y @iris-mcp/<pkg>` MCP server
  definition per (suite package, Server Manager server) pair, or one per package covering every selected server
  via `IRIS_PROFILES` when `irisMcpLauncher.combineProfiles` is enabled.
- Credential resolution at spawn time via the verified Server Manager API + `vscode.authentication` pattern
  (`getServerSpec` -> `getAccount` -> `getSession({silent:true})` -> `getSession({createIfNone:true})`), with the
  spec-username -> `session.scopes[1]` -> `session.account.id` username fallback chain.
- User cancellation of the credential prompt is a first-class outcome: the server is reported as not started
  with one clear message. Both cancellation shapes are handled — the real
  `vscode.authentication.getSession({createIfNone:true})` signals a declined prompt by **rejecting**, not by
  resolving `undefined`. Server Manager API failures and hand-edited `intersystems.servers`/`irisMcpLauncher.*`
  settings likewise degrade to one clear message instead of a rejected provider promise.
- Launcher-owned environment variables are emitted explicitly, including as `null` when unset, so an ambient
  `IRIS_PROFILES`/`IRIS_GOVERNANCE`/`IRIS_SERVER_MANAGER` in the extension host's environment cannot leak into
  a spawned server (`McpStdioServerDefinition.env` is additive).
- `irisMcpLauncher.*` settings: `servers`, `packages`, `namespace`, `combineProfiles`, and pass-through
  governance/audit/visibility variables (`governance`, `governancePreset`, `auditLog`, `auditLogMaxMb`,
  `auditLogParams`, `toolsPreset`, `toolsDisable`, `toolsEnable`).

### Removed

- The `"all"` package key (`@iris-mcp/all`, the combined meta-package) is not a valid value for
  `irisMcpLauncher.packages` (removed in Story 31.6, before any release). `@iris-mcp/all` ships no
  `main`/`bin`/`files`/`dist` and could never be started via `npx` or a local build — it was a latent defect
  masked only by the suite's own non-publication. A settings.json that still lists `"all"` (in any casing) gets
  one warning naming the removal; any other selected packages still register normally.
  `irisMcpLauncher.packages`'s default (the five individual packages) is unaffected — it never included `"all"`.

### Known limitations

- `webServer.pathPrefix` on a Server Manager server definition is not representable in the suite's `IRIS_*` /
  `IRIS_PROFILES` env contract yet; the extension warns once per server and connects without it.
- Changes to `irisMcpLauncher.*` settings (and to the Server Manager server roster) require a window reload —
  `onDidChangeMcpServerDefinitions` is not implemented yet.
- Concurrent starts of several definitions covering the same Server Manager server are not coalesced, so a
  cold start with no cached session can surface more than one credential prompt for that server.
- AC 31.4.4's Copilot-chat smoke test (zero-manual-config tool listing, cancel-the-prompt path) requires a human
  in VS Code and has not yet been performed — see the story's Completion Notes for the exact remaining steps.
- The first store release is the first release after `1.0.0`, the release this section becomes; before it, the extension installed only from a `.vsix` built from the repository (the README keeps that route for development).
