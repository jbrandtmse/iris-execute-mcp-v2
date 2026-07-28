# MCP Client Configuration — index and caveats

How to point any MCP client at the IRIS MCP Server Suite, plus the two credential caveats that surprise people most.

> **The fast path is the manager (Epic 33):** `npx -y @iris-mcp/client-config iris-mcp-clients`
> detects your installed clients (`detect`), previews the exact edit (`diff`), writes it through the
> backup-on-write engine (`apply`), toggles entries (`enable`/`disable`/`remove`), rolls back
> (`restore`), and diagnoses the result (`doctor`). *(Not yet published to npm — until then run the
> built bin directly: `node packages/client-config/dist/cli/clients-cli.js …` from a repo checkout.)*
> The per-client snippets below are the **manual
> fallback** — and the reference for what the manager writes. Per-client adapter details and
> certification dispositions: [packages/client-config README](../../packages/client-config/README.md).
>
> **Prefer a GUI?** The same engine drives the **"IRIS MCP Launcher: Manage MCP Clients…"** view in the
> [VS Code extension](../../extensions/iris-mcp-launcher/README.md#mcp-clients-view) — client roster,
> per-server toggles, diff preview, backup restore and doctor, all through the identical CLI code path.
> It helps every client, not just Copilot: use it from VS Code to wire up Claude Code, Cursor, Cline, and
> the rest. Install it [in development mode](../../extensions/iris-mcp-launcher/README.md#installing-in-development-mode).

Detailed per-client guides: **[Claude Code](claude-code.md)** · **[Claude Desktop](claude-desktop.md)** · **[Cursor](cursor.md)**. Everything else is covered below.

---

## Read this first — two caveats

### 1. The six base variables are always required

`IRIS_HOST`, `IRIS_PORT`, `IRIS_USERNAME`, `IRIS_PASSWORD`, `IRIS_NAMESPACE`, `IRIS_HTTPS` configure the reserved `default` profile, which is built **before** any Server Manager import or profile merge.

Setting `IRIS_SERVER_MANAGER=auto` **does not let you omit them.** Omitting `IRIS_USERNAME` fails at startup with:

```
Fatal: Error: IRIS_USERNAME environment variable is required.
```

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
| ✅ Claude Code | JSON | `mcpServers` | `~/.claude.json` (prefer `claude mcp add`) | `.mcp.json` | stash |
| ✅ Cline | JSON | `mcpServers` | `<VS Code globalStorage>/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` | — | native `disabled` |
| ✅ Kimi Code | JSON | `mcpServers` | `~/.kimi-code/mcp.json` (or `$KIMI_CODE_HOME`) | `.kimi-code/mcp.json` | stash |
| ✅ VS Code (Copilot) | JSONC | `servers` (+`inputs`) | user `mcp.json` — *MCP: Open User Configuration* | `.vscode/mcp.json` | native UI |
| ⚠️ Claude Desktop | JSON | `mcpServers` | Win `%APPDATA%\Claude\claude_desktop_config.json`; mac `~/Library/Application Support/Claude/…` | — | stash |
| ⚠️ Cursor | JSON | `mcpServers` | `~/.cursor/mcp.json` | `.cursor/mcp.json` | stash |
| ⚠️ Codex CLI | **TOML** | `[mcp_servers.<name>]` | `~/.codex/config.toml` | `.codex/config.toml` | native `enabled` flag (docs-verified) |
| ⚠️ Kimi CLI | JSON | `mcpServers` | `~/.kimi/mcp.json` (`--mcp-config-file` override) | — | stash |
| ⚠️ Roo Code | JSON | `mcpServers` | ext-storage `mcp_settings.json` | `.roo/mcp.json` | native `disabled` |
| ⚠️ Windsurf | JSON | `mcpServers` | `~/.codeium/windsurf/mcp_config.json` | — | stash |
| ⚠️ Gemini CLI | JSON | `mcpServers` | `~/.gemini/settings.json` | `.gemini/settings.json` | stash |
| ⚠️ Zed | JSON | `context_servers` | `~/.config/zed/settings.json` / `%APPDATA%\zed\settings.json` | `.zed/settings.json` | stash |
| ⚠️ Goose | **YAML** | `extensions` | `~/.config/goose/config.yaml` / `%APPDATA%\goose\config.yaml` | — | native `enabled` |

Three formats and three root keys — `mcpServers`, `servers`, `context_servers`, `extensions` — is exactly why Epic 33 builds a config manager instead of documenting copy-paste forever.

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

> **`@iris-mcp/*` is not yet published to npm.** `npx -y @iris-mcp/dev` will fail. Until publication, point clients at a local build: `node /path/to/iris-execute-mcp-v2/packages/iris-dev-mcp/dist/index.js`. Every snippet below uses the local form; swap in `npx -y @iris-mcp/dev` once published.

---

## Claude Code ✅

Preferred — the CLI writes the config for you:

```bash
claude mcp add iris-dev -e IRIS_HOST=localhost -e IRIS_PORT=52773 \
  -e IRIS_USERNAME=_SYSTEM -e IRIS_PASSWORD=secret -e IRIS_NAMESPACE=USER \
  -- node /path/to/iris-execute-mcp-v2/packages/iris-dev-mcp/dist/index.js
```

Or edit `~/.claude.json` (root-level `mcpServers` = user scope; see [claude-code.md](claude-code.md)):

```jsonc
"mcpServers": {
  "iris-dev-mcp": {
    "command": "node",
    "args": ["c:/git/iris-execute-mcp-v2/packages/iris-dev-mcp/dist/index.js"],
    "env": {
      "IRIS_HOST": "localhost", "IRIS_PORT": "52773", "IRIS_HTTPS": "false",
      "IRIS_USERNAME": "_SYSTEM", "IRIS_PASSWORD": "secret", "IRIS_NAMESPACE": "USER",
      "IRIS_SERVER_MANAGER": "auto",
      "IRIS_SM_WORKSPACE": "c:/git/iris-execute-mcp-v2"
    }
  }
}
```

Restart Claude Code to pick up changes. Verify with `claude mcp list`.

## VS Code (Copilot) ✅

*MCP: Open User Configuration*, or `.vscode/mcp.json` for one workspace. Note the root key is **`servers`**, not `mcpServers`, and `inputs` prompts for secrets instead of storing them:

```jsonc
{
  "inputs": [
    { "id": "iris-password", "type": "promptString", "description": "IRIS password", "password": true }
  ],
  "servers": {
    "iris-dev": {
      "type": "stdio",
      "command": "node",
      "args": ["c:/git/iris-execute-mcp-v2/packages/iris-dev-mcp/dist/index.js"],
      "env": {
        "IRIS_HOST": "localhost", "IRIS_PORT": "52773", "IRIS_HTTPS": "false",
        "IRIS_USERNAME": "_SYSTEM", "IRIS_PASSWORD": "${input:iris-password}",
        "IRIS_NAMESPACE": "USER"
      }
    }
  }
}
```

Copilot users can skip this file entirely and install the **[iris-mcp-launcher extension](../../extensions/iris-mcp-launcher/README.md)**, which registers these servers from your Server Manager connections with credentials from SecretStorage.

## Cline ✅

Edit via Cline's MCP Servers pane, or the file directly. Root key `mcpServers`; entries support `disabled`, `autoApprove`, `timeout`, `type`:

```jsonc
{
  "mcpServers": {
    "iris-dev-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["c:/git/iris-execute-mcp-v2/packages/iris-dev-mcp/dist/index.js"],
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
      "command": "node",
      "args": ["c:/git/iris-execute-mcp-v2/packages/iris-dev-mcp/dist/index.js"],
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
command = "node"
args = ["/path/to/iris-execute-mcp-v2/packages/iris-dev-mcp/dist/index.js"]

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

Create/maintain the file with `node /path/to/iris-execute-mcp-v2/packages/shared/dist/cli/governance-cli.js` (the `iris-mcp-governance` CLI — see the [suite README](../../README.md#iris-mcp-governance-cli)).

## Kimi CLI ⚠️

`~/.kimi/mcp.json`, same `mcpServers` shape as Kimi Code. Override with `--mcp-config-file`. Distinct from Kimi Code — different directory, different file.

## Zed ⚠️

Root key is **`context_servers`**, inside Zed's main settings file:

```jsonc
{
  "context_servers": {
    "iris-dev": {
      "command": { "path": "node", "args": ["/path/to/packages/iris-dev-mcp/dist/index.js"], "env": { "IRIS_HOST": "localhost" } }
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
    cmd: node
    args: ["/path/to/packages/iris-dev-mcp/dist/index.js"]
    envs:
      IRIS_HOST: localhost
      IRIS_PORT: "52773"
      IRIS_USERNAME: _SYSTEM
      IRIS_PASSWORD: secret
      IRIS_NAMESPACE: USER
    enabled: true
```

## Cursor · Claude Desktop · Windsurf · Gemini CLI · Roo Code ⚠️

All use the standard `mcpServers` JSON shape shown in the Claude Code snippet — only the file path differs (see the matrix). Cursor and Claude Desktop have dedicated guides: **[cursor.md](cursor.md)**, **[claude-desktop.md](claude-desktop.md)**.

---

## Verifying

Ask the client to call `iris_server_profiles` — it returns every addressable profile with its `source` (`env` or `server-manager`), which is the fastest way to confirm both your base connection and any Server Manager import.

For Claude Code specifically, `claude mcp list` performs a health check per server.
