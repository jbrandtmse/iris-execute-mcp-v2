# Changelog

All notable changes to the IRIS MCP Launcher VS Code extension are documented in this file.

## [0.1.0] — Unreleased (not yet published)

### Added

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
- Not yet published to the VS Code Marketplace or Open VSX — see the README's publish checklist.
