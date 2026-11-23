# MCP Client Configuration — index and caveats

How to point any MCP client at the IRIS MCP Server Suite, plus the two credential caveats that surprise people most.

> **The fast path is the manager (Epic 33):** `npx -y -p @iris-mcp/client-config@1 iris-mcp-clients`
> detects your installed clients (`detect`), previews the exact edit (`diff`), writes it through the
> backup-on-write engine (`apply`), toggles entries (`enable`/`disable`/`remove`), rolls back
> (`restore`), and diagnoses the result (`doctor`). The same command is the 1.0.x route for every
> client; from 1.1.0, Claude Code has a plugin and VS Code has an extension (see the
> [suite README](../../README.md#quick-start)). The per-client snippets below are the **manual
> fallback** — and the reference for what the manager writes. Per-client adapter details and
> certification dispositions: [packages/client-config README](../../packages/client-config/README.md).
>
> **Prefer a GUI?** The same engine drives the **"IRIS MCP Launcher: Manage MCP Clients…"** view in the
> [VS Code extension](../../extensions/iris-mcp-launcher/README.md#mcp-clients-view) — client roster,
> per-server toggles, diff preview, backup restore and doctor, all through the identical CLI code path.
> It helps every client, not just Copilot: use it from VS Code to wire up Claude Code, Cursor, Cline, and
> the rest. Install it from the vsix on the repository's GitHub Releases (from 1.1.0; it is not on the Visual Studio Marketplace or
> Open VSX yet); see [the extension's README](../../extensions/iris-mcp-launcher/README.md#installing).

Detailed per-client guides: **[Claude Code](claude-code.md)** · **[Claude Desktop](claude-desktop.md)** · **[Cursor](cursor.md)**. Everything else is covered below.

Every guide has one install path: `npx -y -p @iris-mcp/client-config@1 iris-mcp-clients apply --client <id> --servers iris-dev-mcp`. For a client that works in a project folder, `skills install --client <id>` then adds the [skills pack](../../README.md#the-skills-pack).

---

## Read this first — two caveats

### 1. The six base variables are always required

`IRIS_HOST`, `IRIS_PORT`, `IRIS_USERNAME`, `IRIS_PASSWORD`, `IRIS_NAMESPACE`, `IRIS_HTTPS` configure the reserved `default` profile, which is built **before** any Server Manager import or profile merge.

Setting `IRIS_SERVER_MANAGER=auto` **does not let you omit them.** Omitting `IRIS_USERNAME` fails at startup with:

```
Fatal: Error: IRIS_USERNAME environment variable is required.
```

Note the difference between a **missing** setting and an **unreachable** instance: the former fails startup fast, as above; the latter does not. Since Story 37.1, a `default` instance that is down (or that refuses the connection — a wrong password, a disabled `/api/atelier` web app) no longer stops the server from starting. It logs the reason plus a continuation line naming host:port, starts anyway, serves every other profile, and returns a per-call connection error for `default` until it recovers. See [Backward Compatibility](../../README.md#backward-compatibility) in the suite README.

Server Manager import is **additive** — it adds *extra* addressable profiles alongside `default`. It is not a replacement for your primary connection.

### 2. The OS keychain covers Server-Manager profiles only — not `IRIS_PASSWORD`

`iris-mcp-credentials set <name>` stores a password the credential chain uses for an **imported** Server Manager definition that has none.

It is **not** consulted for the base credentials. Storing an entry named `default` has no effect: `loadConfig` reads `IRIS_PASSWORD` from the environment and never calls the chain. Verified — a `default` keychain entry still fails with `IRIS_PASSWORD environment variable is required`.

**So the keychain reduces plaintext for your additional servers; it cannot remove `IRIS_PASSWORD` from your client config.**

Worked example, verified end to end — four profiles resolving at once:

| Profile | Source | Credential from |
|---|---|---|
| `default` | env | `IRIS_PASSWORD` (required, plaintext) |
| `sademo` | `IRIS_PROFILES` | inherits base credentials |
| `local` | Server Manager | inline `password` in `intersystems.servers` (deprecated) |
| `localhost2` | Server Manager | **OS keychain** via `iris-mcp-credentials set localhost2` |

### 3. The VS Code extension does not serve every client

`iris-mcp-launcher` registers servers into **VS Code's own MCP registry** (`contributes.mcpServerDefinitionProviders`). Only Copilot-family agents read that registry.

**Claude Code does NOT** — it manages its own config (`~/.claude.json`, `.mcp.json`, `claude mcp add`), in both the VS Code extension and the CLI. Same for Cline, Kimi, Codex and the other CLI-configured clients. They all use the env-var path documented below.

---

## Client matrix

Certification status (Story 33.4 — full dispositions in the
[package README](../../packages/client-config/README.md#certification-dispositions-generated)):
**certified-live 2026-07-28** (✅) versus **fixture-only-with-residual-risk** (⚠️ — adapter data +
golden round-trips proven; the real client's config surface not yet hands-verified).

| Client | Format | Root key | User-scope path | Project scope | Disable |
|---|---|---|---|---|---|
| ✅ Claude Code | JSON | `mcpServers` | `~/.claude.json`, or `$CLAUDE_CONFIG_DIR/.claude.json` when that is set (prefer `claude mcp add`) | `.mcp.json` | stash |
| ✅ Cline | JSON | `mcpServers` | `<VS Code globalStorage>/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` | — | native `disabled` |
| ✅ Kimi Code | JSON | `mcpServers` | `~/.kimi-code/mcp.json` (or `$KIMI_CODE_HOME`) | `.kimi-code/mcp.json` | stash |
| ✅ VS Code (Copilot) | JSON | `mcpServers` | `~/.copilot/mcp-config.json` (Windows `%USERPROFILE%\.copilot\mcp-config.json`; `$COPILOT_HOME/mcp-config.json` when that is set) | `.mcp.json` (shared with Claude Code) | stash |
| ⚠️ Claude Desktop | JSON | `mcpServers` | Win `%APPDATA%\Claude\claude_desktop_config.json`; mac `~/Library/Application Support/Claude/…` | — | stash |
| ⚠️ Cursor | JSON | `mcpServers` | `~/.cursor/mcp.json` | `.cursor/mcp.json` | stash |
| ⚠️ Codex CLI | **TOML** | `[mcp_servers.<name>]` | `~/.codex/config.toml` | `.codex/config.toml` | native `enabled` flag (docs-verified) |
| ⚠️ Kimi CLI (archived) | JSON | `mcpServers` | `~/.kimi/mcp.json` (`--mcp-config-file` override) | — | stash |
| ⚠️ Roo Code (discontinued) | JSON | `mcpServers` | ext-storage `mcp_settings.json` | `.roo/mcp.json` | native `disabled` |
| ⚠️ Devin Desktop (formerly Windsurf) | JSON | `mcpServers` | `~/.codeium/windsurf/mcp_config.json` | — | stash |
| ⚠️ Gemini CLI | JSON | `mcpServers` | `~/.gemini/settings.json` | `.gemini/settings.json` | stash |
| ⚠️ Zed | JSON | `context_servers` | `~/.config/zed/settings.json` / `%APPDATA%\zed\settings.json` | `.zed/settings.json` | stash |
| ⚠️ Goose | **YAML** | `extensions` | `~/.config/goose/config.yaml` / `%APPDATA%\Block\goose\config\config.yaml` | — | native `enabled` |
| ⚠️ Pi (from 1.1.0) | JSON | `mcpServers` | `~/.pi/agent/mcp.json` (or `$PI_CODING_AGENT_DIR`) | `.pi/mcp.json` | stash |
| ⚠️ JetBrains Junie (from 1.1.0) | JSON | `mcpServers` | `~/.junie/mcp/mcp.json` | `.junie/mcp/mcp.json` | stash |

Clients on the roadmap, not yet supported by the manager: Kilo Code (its entries need an OpenCode-style shape the engine does not model) and Antigravity CLI (its `~/.gemini` folder is also Gemini CLI's). The `human-only` rows of the [certification table](../../packages/client-config/README.md#certification-dispositions-generated) name the checks that only a person at the client can make.

Three formats and four root keys — `mcpServers`, `servers`, `context_servers`, `extensions` — is exactly why Epic 33 builds a config manager instead of documenting copy-paste forever.

---

## Protocol revisions and confirmation dialogs

What a client sees of the two MCP protocol revisions, and of the confirmation dialogs, does not change the config you write, and nothing here is configured on the server. In this section `2026-07-28` is an MCP protocol revision; in the matrix above it is the date a client's configuration lifecycle was certified.

- **One process, two revisions.** Each server is one stdio process that serves both MCP revisions, `2025-11-25` and `2026-07-28`, and the client's first message chooses: `initialize` selects `2025-11-25`, `server/discover` selects `2026-07-28`. A client that speaks only `2025-11-25` sees the bytes it always saw, apart from the sanctioned changes the CHANGELOG lists (for example, Story 43.4 appends a passage about the dialog to five tool descriptions and lists each governance URI once).
- **Claude Code.** Claude Code 2.1.292 and later negotiates `2026-07-28` by default. Setting `MCP_PROTOCOL_NEGOTIATION=legacy` in Claude Code's own environment keeps `2025-11-25`; Claude Code reads it, so set it in the shell Claude Code starts from or in the `env` of Claude Code's `settings.json`, never in the `env` block of an MCP server entry. See [Claude Code: protocol revision and confirmation dialogs](claude-code.md#protocol-revision-and-confirmation-dialogs).
- **A probe copy of the server (DW-641, as observed).** A client built on the TypeScript MCP SDK v2 client, in `auto` mode or pinned to a revision (for example MCP Inspector 2.x with `--protocol-era auto` or `modern`), first starts a short-lived probe copy of the server. The probe runs the whole startup (configuration load, connection check, bootstrap version query, and the deployment of the ExecuteMCPv2 classes when they are missing or out of date), answers `server/discover`, and is ended by the client with SIGTERM. So the server starts twice per connect, `IRIS_AUDIT_LOG` gains a second `sessionStart` line, which is the only line of the probe's session (no stdio session writes a `shutdown` line; see [Compliance & Auditability](../../README.md#compliance--auditability)), and the probe's stderr is discarded, so its log lines are not shown. Claude Code probes on the same connection and starts the server once.
- **A probe that times out.** A TypeScript SDK v2 client on `auto` whose probe is not answered within the request timeout (60 seconds by default) treats the server as `2025-11-25`.
- **Confirmation dialogs.** Six destructive gates ask the person through a form when the client declares form elicitation, and any other client keeps the contract it always had (`confirm: true` plus governance, or governance alone for `resend` and `regenerateStorage`); see [Human confirmation (elicitation)](../../README.md#human-confirmation-elicitation). As observed: Claude Code 2.1.296 declares form elicitation on both revisions; MCP Inspector CLI 2.9.0 declares none, so it gets that previous contract and no dialog; other clients are not verified here.
- **What the matrix certifies.** The certification covers the configuration lifecycle of a client (reading, writing, disabling and removing the server entry), not its protocol negotiation or its dialog behavior.

---

## The env block (identical for every client)

Every snippet below sets the same variables. Substitute your own values.

```
IRIS_HOST=localhost   IRIS_PORT=52773        IRIS_HTTPS=false
IRIS_USERNAME=_SYSTEM IRIS_PASSWORD=<secret> IRIS_NAMESPACE=USER
```

Optional, to pick up InterSystems Server Manager connections as extra profiles:

```
IRIS_SERVER_MANAGER=auto
IRIS_SM_WORKSPACE=/path/to/your/workspace
```

> **Entry form.** Every snippet below launches a server with `npx -y @iris-mcp/dev@1` (Node.js 22.17 or later). The five servers are `@iris-mcp/dev`, `admin`, `data`, `interop` and `ops`, each pinned to major version 1; add one entry per server.

---

## Claude Code ✅

Preferred — the CLI writes the config for you:

```bash
claude mcp add --scope user iris-dev-mcp -e IRIS_HOST=localhost -e IRIS_PORT=52773 \
  -e IRIS_USERNAME=_SYSTEM -e IRIS_PASSWORD=secret -e IRIS_NAMESPACE=USER \
  -- npx -y @iris-mcp/dev@1
```

Or edit `~/.claude.json`, or `$CLAUDE_CONFIG_DIR/.claude.json` when that variable is set (root-level `mcpServers` = user scope; see [claude-code.md](claude-code.md)):

```jsonc
"mcpServers": {
  "iris-dev-mcp": {
    "command": "npx",
    "args": ["-y", "@iris-mcp/dev@1"],
    "env": {
      "IRIS_HOST": "localhost", "IRIS_PORT": "52773", "IRIS_HTTPS": "false",
      "IRIS_USERNAME": "_SYSTEM", "IRIS_PASSWORD": "secret", "IRIS_NAMESPACE": "USER",
      "IRIS_SERVER_MANAGER": "auto",
      "IRIS_SM_WORKSPACE": "c:/git/my-project"
    }
  }
}
```

Restart Claude Code to pick up changes. Verify with `claude mcp list`.

The project `.mcp.json` is also the project file of VS Code (Copilot) in the MCP client manager, and an entry in it belongs to the client that wrote it. When VS Code (Copilot) owns an entry under a server name in this project's `.mcp.json` (a record from another project never counts), an `apply --client claude-code --scope project`, a `disable`, `enable` or `remove` of that server, and a `restore` whose backup would change it are refused (exit 1, nothing written), an identical entry included. To switch the server to Claude Code, `remove` it with VS Code (Copilot) first, then `apply` it with Claude Code; configuring both clients for one project means picking one per server.

## VS Code (Copilot) ✅

The Copilot harness (the default since VS Code 1.143) reads two files itself, and the manager writes exactly those:

- the user file `~/.copilot/mcp-config.json` (on Windows `%USERPROFILE%\.copilot\mcp-config.json`; `$COPILOT_HOME/mcp-config.json` when `COPILOT_HOME` is set and non-empty). It is strict JSON, with no comments and no trailing commas. The GitHub Copilot CLI (`copilot`) reads the same file, so an entry applied, disabled or removed here changes its servers too;
- the workspace-root `.mcp.json`, the same file Claude Code uses for a project. Each entry in it belongs to the client that wrote it, and the other client is refused (exit 1, nothing written), an identical entry included, so applying VS Code after Claude Code for the same server is refused; to switch a server between the two clients, `remove` it with its owner first, then `apply` it with the other. An iris-mcp entry that no record names for the file belongs to Claude Code. A `restore` whose backup would change an entry the other client owns is refused the same way. Ownership is kept per project file: a record or a disabled entry from another project never counts here, and after a project folder is moved or renamed, `enable` finds nothing to enable there and VS Code's entries there belong to Claude Code: `remove` them with `claude-code`, then `apply` with `vscode`.

Both use the root key **`mcpServers`**, expand `${VAR}` from the environment VS Code was launched with, and have **no `inputs` prompt**: the Copilot harness cannot forward a password prompt. A user entry is shaped like the one VS Code writes itself:

```jsonc
{
  "mcpServers": {
    "iris-dev-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@iris-mcp/dev@1"],
      "env": {
        "IRIS_HOST": "${IRIS_HOST}", "IRIS_PORT": "${IRIS_PORT}", "IRIS_HTTPS": "${IRIS_HTTPS}",
        "IRIS_USERNAME": "${IRIS_USERNAME}", "IRIS_PASSWORD": "${IRIS_PASSWORD}",
        "IRIS_NAMESPACE": "${IRIS_NAMESPACE}"
      },
      "tools": ["*"]
    }
  }
}
```

**Credentials.** `${IRIS_*}` resolves from the environment VS Code was started with, so export the variables in a shell and start VS Code (`code .`) from it, and start it again after you change them. The `server-manager` mode writes no secret, only `IRIS_SERVER_MANAGER` and `IRIS_SM_SERVERS`: the server reads the passwords of the Server Manager connections it adds from your OS keychain. It does not replace the base connection: the server's `default` profile still reads the base `IRIS_*` variables, `IRIS_PASSWORD` included, from the same environment (see "The OS keychain covers Server-Manager profiles only" above).

**Moving from the old files.** Earlier versions wrote VS Code's own `mcp.json` files (the profile `mcp.json` and `.vscode/mcp.json`, root key `servers`, with an `inputs` password prompt). Those belong to the Local harness, which VS Code removes in February 2027, and the Copilot harness does not forward their entries. `iris-mcp-clients status` and `doctor` report any iris-mcp entry still in them, and the next `apply --client vscode --scope <user|project>` writes the new file and then removes the entry from the old one, leaving everything else in that file as it was.

Copilot users can also install the **[iris-mcp-launcher extension](../../extensions/iris-mcp-launcher/README.md)**, which registers these servers from your Server Manager connections with credentials from SecretStorage. Under the Copilot harness the servers it registers do not receive those connection settings yet (a known limitation, described in the extension README); the files above are not affected.

## Cline ✅

Edit via Cline's MCP Servers pane, or the file directly. Root key `mcpServers`; entries support `disabled`, `autoApprove`, `timeout`, `type`:

```jsonc
{
  "mcpServers": {
    "iris-dev-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@iris-mcp/dev@1"],
      "env": {
        "IRIS_HOST": "localhost", "IRIS_PORT": "52773", "IRIS_HTTPS": "false",
        "IRIS_USERNAME": "_SYSTEM", "IRIS_PASSWORD": "secret", "IRIS_NAMESPACE": "USER"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

Windows path: `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`.

## Kimi Code ✅

`~/.kimi-code/mcp.json` (honors `$KIMI_CODE_HOME`). The project-level path is `.kimi-code/mcp.json`
— that is the ONLY project path the official docs document. **A repo-root `.mcp.json` is NOT read
by Kimi Code** (a 2026-07-28 live probe of 0.29.0 falsified the earlier compatibility claim; Claude
Code reads `.mcp.json`, Kimi Code does not — sharing one repo file between them does not work).
Note also that Kimi Code does not expand `${VAR}` references in MCP config — entries need literal
values or OS-environment injection.

```jsonc
{
  "mcpServers": {
    "iris-dev-mcp": {
      "command": "npx",
      "args": ["-y", "@iris-mcp/dev@1"],
      "env": {
        "IRIS_HOST": "localhost", "IRIS_PORT": "52773", "IRIS_HTTPS": "false",
        "IRIS_USERNAME": "_SYSTEM", "IRIS_PASSWORD": "secret", "IRIS_NAMESPACE": "USER"
      }
    }
  }
}
```

## Codex CLI ⚠️

**TOML, not JSON** — `~/.codex/config.toml`. Each server is its own table and env is a nested table:

```toml
[mcp_servers.iris-dev]
command = "npx"
args = ["-y", "@iris-mcp/dev@1"]

[mcp_servers.iris-dev.env]
IRIS_HOST = "localhost"
IRIS_PORT = "52773"
IRIS_HTTPS = "false"
IRIS_USERNAME = "_SYSTEM"
IRIS_PASSWORD = "secret"
IRIS_NAMESPACE = "USER"
```

Path and the per-server `enabled` flag are spec-sourced, not hands-verified.

To share ONE governance policy file across clients, add it to the same env table (explicit absolute path; unset ⇒ inert):

```toml
[mcp_servers.iris-dev.env]
IRIS_GOVERNANCE_FILE = "C:\\governance\\iris-policy.json"
```

Create/maintain the file with `npx -y -p @iris-mcp/shared@1 iris-mcp-governance` (the `iris-mcp-governance` CLI — see the [suite README](../../README.md#iris-mcp-governance-cli)).

## Kimi CLI ⚠️

`~/.kimi/mcp.json`, same `mcpServers` shape as Kimi Code. Override with `--mcp-config-file`. Distinct from Kimi Code — different directory, different file.

## Zed ⚠️

Root key is **`context_servers`**, inside Zed's main settings file:

```jsonc
{
  "context_servers": {
    "iris-dev": {
      "command": { "path": "npx", "args": ["-y", "@iris-mcp/dev@1"], "env": { "IRIS_HOST": "localhost" } }
    }
  }
}
```

## Goose ⚠️

**YAML**, root key `extensions`, and the env key is `envs`:

```yaml
extensions:
  iris-dev:
    type: stdio
    cmd: npx
    args: ["-y", "@iris-mcp/dev@1"]
    envs:
      IRIS_HOST: localhost
      IRIS_PORT: "52773"
      IRIS_USERNAME: _SYSTEM
      IRIS_PASSWORD: secret
      IRIS_NAMESPACE: USER
    enabled: true
```

## Cursor · Claude Desktop · Devin Desktop (formerly Windsurf) · Gemini CLI · Roo Code · Pi · JetBrains Junie ⚠️

All use the standard `mcpServers` JSON shape shown in the Claude Code snippet — only the file path differs (see the matrix). Cursor and Claude Desktop have dedicated guides: **[cursor.md](cursor.md)**, **[claude-desktop.md](claude-desktop.md)**.

- **Devin Desktop (formerly Windsurf).** The adapter keeps writing the legacy `~/.codeium/windsurf/mcp_config.json`. Devin CLI documents an import of that file that is on by default and that you can switch off; Devin Desktop's own documentation lists only `~/.config/devin/mcp_config.json` and `.devin/mcp_config.json`, so whether Devin Desktop reads the legacy file is not yet verified. If the servers do not appear in Devin Desktop, copy the entries into `~/.config/devin/mcp_config.json`.
- **Pi** (`--client pi`, from 1.1.0) reads `~/.pi/agent/mcp.json` (moved by `PI_CODING_AGENT_DIR`) and, once you trust the project, `.pi/mcp.json`.
- **JetBrains Junie** (`--client jetbrains-junie`, from 1.1.0) reads `~/.junie/mcp/mcp.json` and `.junie/mcp/mcp.json`; its documentation names no Windows-specific path.
- **Roo Code** was discontinued and **Kimi CLI** is archived (Kimi Code replaces it); their adapters stay so existing entries can be found and removed.

---

## Verifying

Ask the client to call `iris_server_profiles` — it returns every addressable profile with its `source` (`env` or `server-manager`), which is the fastest way to confirm both your base connection and any Server Manager import.

For Claude Code specifically, `claude mcp list` performs a health check per server. That check only confirms the MCP *process* is running and answering the protocol handshake — **a running server no longer implies the default IRIS instance is reachable** (Story 37.1): startup no longer exits when `default` is down, so a healthy-looking `claude mcp list` entry can still front an unreachable `default`. Call a cheap read tool, e.g. `iris_server_info` (or `iris_server_profiles`, which never connects), to actually confirm IRIS connectivity.
