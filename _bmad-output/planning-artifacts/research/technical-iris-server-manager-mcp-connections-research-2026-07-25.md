---
stepsCompleted: [1, 2, 3, 4, 5, 6]
inputDocuments: []
workflowType: 'research'
lastStep: 6
research_type: 'technical'
research_topic: 'Using InterSystems Server Manager (VS Code) to manage IRIS connections for the iris-mcp server suite, alongside existing MCP-config-defined connections, with governance remaining in MCP configuration (and optional VS Code extension for governance management)'
research_goals: 'Determine how MCP servers can consume Server Manager-managed connection definitions and credentials instead of embedding them in MCP config; keep MCP-config connections as a supported option; keep governance in MCP config; evaluate a multi-agent-compatible VS Code extension for governance management; produce a full design and implementation plan'
user_name: 'Developer'
date: '2026-07-25'
web_research_enabled: true
source_verification: true
---

# Research Report: technical

**Date:** 2026-07-25
**Author:** Developer
**Research Type:** technical

---

## Research Overview

This research investigates how the iris-mcp server suite can source IRIS connections and credentials from the InterSystems Server Manager VS Code extension instead of embedding them in MCP client configuration, while keeping MCP-config-defined connections fully supported and keeping governance in MCP configuration. It combines verified web research (Server Manager API and source, VS Code SecretStorage internals, MCP client configuration and spec behavior) with live code review of two local codebases: the user's shipped Server Manager integration in `iris-table-editor` and this repo's connection/governance layer.

The decisive technical finding is that Server Manager splits its data: connection **definitions** are plain JSONC in VS Code settings (readable from any process), while **passwords** live in VS Code SecretStorage, which is cryptographically unreachable from outside VS Code. The design therefore pairs an in-VS-Code broker path (a `McpServerDefinitionProvider` extension injecting env vars — a pattern proven by gj::servAI) with a standalone path (settings-file reader + a credential chain of env → suite-owned OS keychain → external credential helper). Governance gains an agent-agnostic file substrate (`IRIS_GOVERNANCE_FILE`) with CLI and later VS Code UI editors, with enforcement unchanged inside the MCP servers.

Full findings, the feature designs, phased implementation plans, risks, and source documentation follow; see the Research Synthesis section for the executive summary and strategic recommendations. A same-day addendum (user-directed scope extension) adds **Feature 3: a Multi-Client MCP Configuration Manager** — a data-driven adapter registry over the verified config surfaces of 13 MCP clients (Claude Code, Claude Desktop, Cursor, VS Code/Copilot, Cline, Roo Code, Windsurf, Codex CLI, Gemini CLI, Zed, Goose, Kimi CLI, Kimi Code), with user-selectable clients and per-client/per-server enable-disable in the extension UI and a matching CLI.

---

<!-- Content will be appended sequentially through research workflow steps -->

## Technical Research Scope Confirmation

**Research Topic:** Using InterSystems Server Manager (VS Code) to manage IRIS connections for the iris-mcp server suite, alongside existing MCP-config-defined connections, with governance remaining in MCP configuration (and an optional VS Code extension for governance management)

**Research Goals:** Determine how MCP servers can consume Server Manager-managed connection definitions and credentials instead of embedding them in MCP config; keep MCP-config connections fully supported (strictly additive); keep governance in MCP config; evaluate a multi-agent-compatible VS Code extension for governance management; produce full designs and implementation plans.

**User Directives (from scope confirmation):**

- Explore BOTH runtime scenarios — MCP servers launched inside/alongside VS Code AND launched standalone (plain terminal, other agents) — with trade-offs; no pre-commitment to either.
- Deliver the design and implementation plan as TWO DISTINCT FEATURES: (1) Server Manager connection integration, (2) governance management surface. The user may choose to implement only feature (1).
- The Server Manager extension source code is available on GitHub (intersystems-community/intersystems-servermanager) — use it as a primary reference.
- Review the prior working integration in `../iris-table-editor` (design docs + code) as a local reference implementation.

**Technical Research Scope:**

- Architecture Analysis - Server Manager storage model (settings vs. SecretStorage), extension API surface, what is reachable from a standalone Node process vs. only the extension host
- Implementation Approaches - reference patterns from iris-table-editor and Server Manager source; MCP config layering in the iris-mcp suite
- Technology Stack - Server Manager extension API, VS Code SecretStorage/OS keychain, Node keychain access options, MCP configuration
- Integration Patterns - connection resolution order (MCP config + Server Manager), credential brokering, multi-agent compatibility for governance management
- Performance Considerations - credential caching, fallback behavior, security posture

**Research Methodology:**

- Current web data (Perplexity + InterSystems docs/community + GitHub source) with rigorous source verification
- Multi-source validation for critical technical claims
- Confidence level framework for uncertain information
- Live review of local reference code (iris-table-editor) and this repo's connection/governance layer

**Scope Confirmed:** 2026-07-25

## Technology Stack Analysis

### InterSystems Server Manager Extension (`intersystems-community.servermanager`)

The Server Manager extension is the community-standard connection registry for InterSystems tooling in VS Code. Its storage model splits cleanly into non-secret and secret halves:

_Server definitions (non-secret):_ stored in VS Code settings under the key `intersystems.servers` (User, Workspace, or Folder scope). Each entry has the shape:

```jsonc
"intersystems.servers": {
  "localIris": {
    "webServer": { "scheme": "http", "host": "localhost", "port": 52773, "pathPrefix": "" },
    "username": "_SYSTEM",
    "description": "Local IRIS dev"
  },
  "/default": "localIris"
}
```

_Passwords (secret):_ NOT stored in settings in v3+. Server Manager implements a VS Code `AuthenticationProvider` with id **`intersystems-server-credentials`** ("InterSystems Server Credentials" in the Accounts menu). Saved passwords go through VS Code SecretStorage into the OS-protected store. A legacy `password` property in `intersystems.servers` is still honored but deprecated.
_Source: https://openexchange.intersystems.com/package/Server-Manager-for-VS-Code-1 (Confidence: High)_
_Source: https://docs.intersystems.com/components/csp/docbook/DocBook.UI.Page.cls?KEY=GVSCO_serverprofile (Confidence: High)_
_Source: https://community.intersystems.com/post/how-refresh-user-credentials-used-vscode-intersystems-server-manager-extension (Confidence: High)_

_Extension API (exact surface, verified against `@intersystems-community/intersystems-servermanager@3.10.2` type definitions via the local iris-table-editor node_modules copy):_

```ts
export const EXTENSION_ID: string;
export const AUTHENTICATION_PROVIDER: string; // "intersystems-server-credentials"

export interface IServerName { name: string; description: string; detail: string; scope?: vscode.ConfigurationScope; }
export interface IWebServerSpec { scheme?: string; host: string; port: number; pathPrefix?: string; }
export interface ISuperServerSpec { host?: string; port: number; }
export interface IJSONServerSpec { webServer: IWebServerSpec; superServer?: ISuperServerSpec; username?: string; password?: string; description?: string; }
export interface IServerSpec extends IJSONServerSpec { name: string; }

export interface ServerManagerAPI {
    pickServer(scope?, options?: vscode.QuickPickOptions): Promise<string | undefined>;
    getServerNames(scope?, sorted?: boolean): IServerName[];
    getServerSummary(name: string, scope?): IServerName | undefined;
    getServerSpec(name: string, scope?, flushCredentialCache?: boolean,
                  options?: { hideFromRecents?: boolean, noCredentials?: boolean }): Promise<IServerSpec | undefined>;
    getAccount(serverSpec: IServerSpec): vscode.AuthenticationSessionAccountInformation | undefined;
    onDidChangePassword(): vscode.Event<string>;
}
```

The API is obtained via `vscode.extensions.getExtension<ServerManagerAPI>('intersystems-community.servermanager')` → `await extension.activate()` → `extension.exports`; the npm package supplies types/constants only. This is **only callable from inside a VS Code extension host** — it is not a network or CLI API.
_Source: https://github.com/intersystems-community/intersystems-servermanager (src/: authenticationProvider.ts, commonActivate.ts, makeRESTRequest.ts; types/index.d.ts) (Confidence: High — cross-verified against local working code)_

### VS Code SecretStorage / Credential Reachability (the load-bearing constraint)

**Verified finding: secrets stored via VS Code SecretStorage are NOT readable by an external process in any supported way.** Since VS Code ~1.80 replaced `keytar` with Electron `safeStorage`:

- The encryption key is an app-bound entry in the OS keychain (Windows: DPAPI-backed; macOS: "Code Safe Storage" Keychain item; Linux: libsecret/Secret Service).
- The encrypted secret values live as ciphertext rows in VS Code's SQLite state DB (`%APPDATA%\Code\User\globalStorage\state.vscdb` and workspace equivalents).
- There is no supported CLI or IPC surface for a non-VS-Code process to request a secret from a running VS Code instance.

Consequences for this design:
1. An MCP server launched by a non-VS-Code agent (plain-terminal Claude Code, Cursor CLI, etc.) **can read `intersystems.servers` definitions** (they are plain JSON in settings files on disk) but **cannot read Server-Manager-saved passwords**.
2. Any credential flow from Server Manager to an external MCP server process must be **brokered by code running inside VS Code** (an extension), or replaced by an alternative secret source (OS keychain entry the MCP server owns, env var, or prompt).
_Source: https://github.com/microsoft/vscode-discussions/discussions/748 (VS Code team description of safeStorage migration) (Confidence: High)_
_Source: https://www.electronjs.org/docs/latest/api/safe-storage (Confidence: High)_
_Source: https://code.visualstudio.com/api/references/vscode-api (SecretStorage) (Confidence: High)_

### Local Reference Implementation: iris-table-editor (`C:\git\iris-table-editor`)

A working, shipped integration exists in the user's own iris-table-editor project (`packages/vscode/src/providers/ServerConnectionManager.ts`). Its verified call sequence:

1. `vscode.extensions.getExtension<ServerManagerAPI>('intersystems-community.servermanager')` → activate → `extension.exports` (cached).
2. `api.getServerNames()` → `IServerName[]` → `.map(s => s.name)`.
3. `await api.getServerSpec(name)` → map `webServer.{scheme,host,port,pathPrefix}` (defaults: http / localhost / 52773 / `/api/atelier/`).
4. If spec lacks a password: `account = api.getAccount(smSpec)`; then `vscode.authentication.getSession(AUTHENTICATION_PROVIDER, [serverName, username], { silent: true, account })`, falling back to `{ createIfNone: true, account }` (prompts the user). **The password is `session.accessToken`**; username fallback chain: spec username → `session.scopes[1]` → `session.account.id`.
5. Build Basic auth header; test via GET on the Atelier root; queries via `POST …/v1/{NS}/action/query` (namespace `%` encoded as `%25`).

Operational learnings already encoded there: `extensionDependencies: ["intersystems-community.servermanager"]` guarantees co-install; user cancellation of the credential prompt must be handled as a first-class outcome; credentials are held in memory only and cleared on disconnect.
_Source: local code review, packages/vscode/src/providers/ServerConnectionManager.ts:61-201, packages/core/src/services/AtelierApiService.ts:296-303, _bmad-output/implementation-artifacts/1-3-server-manager-integration.md (Confidence: High — working shipped code)_

### Current iris-mcp Suite Connection & Governance Stack (this repo)

All configuration is env-var driven, supplied via the MCP client's `env` block — this is exactly where credentials are embedded in plaintext today:

- **Single connection:** `IRIS_HOST`, `IRIS_PORT`, `IRIS_USERNAME` (required), `IRIS_PASSWORD` (required), `IRIS_NAMESPACE`, `IRIS_HTTPS`, `IRIS_TIMEOUT` → parsed by `loadConfig(env)` (`packages/shared/src/config.ts:60-143`).
- **Multi-server:** `IRIS_PROFILES` (JSON map of profile-name → partial override; omitted fields inherit from `default`) → `buildProfileRegistry` (`packages/shared/src/profiles.ts:251-303`); per-profile isolated `IrisHttpClient` sessions via `ProfileClientRegistry` (`profiles.ts:370-426`).
- **Governance:** `IRIS_GOVERNANCE` (global + per-profile key→bool), `IRIS_GOVERNANCE_PRESET` (`read-only`|`full`), enforced at the single chokepoint `McpServerBase.dispatchToolCall` (`server-base.ts:1335-1387`); audit via `IRIS_AUDIT_LOG*` (Epic 29). Governance is orthogonal to connection sourcing — it keys on tool/action + profile *name*, not on how the profile was resolved.
- **Plug-in seams for an alternative connection source** (all parsers accept an injectable `env` map):
  1. `loadProfileRegistry(env)` (`profiles.ts:320-325`) — single startup entry producing the `ProfileRegistry`; called at `server-base.ts:1856`.
  2. `McpServerBaseOptions.config` injection (`server-base.ts:173`) — existing hook bypassing `loadConfig`.
  3. `ProfileClientRegistry.getOrCreate` — where credentials become a live client.
  4. Env-map injection into every parser — an alternative resolver can synthesize the env.
_Source: local code review via repo exploration (paths/lines cited inline) (Confidence: High)_

### Prior Art: gj :: servAI (credential bridge precedent)

George James Software's **gj :: servAI** extension is a direct precedent: a VS Code extension that (a) obtains credentials from the InterSystems Server Credentials authentication provider after user consent, and (b) supplies them to MCP servers it registers inside VS Code (currently one server, `intersystemsObjectscriptRoutine`, consumed by GitHub Copilot chat). It validates the "VS Code extension as credential broker for MCP" architecture, though it is Copilot/VS-Code-scoped rather than multi-agent.
_Source: https://openexchange.intersystems.com/package/gj-::-servAI (Confidence: High)_
_Source: https://github.com/gjsjohnmurray/gjServAI (Confidence: Medium — README does not document the exact credential-passing mechanism; to verify in integration-patterns step)_

### Technology Adoption Trends

- InterSystems' official VS Code docs now present Server Manager profiles + the credentials AuthenticationProvider as the canonical connection model for all InterSystems-related extensions (ObjectScript extension pack consumes the same profiles).
- The MCP ecosystem is converging on keeping secrets out of static client config: VS Code's native MCP support offers prompted `inputs` with secret storage; other clients still largely use plaintext `env` blocks — a gap this design can close for IRIS users.
- keytar is archived/deprecated ecosystem-wide; OS-keychain access from plain Node now typically uses maintained alternatives (e.g. `@napi-rs/keyring`) — relevant to any standalone-credential option.
_Source: https://docs.intersystems.com/components/csp/docbook/DocBook.UI.Page.cls?KEY=GVSCO_connect (Confidence: High)_
_Source: https://github.com/microsoft/vscode-discussions/discussions/748 (Confidence: High)_

## Integration Patterns Analysis

This section maps every viable channel by which Server-Manager-managed connections and credentials can reach an iris-mcp server process, per runtime scenario.

### Pattern A — VS Code Broker Extension via `McpServerDefinitionProvider` (the gjServAI pattern)

VS Code's extension API lets an extension programmatically contribute MCP servers: `vscode.lm.registerMcpServerDefinitionProvider(providerId, provider)` where the provider enumerates `McpServerDefinition`s and can implement lazy `resolveMcpServerDefinition` — credentials are fetched **at server start**, never written to any config file.

**Verified working precedent (gjServAI source):**
- `ServerDefinitionProvider implements vscode.McpServerDefinitionProvider`; enumerates targets and returns `McpStdioServerDefinition`s.
- Credential resolution (`utils.ts`): silent `vscode.authentication.getSession(serverManager.AUTHENTICATION_PROVIDER, [serverSpec.name, serverSpec.username || ""], { silent: true })`, falling back to `{ createIfNone: true }`; password = `session.accessToken`.
- Injection: `server.env = { IRIS_URL, IRIS_USERNAME, IRIS_PASSWORD, IRIS_NAMESPACE }` — plain env vars on the spawned stdio process.

**Direct significance for this project:** the iris-mcp suite ALREADY consumes `IRIS_HOST/IRIS_PORT/IRIS_USERNAME/IRIS_PASSWORD/IRIS_NAMESPACE/IRIS_HTTPS` (and `IRIS_PROFILES` for multi-server). A broker extension that resolves Server Manager specs and synthesizes exactly these env vars requires **zero changes to the MCP servers** for the single-profile case, and only env synthesis (`IRIS_PROFILES` JSON) for multi-profile. Governance env vars (`IRIS_GOVERNANCE`, `IRIS_GOVERNANCE_PRESET`, `IRIS_AUDIT_LOG*`) can be passed through unchanged from user settings.
_Source: https://github.com/gjsjohnmurray/gjServAI (src/serverDefinitionProvider.ts, src/utils.ts — code verified) (Confidence: High)_
_Source: https://code.visualstudio.com/api/extension-guides/ai/mcp (registerMcpServerDefinitionProvider) (Confidence: High)_

Limitation: `McpServerDefinitionProvider`-contributed servers are visible to MCP clients that consume VS Code's MCP registry — GitHub Copilot chat natively; other in-IDE agents vary. Claude Code (even its VS Code extension) manages its own MCP config and does NOT consume VS Code-contributed MCP definitions — so Pattern A alone does not cover Claude Code. (Confidence: High for Copilot; Medium for the evolving behavior of third-party agents.)

### Pattern B — VS Code native `mcp.json` `inputs` (no Server Manager, secrets out of config)

VS Code's own MCP config (`.vscode/mcp.json`) supports `inputs` with `type: "promptString", password: true`; values are prompted once at first server start, stored encrypted in VS Code secret storage, and substituted via `${input:id}` into `env`/`args`/`headers`. This keeps passwords out of committed config but (a) is VS-Code-only, (b) does not reuse Server Manager definitions, and (c) duplicates the connection registry.
_Source: https://code.visualstudio.com/docs/agents/reference/mcp-configuration (Confidence: High)_

### Pattern C — Client-side env expansion in MCP config (works today, all launch contexts)

Claude Code's `.mcp.json` supports shell-style `${VAR}` / `${VAR:-default}` expansion in `env` and `args`; Cursor supports `${env:VAR}` plus `envFile`. So users can already keep `IRIS_PASSWORD` out of the config file by referencing an OS environment variable. This is the lowest-common-denominator pattern: no Server Manager reuse, secret lives in the OS environment (shell profile, secrets-manager injection).
_Source: https://code.claude.com/docs/en/mcp (Confidence: High)_
_Source: https://forum.cursor.com/t/secure-secret-handing-for-mcps/155638 (Confidence: Medium — forum-documented)_

### Pattern D — Standalone (no VS Code): direct read of `intersystems.servers` + alternative credential source

A standalone MCP server process CAN read Server Manager **definitions** without VS Code: `intersystems.servers` is plain JSON in the user/workspace settings files (`%APPDATA%\Code\User\settings.json`, `.vscode/settings.json`, plus Insiders/VSCodium variants). It CANNOT read Server-Manager-saved passwords (SecretStorage, verified in Step 2). Credential completion options, in preference order:

1. **OS keychain entry owned by the iris-mcp suite** — a small CLI (e.g. `npx @iris-mcp/credentials set <serverName>`) stores the password in Windows Credential Manager / macOS Keychain / libsecret under a suite-owned service name (maintained Node bindings: `@napi-rs/keyring`; `keytar` is archived). The MCP server reads it at profile resolution.
2. **Env var fallback** — `IRIS_SM_PASSWORD_<NAME>` or the existing `IRIS_PROFILES` password field.
3. **NOT elicitation** — the MCP spec (2025-06+ elicitation feature) explicitly **MUST NOT** be used to request passwords/API keys/tokens via form elicitation; sensitive flows must go out-of-band. A server prompting for the IRIS password over MCP is spec-non-compliant and client support is inconsistent — ruled out.
_Source: https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation (Confidence: High)_
_Source: https://github.com/microsoft/vscode-discussions/discussions/748 (settings-vs-secrets split) (Confidence: High)_

### Pattern E — Credential-helper protocol (git/docker analogy)

A generalization of D: the MCP server shells out to a configurable credential helper command (`IRIS_CREDENTIAL_HELPER`) that prints the password for `<serverName>` — users can point it at any secret store (1Password CLI `op read`, `pass`, corporate vault CLI, or the suite's own keychain CLI). Proven model (git credential helpers, docker credential helpers); zero secret ever in config; composable with Pattern D's CLI as the default helper. (Confidence: High — established industry pattern.)

### Interoperability: how Server Manager sourcing composes with existing profiles & governance

- **Join key = profile name.** Server Manager server names become profile names in the existing `ProfileRegistry`. Governance (`IRIS_GOVERNANCE.profiles.<name>`) and audit logging key on profile names and are agnostic to how the profile was resolved — no governance changes required in any pattern.
- **Precedence contract (additive):** explicit `IRIS_PROFILES` / `IRIS_*` env config wins over Server-Manager-sourced definitions of the same name; Server Manager acts as an additional source, opt-in via a new env switch (e.g. `IRIS_SERVER_MANAGER=auto|off|required`). This preserves rule #19 back-compat: with the switch off/unset, behavior is byte-identical to today.
- **Session isolation** (`ProfileClientRegistry`, one client per profile) is source-agnostic and carries over unchanged.

### Integration Security Patterns

- **Env-var injection to child processes** (Patterns A/C): standard MCP practice; secrets exist only in the process environment of the spawned server, not on disk. Residual risk: environment of a process is readable by same-user processes on most OSes — equivalent to today's posture, strictly better than plaintext JSON on disk.
- **OS keychain** (Pattern D): per-user ACL protection at rest; strictly better than plaintext config; the store is suite-owned so no dependence on VS Code internals.
- **Password redaction discipline already in place:** `iris_server_profiles` roster allow-list omits passwords; audit logger redacts `password|secret|token|...` keys — both apply unchanged to Server-Manager-sourced profiles.
_Source: https://owasp.org/www-project-mcp-top-10/2025/MCP01-2025-Token-Mismanagement-and-Secret-Exposure (Confidence: High)_

## Architectural Patterns and Design

### System Architecture Options — Feature 1: Server Manager Connection Integration

Four candidate architectures, composable rather than mutually exclusive:

**Option 1A — Broker extension (spawn-side injection).** A new VS Code extension registers a `McpServerDefinitionProvider`; at server start it resolves Server Manager specs + credentials (`getSession`, password = `session.accessToken`) and spawns the iris-mcp servers with synthesized `IRIS_*`/`IRIS_PROFILES` env. Zero MCP-server changes; full SecretStorage security; **but** only reaches clients that consume VS Code's MCP registry (Copilot chat today — Claude Code manages its own MCP config and does not).
- Trade-offs: best security & UX inside VS Code+Copilot; no coverage for Claude Code/Cursor/standalone.
- Precedent: gjServAI (verified). _Source: https://github.com/gjsjohnmurray/gjServAI (Confidence: High)_

**Option 1B — In-server settings reader (definitions without VS Code).** The shared package gains a resolver that reads `intersystems.servers` directly from VS Code settings JSON files on disk (user + workspace scopes, Code/Insiders/VSCodium paths) and merges them into the `ProfileRegistry` as profiles. Credentials are completed via a **credential chain** (below). Works in every launch context including plain terminals; requires JSONC-tolerant parsing (VS Code settings allow comments/trailing commas) and documented precedence.
- Trade-offs: broadest coverage; passwords need a non-SecretStorage source; definitions-read is read-only and safe.

**Option 1C — Suite-owned credential store + helper chain.** Complete Option 1B's credential gap with an ordered chain per profile: (1) explicit env (`IRIS_PROFILES` password / `IRIS_PASSWORD`), (2) suite-owned OS keychain entry (via `@napi-rs/keyring`; written by a small `iris-mcp-credentials` CLI), (3) configurable external credential helper command (`IRIS_CREDENTIAL_HELPER`, git-credential-style), (4) fail-fast with an actionable error naming the remediation commands.
- Trade-offs: one-time per-machine password setup outside VS Code; industry-proven pattern; keeps secrets out of all config files.

**Option 1D — Live credential broker (ssh-agent style).** The broker extension additionally listens on a localhost port/named pipe with a per-session token; standalone MCP servers request credentials from the running VS Code. Maximum reuse of SecretStorage, but adds a live IPC secret-disclosure surface, requires VS Code running, and needs careful authentication of callers.
- Trade-offs: highest complexity and security surface; **deferred** unless 1C proves insufficient. (Confidence: High that this is the correct risk posture — OWASP MCP guidance counsels against new secret-disclosure channels.)

**Recommended composite:** Layered profile resolution in `@iris-mcp/shared` — `explicit env config` ⟶ wins over ⟶ `Server Manager definitions (1B)` + `credential chain (1C)`; Option 1A shipped as the polished in-VS-Code path that needs no per-machine setup. This covers both runtime scenarios with one mental model and no breaking change.

### Design Principles Applied

- **Strictly additive (project rule #19 / memory: live users):** new behavior only behind `IRIS_SERVER_MANAGER` (e.g. `off`|`auto`|`required`, default `off` initially); with it unset, profile resolution is byte-identical to today. Mechanical back-compat proof: existing profile tests re-run under empty/default config.
- **Single chokepoint preserved:** resolution feeds the existing `ProfileRegistry`; governance (`dispatchToolCall` gate), audit, and session isolation remain untouched (join key = profile name).
- **Fail-fast with named remediation** (matches existing `loadConfig` style): missing credential for a Server-Manager-sourced profile produces an error naming the exact CLI/env fix.
- **Secret-free config artifacts:** no design writes a password to any file; allow-list redaction (`iris_server_profiles`) extended to new fields like `source: "env" | "server-manager"`.

### System Architecture Options — Feature 2: Governance Management Surface

Governance **enforcement** stays in the MCP servers (env-supplied config). The feature is a management/authoring surface. Candidates:

**Option 2A — Shared governance file + `IRIS_GOVERNANCE_FILE`.** Add an env var pointing at a JSON file; servers load governance from it (explicit `IRIS_GOVERNANCE` env still wins). Every MCP client — regardless of config format (JSON `.mcp.json`, Cursor JSON, Codex TOML) — can pass a static file path string, making this the **only fully agent-agnostic substrate**. Optional watch/reload can be deferred (MCP servers restart cheaply).
- Key insight: client config formats and env-expansion syntaxes are heterogeneous and partly undocumented; a file path is the lowest common denominator. _Source: https://deepwiki.com/openai/codex/7.1-mcp-server-configuration (Codex TOML env tables) (Confidence: High); per-client path claims (Confidence: Medium — verify per client during implementation)_

**Option 2B — VS Code governance editor extension (UI over 2A).** A webview/tree UI (in the same broker extension as Feature 1 or standalone) that reads/writes the governance file: per-tool/per-action toggles, preset selection, per-profile overrides, diff-vs-defaults view, validation against the same key universe (`rebuildGovernedKeys` semantics). Multi-agent by construction because it edits the file, not any agent's config.

**Option 2C — CLI editor (`iris-mcp-governance`).** Non-UI alternative/complement: validate, set/unset keys, apply presets, print effective policy. Cheap, scriptable, CI-friendly; shares the validation logic with 2B via the shared package.

**Recommended composite:** 2A is the enabling substrate (small, additive server change); 2C ships with it (low cost, universal); 2B is the polished UI layer, buildable later without rework. This decouples "governance manageable across many agents" from "VS Code extension exists".

### Scalability, Performance, and Operational Patterns

- **Startup-time resolution, per-call none:** Server Manager definitions and credentials resolve once at `start()` (matching today's eager default client); no per-tool-call overhead. Keychain reads are O(profiles) at startup (~ms each).
- **Staleness model:** settings/keychain changes require server restart — identical to today's env-var model; documented. File-watch hot-reload for the governance file is an explicit non-goal in v1 (restart semantics stay uniform and auditable).
- **Failure containment:** an unresolvable Server-Manager profile fails only that profile (with `required` escalating to fail-fast at startup), mirroring existing per-profile validation.

### Security Architecture Patterns

- Definitions (non-secret) travel via files/env; secrets travel via OS keychain, VS Code SecretStorage (in-broker), or process env at spawn — never via MCP messages (elicitation for secrets is spec-forbidden) and never written to disk by this suite.
- The suite-owned keychain namespace (`iris-mcp/<serverName>`) is deliberately **parallel to**, not a raider of, VS Code's store: no dependence on VS Code internals (safeStorage extraction is unsupported and brittle — ruled out).
- Audit entries gain `profileSource` attribution so operators can see which credential path authenticated each session. Existing redaction key-pattern applies unchanged.
_Source: https://owasp.org/www-project-mcp-top-10/2025/MCP01-2025-Token-Mismanagement-and-Secret-Exposure (Confidence: High)_

### Data Architecture — Precedence and Merge Model

```
ProfileRegistry construction order (highest wins):
1. IRIS_* single-connection env  → profile "default"           (unchanged)
2. IRIS_PROFILES JSON            → named profiles               (unchanged)
3. [new] Server Manager definitions (if IRIS_SERVER_MANAGER≠off)
     name collision with 1/2  → env definition wins (log notice)
     credential completion    → chain: profile password → keychain → helper → fail
Governance config order (highest wins):            (per existing cascade)
1. IRIS_GOVERNANCE env (explicit)                   (unchanged)
2. [new] IRIS_GOVERNANCE_FILE contents
3. IRIS_GOVERNANCE_PRESET seed → defaults           (unchanged)
```
`/default` marker in `intersystems.servers` maps to nothing (the suite's `default` profile remains env-defined); Server Manager's `superServer` block is ignored (the suite is web-server/Atelier-only today).

### Deployment and Operations Architecture

- Feature 1 core ships in `@iris-mcp/shared` (all 5 servers inherit); the broker/governance extension is a separate deliverable (VS Code Marketplace / Open Exchange) with `extensionDependencies: ["intersystems-community.servermanager"]`.
- The extension is optional in every scenario: nothing in the npm packages imports `vscode`.
- Docs per rule #30/#43: new env vars (`IRIS_SERVER_MANAGER`, `IRIS_CREDENTIAL_HELPER`, `IRIS_GOVERNANCE_FILE`), default states, and per-client setup recipes land with the stories that introduce them.

## Implementation Approaches and Technology Adoption

The user directed that the deliverable be **two distinct features** so Feature 1 can ship alone. Both designs below honor that: Feature 2 has no dependency on Feature 1 (and vice versa); they share only the optional VS Code extension as a common eventual home.

### Feature 1 Design — Server Manager Connection Integration

**F1-D1: New shared module `packages/shared/src/server-manager-source.ts`.**
- `discoverSettingsFiles(env, platform)`: enumerate candidate settings files in precedence order — workspace `.vscode/settings.json` (from CWD or `IRIS_SM_WORKSPACE` override), then user settings for each product variant. Verified user-settings paths: Windows `%APPDATA%\{Code, Code - Insiders, VSCodium, Cursor}\User\settings.json`; macOS `~/Library/Application Support/<Product>/User/settings.json`; Linux `~/.config/<Product>/User/settings.json`.
- `parseIntersystemsServers(text)`: parse with Microsoft's `jsonc-parser` (settings files are JSONC — comments + trailing commas legal); extract `intersystems.servers`; skip the `/default` marker key and any key starting with `/`; map `webServer.{scheme,host,port,pathPrefix}` + `username` (+ honor legacy inline `password` if present, flagged deprecated in logs) into `ProfileOverride` shape. `superServer` ignored (suite is Atelier/web-server only).
- `resolveServerManagerProfiles(env)`: apply `IRIS_SERVER_MANAGER` mode — `off` (default, v1) / `auto` (merge, env wins on name collision, log notice) / `required` (fail-fast if zero definitions found). Optional `IRIS_SM_SERVERS` allow-list (comma-separated names) to avoid importing a user's entire server roster.
_Source: https://www.npmjs.com/package/jsonc-parser (Confidence: High)_

**F1-D2: Credential chain in profile materialization.** For each Server-Manager-sourced profile lacking a password, resolve in order:
1. `IRIS_PROFILES.<name>.password` / (for the mapped default) `IRIS_PASSWORD` — explicit env always wins.
2. Suite-owned OS keychain: service `iris-mcp`, account `<serverName>` (or `<serverName>/<username>`), read via `@napi-rs/keyring` (maintained Rust `keyring-rs` bindings; keytar successor). Ship as **optional dependency** with graceful degradation (chain skips the keychain link if the native module is unavailable, e.g. some CI/containers).
3. External helper: `IRIS_CREDENTIAL_HELPER` command executed with the server name as arg; stdout (trimmed) = password; non-zero exit = skip. Enables 1Password `op read`, `pass`, corporate vaults.
4. Fail: profile is excluded with a startup log naming the exact remediations (`iris-mcp-credentials set <name>`, or set `IRIS_CREDENTIAL_HELPER`, or add password to `IRIS_PROFILES`); `required` mode escalates to fail-fast.
_Source: https://github.com/Brooooooklyn/keyring-node (@napi-rs/keyring) (Confidence: High)_

**F1-D3: Integration seam.** Extend `loadProfileRegistry(env)` (`profiles.ts:320-325`) — after existing default + `IRIS_PROFILES` merge, call `resolveServerManagerProfiles(env)` and merge non-colliding profiles via the existing `mergeProfile` validation. `ProfileRegistry` entries gain `source: "env" | "server-manager"`; `iris_server_profiles` roster adds `source` to its **allow-list** (never spread) so agents can see provenance. Governance/audit unchanged (join key = profile name); audit entry gains optional `profileSource`.

**F1-D4: Companion CLI `@iris-mcp/credentials` (small, new package or a bin in shared).** Commands: `set <serverName>` (hidden prompt → keychain), `delete <serverName>`, `list` (names only), `test <serverName>` (resolve chain + attempt Atelier HEAD — never prints the secret). This is the one-time per-machine setup for standalone use.

**F1-D5: Broker VS Code extension (optional deliverable `iris-mcp-launcher`).** Registers a `McpServerDefinitionProvider` (gjServAI pattern, iris-table-editor call sequence): enumerate `api.getServerNames()` → user-selected subset (extension setting `irisMcp.servers` + which of the 5 suite servers to expose) → on `resolveMcpServerDefinition`, `getServerSpec` + `getSession(AUTHENTICATION_PROVIDER, [name, username], {silent} → {createIfNone})` → spawn `npx -y @iris-mcp/<pkg>` with env `IRIS_HOST/PORT/HTTPS/USERNAME/PASSWORD/NAMESPACE` (single) or synthesized `IRIS_PROFILES` (multi) + pass-through governance/audit env from extension settings. `extensionDependencies: ["intersystems-community.servermanager"]`. Handles cancellation (user declines credential prompt → definition unresolved, clear message). Covers Copilot-family clients with zero npm-package changes; Claude Code users use F1-D1..D4 instead.

**Back-compat proof (rule #19):** with `IRIS_SERVER_MANAGER` unset, `loadProfileRegistry` output is `toEqual`-identical to today for the full existing test matrix; new code paths are dead. Mechanical assertion added to the profile test suite.

### Feature 1 Implementation Plan (independent epic, ~5 stories)

1. **Story 1 — Settings discovery + JSONC parsing + profile mapping** (`server-manager-source.ts`, `IRIS_SERVER_MANAGER=off|auto|required`, `IRIS_SM_SERVERS`; unit tests over fixture settings files incl. comments, trailing commas, `/default`, collisions; back-compat `toEqual` proof). Seam documented for Story 2 (rule #52).
2. **Story 2 — Credential chain + keychain + helper** (`@napi-rs/keyring` optional-dep pattern, `IRIS_CREDENTIAL_HELPER`, fail-fast messaging; unit tests with injected fake keychain/helper; live smoke on Windows Credential Manager).
3. **Story 3 — CLI `iris-mcp-credentials`** (set/delete/list/test; smoke per rule #22 on built dist in fresh Node process).
4. **Story 4 — Registry integration + provenance** (merge into `loadProfileRegistry`, `source` field through allow-list, audit `profileSource`; capstone: live end-to-end — define server in real `.vscode/settings.json`, store password via CLI, launch `iris-dev-mcp` with `IRIS_SERVER_MANAGER=auto` and no `IRIS_PASSWORD`, call `iris_server_info` against local IRIS (rule #21 genuine gate). Docs: README env-var rows + client-config guides.
5. **Story 5 — Broker extension MVP** (separate repo/package; `McpServerDefinitionProvider` + settings UI for server/tool-package selection; manual smoke with Copilot; Marketplace/Open Exchange publish checklist). May trail 1–4; nothing depends on it.

### Feature 2 Design — Governance Management Surface

**F2-D1: `IRIS_GOVERNANCE_FILE` (shared package, small additive change).** New env var: path to a JSON file parsed with the **same** `parseGovernanceConfig` validation (fail-fast naming file + var). Cascade per key: explicit `IRIS_GOVERNANCE` env > file > preset seed > defaults — implemented by merging file config under env config before the existing `effective()` cascade; `iris_server_profiles` governance view reports `configSource` per layer. Also honor `IRIS_GOVERNANCE_PRESET` unchanged. Rationale: a static file path is the only fully agent-agnostic contract (JSON configs, TOML configs, and no-expansion clients can all pass it). No hot-reload in v1 (restart semantics, documented).

**F2-D2: CLI `iris-mcp-governance`.** Operates on the file: `validate`, `get/set/unset <key> [--profile <name>]`, `preset read-only|full`, `effective [--profile]` (renders the same cascade the servers compute, reusing shared functions — single-sourced per rule #45 spirit), `diff` (file vs defaults). Ships with F2-D1; scriptable and CI-friendly.

**F2-D3: VS Code governance editor (UI layer, later).** Lives in the same `iris-mcp-launcher` extension: tree/webview listing the governed key universe (derived from the published packages' tool metadata — reusing `deriveKeysForTool`-equivalent exports from dist, as `iris-mcp-all` tests do), toggles writing the governance file, preset picker, per-profile tabs, "effective policy" preview, validation errors inline. Because it edits the file, every agent (Claude Code, Cursor, Codex, Copilot) picks the policy up on next server start — multi-agent by construction. Non-VS-Code users get identical capability via F2-D2.

**Explicitly rejected for governance:** per-agent config writers (fragile across heterogeneous, partly-undocumented client formats) and any governance channel outside MCP-config/env+file (governance must remain enforceable by the servers themselves; a UI is management, never enforcement).

### Feature 2 Implementation Plan (independent epic, ~3 stories)

1. **Story 1 — `IRIS_GOVERNANCE_FILE`** (loader + cascade merge + `configSource` attribution; unit tests incl. env-overrides-file, malformed-file fail-fast, empty-config all-preserved sweep per rule #19; docs rows).
2. **Story 2 — CLI `iris-mcp-governance`** (single-sourced validation/effective logic from shared; dist smoke; docs with recipes for Claude Code/Cursor/Codex config snippets passing the file path).
3. **Story 3 — Extension governance UI** (in `iris-mcp-launcher`; webview editor + effective-policy preview; manual smoke: toggle a write tool off in UI → restart server under Claude Code → `iris_server_profiles` shows disabled → call refused with `GOVERNANCE_DISABLED`).

### Testing and Quality Assurance

- Unit: fixture settings files (JSONC edge cases), fake keychain/helper injection, cascade matrices (env×file×preset), collision handling.
- Live capstones (rule #21/#49-style genuine gates): Feature 1 Story 4 end-to-end above; Feature 2 Story 3 governance round-trip (toggle → enforce → refusal observed over MCP).
- Second-environment discipline (rule #34): run the Feature 1 capstone against a second settings scope (workspace overriding user) and a second product dir (Cursor path) to prove discovery order.
- Windows-first validation (user's environment), with CI coverage for path logic on all three platforms via injected `platform`/`env`.

### Risk Assessment and Mitigation

| Risk | Likelihood | Mitigation |
|---|---|---|
| VS Code `McpServerDefinitionProvider` API surface shifts (newer `vscode.lm` area) | Medium | Extension pins `engines.vscode`; core npm value (F1-D1..D4) is independent of it |
| `@napi-rs/keyring` unavailable on some hosts (musl/ARM/CI) | Medium | Optional-dep + chain skip + helper fallback; never a hard startup dependency |
| Settings file location drift across forks (Cursor et al.) | Low-Med | Path list is data-driven + `IRIS_SM_SETTINGS_PATHS` escape-hatch env var |
| Users expect Server-Manager *passwords* to "just work" standalone | High (expectation) | Docs state the SecretStorage boundary plainly; CLI `test` command gives instant diagnosis; broker extension covers the zero-setup case in VS Code |
| Governance file edited to invalid state | Medium | Same fail-fast validator as env; CLI `validate`; servers refuse to start on malformed file (never silently permissive) |
| Legacy inline `password` in `intersystems.servers` | Low | Honored but logged as deprecated; never re-written by our tooling |

### Technology Stack Recommendations (net-new dependencies)

- `jsonc-parser` (Microsoft) — JSONC settings parsing. `@napi-rs/keyring` (optionalDependency) — OS keychain. No other runtime additions to the npm packages. Extension: standard VS Code extension toolchain + `@intersystems-community/intersystems-servermanager` (types) + `extensionDependencies` on Server Manager — mirroring iris-table-editor's proven setup.

### Skill Development Requirements

- Team already owns every needed skill except VS Code extension publishing (Marketplace + Open Exchange) — covered by iris-table-editor experience; npm publish flow already documented as a pending user need (first publish checklist).

### Success Metrics and KPIs

- **F1:** a fresh machine goes from "Server Manager profile exists" to "Claude Code calling `iris_server_info`" with zero secrets in any config file, in ≤2 commands (`iris-mcp-credentials set`, add `IRIS_SERVER_MANAGER=auto` to `.mcp.json` env). Back-compat suite green with feature off.
- **F1 (VS Code path):** Copilot user reaches a working iris-dev-mcp with zero manual config (install extension → pick server → consent).
- **F2:** one governance file drives identical effective policy across ≥2 different agents, verified by `iris_server_profiles` output equality; a UI/CLI toggle is enforced (refusal observed) after restart.

---

# Research Synthesis: Server Manager-Sourced Connections for the iris-mcp Suite

## Executive Summary

Today, every user of the iris-mcp suite pastes an IRIS hostname, username, and plaintext password into each agent's MCP configuration. Meanwhile, most of those same users already maintain a curated, credential-secured roster of IRIS servers in the InterSystems Server Manager VS Code extension. This research establishes exactly how far that roster can be reused — and where the hard boundary lies.

The boundary is precise: Server Manager's connection **definitions** (`intersystems.servers`) are plain JSONC in VS Code settings files, readable by any process; its **passwords** live in VS Code SecretStorage, encrypted with an app-bound Electron `safeStorage` key that no external process can use — there is no supported extraction path, and none should be attempted. Every viable architecture follows from this split. Inside VS Code, a broker extension can resolve full credentials via the `intersystems-server-credentials` authentication provider and inject them as env vars into MCP server processes at spawn time — a pattern already proven in production by George James Software's gj::servAI, and one that requires **zero changes** to the iris-mcp packages because they already consume `IRIS_*` env vars. Outside VS Code, the suite reads definitions from settings files directly and completes credentials through a chain: explicit env → suite-owned OS keychain entry (via `@napi-rs/keyring`, with a one-command setup CLI) → user-configurable credential helper (the git/docker model). MCP elicitation is spec-forbidden for passwords and is ruled out.

**Key Technical Findings:**

- Server Manager's extension API (`getServerNames`/`getServerSpec` + `getSession(...)` where password = `session.accessToken`) is extension-host-only; the user's iris-table-editor code provides a complete, working call sequence to reuse.
- The gjServAI extension validates the exact broker architecture — `McpServerDefinitionProvider` → resolve credentials lazily at server start → `env: { IRIS_USERNAME, IRIS_PASSWORD, ... }` — matching this suite's existing env contract.
- The repo's `loadProfileRegistry` seam, name-keyed governance, and per-profile session isolation mean Server-Manager sourcing composes additively: with `IRIS_SERVER_MANAGER` unset, behavior is provably identical to today.
- MCP client config formats are heterogeneous (JSON/TOML, divergent env expansion); the only fully agent-agnostic governance substrate is a file referenced by path (`IRIS_GOVERNANCE_FILE`), managed by CLI and optionally a VS Code UI, enforced unchanged inside the servers.

**Technical Recommendations:**

1. Build Feature 1 (connection integration) as a layered resolver in `@iris-mcp/shared`: env config wins; Server Manager definitions merge in behind an opt-in `IRIS_SERVER_MANAGER` switch; credentials complete via the env → keychain → helper chain.
2. Ship the `iris-mcp-credentials` CLI with it — the ≤2-command standalone setup is the difference between a demo and a daily tool.
3. Ship the broker VS Code extension (`iris-mcp-launcher`) as a separate optional deliverable for the zero-setup Copilot/VS Code experience.
4. Build Feature 2 (governance surface) on `IRIS_GOVERNANCE_FILE` + CLI first; add the VS Code governance UI as a later layer in the same extension. Enforcement never leaves the servers.
5. Defer the live credential-broker daemon (ssh-agent style) unless the keychain chain proves insufficient — it adds a secret-disclosure surface OWASP guidance counsels against.

## Table of Contents

1. Technical Research Scope Confirmation
2. Technology Stack Analysis — Server Manager internals, SecretStorage boundary, local reference code, current suite config layer
3. Integration Patterns Analysis — Patterns A–E for credential/connection flow, interoperability with profiles & governance
4. Architectural Patterns and Design — candidate architectures per feature, precedence/merge model, security architecture
5. Implementation Approaches and Technology Adoption — F1/F2 designs (F1-D1…D5, F2-D1…D3), phased plans, testing, risks, KPIs
6. Research Synthesis — executive summary, strategic assessment, methodology, sources
7. Addendum: Feature 3 — Multi-Client MCP Configuration Manager (client roster, adapter registry, enable/disable design, write engine, implementation plan)

## Strategic Technical Assessment

**Two features, independently shippable (user directive honored):** Feature 1 (Server Manager connection integration: shared-package resolver + credential chain + CLI + optional broker extension, ~5 stories) and Feature 2 (governance management: file substrate + CLI + optional UI, ~3 stories) share no code dependency. Feature 1 alone removes plaintext IRIS passwords from MCP config for both VS Code and standalone workflows; Feature 2 alone makes one governance policy portable across every agent. The optional `iris-mcp-launcher` extension is the shared eventual home for both features' UI layers but blocks neither.

**Back-compat posture:** both features are strictly additive behind new env vars, with mechanical proofs (rule #19) — existing users see byte-identical behavior until they opt in. Governance authority remains exactly where it is today: MCP configuration supplied to the servers, enforced at the existing `dispatchToolCall` chokepoint.

**Future outlook:** VS Code's MCP surface (`vscode.lm` APIs, native `inputs` secret handling) is still evolving; the design deliberately keeps all core value in the npm packages (no `vscode` imports) so extension-API churn affects only the optional extension. If the MCP ecosystem later standardizes a secrets interface, the credential chain gains one more link without architectural change. If InterSystems ships a first-party MCP credential bridge, Pattern A's broker can be retired in its favor with no npm-package impact.

## Technical Research Methodology and Source Verification

- **Method:** parallel web research (Perplexity Sonar) cross-verified against primary sources (GitHub source code of intersystems-servermanager and gjServAI, VS Code/Electron/MCP official docs), plus live exploration of two local codebases (iris-table-editor; this repo) by read-only agents with file/line-cited findings.
- **Multi-source validation:** every load-bearing claim (SecretStorage non-extractability, Server Manager API shapes, gjServAI env-injection, elicitation prohibition) is confirmed by at least two independent sources, one of them primary (source code or spec).
- **Confidence levels:** stated inline throughout. Residual Medium-confidence items to verify during implementation: exact MCP config paths for some third-party clients; Claude Code's non-consumption of VS Code-contributed MCP definitions (verify against current Claude Code docs at build time); gjServAI's per-client reach beyond Copilot.
- **Primary sources:** github.com/intersystems-community/intersystems-servermanager; github.com/gjsjohnmurray/gjServAI; modelcontextprotocol.io specification (elicitation); code.visualstudio.com (MCP config, extension API); github.com/microsoft/vscode-discussions/discussions/748 (safeStorage); electronjs.org (safeStorage); docs.intersystems.com (GVSCO server profiles/connect); OWASP MCP Top 10 (MCP01); openexchange.intersystems.com (Server Manager, gj::servAI); npm (jsonc-parser, @napi-rs/keyring).
- **Local evidence:** `iris-table-editor/packages/vscode/src/providers/ServerConnectionManager.ts` (working Server Manager call sequence); this repo's `packages/shared/src/{config,profiles,governance,audit,server-discovery,server-base}.ts` (seams and chokepoints, file:line cited in Step 2).

## Technical Research Conclusion

The research goals are met: Server Manager can serve as a first-class, opt-in connection source for the iris-mcp suite in both runtime scenarios without weakening the existing profile model, governance authority, or back-compat guarantees; the governance-management question resolves to a file-substrate + editor-surfaces design that is multi-agent by construction. The recommended next step is to take Feature 1 into BMAD planning (create-epics-and-stories against the 5-story plan in the Implementation section), with Feature 2 planned separately so it can be scheduled — or consciously deferred — on its own merits.

---

**Technical Research Completion Date:** 2026-07-25
**Source Verification:** All load-bearing claims cited inline with confidence levels; primary-source verification for critical constraints.
**Technical Confidence Level:** High for the architecture-determining facts; Medium items enumerated for implementation-time verification.

---

# Addendum (2026-07-25): Feature 3 — Multi-Client MCP Configuration Manager

**User directive:** since the suite will ship a CLI and a VS Code extension UI for the governance surface, extend them to manage the **full MCP configuration surface** across the common MCP clients. Clients must be user-selectable in the extension; the extension must also support **enabling and disabling individual servers** per client. Requested clients: Claude Code, Cline, Pi, Codex, Kimi Code (CLI + VS Code extension), plus the top ~10 by adoption. This is a full design intended to remove implementation-time guesswork.

## 3.1 Client Landscape and v1 Roster

Adoption research (2026 rankings) puts these at the top: VS Code Copilot agent, Cursor, Claude Code + Claude Desktop, OpenAI Codex, Cline, Windsurf, JetBrains AI Assistant (Junie), Roo Code, Gemini CLI, Kilo Code.
_Source: https://www.faros.ai/blog/best-ai-coding-agents-2026 ; https://kilo.ai/articles/top-ai-coding-agents (Confidence: Medium — adoption rankings are editorial)_

**v1 adapter roster (13 clients, all with verified config surfaces):** Claude Code, Claude Desktop, Cursor, VS Code (Copilot agent), Cline, Roo Code, Windsurf, OpenAI Codex CLI, Gemini CLI, Zed, Goose, Kimi CLI, Kimi Code (CLI + VS Code extension — one adapter; they share config files).

**Dispositions for requested/ranked clients not in v1:**
- **Pi (pi CLI / pi-coding-agent):** verified to have **no built-in MCP support by design** — its philosophy is a minimal four-tool core (read/write/edit/bash) with external tools called via bash or TypeScript extensions, and reviews explicitly state "no MCP". Disposition: **excluded from the adapter roster; documented in the UI as "not MCP-capable"**; revisit if Pi ships MCP support. (A custom Pi extension bridging to MCP would be a separate product, out of scope.)
  _Source: https://deepakness.com/blog/pi-agent-setup/ ; https://www.llmreference.com/agents/pi (Confidence: High — multiple independent sources agree)_
- **JetBrains AI Assistant / Junie, Kilo Code:** high adoption but config surfaces not yet verified against official docs. Disposition: **roadmap adapters** — the registry is data-driven (3.2), so each is an adapter-data addition + fixture test once verified (Kilo Code is a Roo/Cline lineage fork and likely follows the `mcp_settings.json` pattern — verify, don't assume, per rule #16's spirit).

## 3.2 Client Adapter Registry (the core abstraction)

Everything is driven by a declarative `ClientAdapter` record — code handles formats; data handles clients. Adding a client never touches engine code.

```ts
interface ClientAdapter {
  id: string;                     // "claude-code", "cursor", "kimi-code", ...
  displayName: string;
  format: "json" | "jsonc" | "toml" | "yaml";
  rootKey: string;                // "mcpServers" | "servers" | "mcp_servers" | "context_servers" | "extensions"
  scopes: {                       // one entry per supported scope
    scope: "user" | "project";
    paths: PlatformPaths;         // win32/darwin/linux path templates (env-var based)
    shareable: boolean;           // safe to commit (project files) vs user-private
  }[];
  entryShape: "standard"          // {command,args,env}
             | "zed"              // context_servers command-object variant
             | "goose"            // extensions {type:stdio,cmd,args,envs,...}
             | "codex-toml";      // [mcp_servers.<name>] tables
  envExpansion: "claude" | "vscode" | "none";  // ${VAR} / ${input:}+${env:} / literals only
  disableSupport: "native"        // client has a disabled/enabled flag on entries
                 | "stash";       // manager stash-and-remove (3.4)
  nativeDisableFlag?: { key: string; enabledValue: unknown; disabledValue: unknown };
  restartHint: string;            // shown after every write
  detection: DetectionRule[];     // config file/app-dir existence probes
  docsUrl: string;
}
```

**v1 adapter data (verified per client; Confidence High unless noted):**

| Client | Format | Root key | User scope path | Project scope path | Env expansion | Disable |
|---|---|---|---|---|---|---|
| Claude Code | JSON | `mcpServers` | `~/.claude.json` (managed via `claude mcp add` preferred) | `.mcp.json` | `${VAR}`, `${VAR:-def}` | stash |
| Claude Desktop | JSON | `mcpServers` | Win `%APPDATA%\Claude\claude_desktop_config.json`; mac `~/Library/Application Support/Claude/…` | — | `${VAR}` convention | stash |
| Cursor | JSON | `mcpServers` | `~/.cursor/mcp.json` | `.cursor/mcp.json` | none documented (literals / OS env) | stash |
| VS Code (Copilot) | JSONC | `servers` (+`inputs`) | user-profile `mcp.json` (via "MCP: Open User Configuration") | `.vscode/mcp.json` | `${input:id}`, `${env:VAR}` | native (UI) + stash |
| Cline | JSON | `mcpServers` | `<VSCode globalStorage>/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` | — | none | **native `disabled`** |
| Roo Code | JSON | `mcpServers` | ext-storage `mcp_settings.json` | `.roo/mcp.json` | `${VAR}` in headers/args | native `disabled` |
| Windsurf | JSON | `mcpServers` | `~/.codeium/windsurf/mcp_config.json` | — | none documented | stash |
| Codex CLI | TOML | `[mcp_servers.<n>]` | `~/.codex/config.toml` | `.codex/config.toml` (trusted projects) | `${VAR}` in args/headers | verify `enabled` flag; else stash (Confidence: Medium) |
| Gemini CLI | JSON | `mcpServers` | `~/.gemini/settings.json` | `.gemini/settings.json` | shell `$VAR` convention | stash |
| Zed | JSON | `context_servers` | `~/.config/zed/settings.json` / `%APPDATA%\zed\settings.json` | `.zed/settings.json` | `${VAR}` convention | stash |
| Goose | YAML | `extensions` | `~/.config/goose/config.yaml` / `%APPDATA%\goose\config.yaml` | — | `${VAR}` | native `enabled` |
| Kimi CLI | JSON | `mcpServers` | `~/.kimi/mcp.json` | — (`--mcp-config-file` override) | none documented | stash |
| Kimi Code (CLI + VS Code ext) | JSON | `mcpServers` | `~/.kimi-code/mcp.json` (or `$KIMI_CODE_HOME`) | repo `.mcp.json` (Claude-compatible) and `.kimi-code/mcp.json` (most specific wins) | none documented | stash |

_Sources: official docs per client — code.visualstudio.com/docs/agents/reference/mcp-configuration; code.claude.com/docs/en/mcp; cursor.com/docs/mcp.md; docs.cline.bot; roocodeinc.github.io/Roo-Code; github.com/openai/codex/blob/main/docs/config.md; moonshotai.github.io/kimi-cli + /kimi-code; zed/goose/windsurf/gemini docs as cited in the reason-model compilation. Path minutiae (Confidence: Medium-High) — each adapter is certified by a live probe before release (3.7)._

**Notable cross-client facts the design exploits:** Kimi Code honors repo-root `.mcp.json` (Claude Code's project file) — one project file can serve both; VS Code is the only client with a different root key *and* first-class secret `inputs`; only Cline/Roo/Goose have native per-entry disable flags.

## 3.3 What the Manager Writes (server entry synthesis)

For each selected iris-mcp server (`iris-dev-mcp`, `iris-admin-mcp`, `iris-ops-mcp`, `iris-interop-mcp`, `iris-data-mcp`, or `iris-mcp-all`), the manager synthesizes a client-native entry from one canonical internal model:

```
canonical:  { name, command: "npx", args: ["-y", "@iris-mcp/<pkg>"], env: {...} }
env modes (user-selected per deployment):
  1. server-manager  → IRIS_SERVER_MANAGER=auto, IRIS_SM_SERVERS=..., no secrets   (requires Feature 1)
  2. env-reference   → IRIS_PASSWORD: "${IRIS_PASSWORD}" where envExpansion supports it;
                       for "none" clients: omit + instruct OS-env injection (doctor verifies)
  3. governance-file → IRIS_GOVERNANCE_FILE=<path>                                  (requires Feature 2)
  4. explicit        → literal values; UI/CLI require a typed confirmation before writing
                       any literal IRIS_PASSWORD, and mark the entry "contains-secret"
```

VS Code adapter upgrades mode 2 to native `inputs` (`${input:iris-password}` + `promptString/password:true`). The Codex adapter renders TOML tables; Zed/Goose adapters render their entry shapes. Modes 1/3 are the recommended pairing and the reason Features 1–3 compose: **connections from Server Manager, governance from a shared file, wiring from the manager — zero secrets in any client config.**

## 3.4 Enable/Disable Design (per client × per server)

Two mechanisms, chosen by adapter capability:

- **Native flag** (Cline `disabled:true`, Roo `disabled`, Goose `enabled:false`, Codex if verified): set the flag in place; entry and its comments/settings remain visible in the client's file.
- **Stash-and-remove** (universal fallback): disabling removes the entry from the client config and stores it byte-preserved in the manager's state file `~/.iris-mcp/client-manager/state.json` (`{client, scope, name, entry, disabledAt}`); enabling splices it back. Idempotent both directions; `state.json` never contains secrets beyond what the client file already had (and mode-1/2/3 entries contain none).

Rules: the manager only enables/disables entries **it owns** (name in the iris-mcp namespace or recorded in state as manager-created). Third-party entries are read-only in the UI (listed for context, never modified). This toggle governs *server presence per client* and is orthogonal to tool-level governance (Epic 30 visibility presets / `IRIS_GOVERNANCE`), which the UI signposts to avoid conceptual confusion.

## 3.5 Format-Preserving Write Engine

- **JSON/JSONC:** `jsonc-parser` `modify()`/`applyEdits()` — surgical edits preserving comments, ordering, and formatting (the same machinery VS Code uses).
- **TOML (Codex):** read via a TOML parser; writes are **text-level section splices** limited to the `[mcp_servers.<name>]`/`[mcp_servers.<name>.env]` tables the manager owns — user comments elsewhere are untouched (general-purpose TOML serializers drop comments; ruled out for whole-file rewrite).
- **YAML (Goose):** `yaml` (eemeli) document API — comment-preserving CST edits under `extensions.<name>`.
- **Universal safety protocol:** (1) parse-validate before touching; (2) timestamped backup to `~/.iris-mcp/client-manager/backups/<client>/<file>.<ts>` before every write; (3) re-parse after edit — a post-write parse failure auto-restores the backup; (4) diff preview + explicit confirm in both CLI (`--yes` to skip) and UI; (5) never log or transmit config contents (third-party entries may hold other products' secrets); (6) prefer the client's own writer CLI where one exists and is non-interactive (`claude mcp add-json`, `kimi mcp add`) with direct file edit as fallback — adapter data records which path is used.

## 3.6 Deliverable Shape

- **`@iris-mcp/client-config`** — new package (not in server runtime deps): adapter registry data, detection, read/diff/write engine, enable/disable, backup/restore. Single source for both consumers below (rule #45 single-sourcing).
- **CLI `iris-mcp-clients`:** `detect` (installed clients + config paths), `status` (matrix: client × iris-mcp server × enabled/disabled/absent), `apply` (`--client --servers --scope --mode`), `enable|disable --client --server`, `remove`, `diff` (dry-run render of pending edits), `doctor` (validates env-reference mode resolvability, file parseability, restart hints).
- **Extension UI (in `iris-mcp-launcher`):** "MCP Clients" view — detected clients with **user-selectable checkboxes** (roster selection persisted in extension state); per-client expansion showing the 5 servers + `iris-mcp-all` with enable/disable toggles (3.4) and scope/mode pickers; diff preview panel before Apply; per-client restart hint after write; links to each client's docs. Third-party servers shown read-only.

## 3.7 Testing, Certification, and Risk

- **Fixture tests per adapter:** golden-file round-trips (add → disable → enable → remove → byte-compare against expected), including files with foreign entries, comments (JSONC/TOML/YAML), and malformed input (must refuse + not write).
- **Adapter certification (pre-release, per client):** live probe on a machine with the client installed — write entry, launch client, confirm the iris-mcp server lists tools, disable, confirm absence. Clients not locally installable get a documented residual-risk note instead of silent certification (rule #34 discipline). Certification results recorded in a disposition table in the package README.
- **Primary risk — config-surface drift** (clients evolve fast; some paths are community-documented only): mitigated by data-driven adapters (fix = data patch), `doctor`, version-stamped adapter data, and the certification table making verification status explicit per client.
- **Secondary risk — concurrent edits** (client running while manager writes): mitigated by read-modify-write with post-write re-parse + restart hints; no file locking in v1 (documented).

## 3.8 Feature 3 Implementation Plan (independent epic, ~5 stories)

1. **Adapter registry + detection + read/status/diff engine** — registry data for all 13 clients, fixtures, `detect`/`status`/`diff` (read-only; zero write risk). Documents the write-engine seam (rule #52).
2. **Write engine + backup/restore + enable/disable** — JSONC/TOML/YAML editors, stash state, native flags, safety protocol; golden-file suite.
3. **CLI `iris-mcp-clients`** — full command surface over the engine; dist smoke in fresh Node (rule #22).
4. **Extension UI** — client selector, per-server toggle matrix, diff preview, apply/restore; manual smoke: enable iris-dev-mcp for two different clients from the UI, verify both agents list tools; disable one, verify absence.
5. **Adapter certification pass** — live certification for locally available clients (Claude Code, VS Code, Cursor, Cline, Codex, Kimi at minimum), disposition table for the rest; docs rollup (per-client recipes move from hand-written README sections to generated-by-`status` guidance).

Dependencies: none on Features 1–2 (modes 1/3 simply hide until those ship). Recommended sequencing if all three proceed: F1 → F2 → F3, because F3's best mode ("server-manager + governance-file, zero secrets") is only as good as the features beneath it — but F3 stories 1–2 can start any time.

## 3.9 Synthesis Update

With Feature 3, the full vision becomes: **Server Manager owns connections (F1), one shared file owns governance (F2), and the manager owns wiring + per-client server enablement (F3)** — a user selects clients in the extension (or CLI), picks servers and a mode, and every agent on the machine gets consistent, secret-free iris-mcp configuration. Pi is the one requested client that cannot participate (no MCP support by design, documented); JetBrains and Kilo Code are data-only roadmap additions once their surfaces are verified.

