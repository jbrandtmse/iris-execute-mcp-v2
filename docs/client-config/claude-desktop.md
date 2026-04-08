# Claude Desktop Configuration

Connect the IRIS MCP Server Suite to [Claude Desktop](https://claude.ai/download).

---

## Config File Location

| OS | Path |
|----|------|
| **macOS** | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Windows** | `%APPDATA%\Claude\claude_desktop_config.json` |
| **Linux** | `~/.config/Claude/claude_desktop_config.json` |

> If the file does not exist, create it. Claude Desktop reads it on startup.

---

## Environment Variables

All five servers share the same environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `IRIS_HOST` | No | `localhost` | IRIS hostname or IP address |
| `IRIS_PORT` | No | `52773` | IRIS web server port (not the SuperServer port 1972) |
| `IRIS_USERNAME` | No | `_SYSTEM` | IRIS username |
| `IRIS_PASSWORD` | **Yes** | -- | IRIS password |
| `IRIS_NAMESPACE` | No | `USER` | Default IRIS namespace |
| `IRIS_HTTPS` | No | `false` | Set to `true` to connect over HTTPS |

> **Security:** Never commit real passwords to version control. Use a placeholder like `your-password-here` in shared configs and replace it locally.

---

## Single Server Example

Add the development server (`@iris-mcp/dev`) to Claude Desktop:

```json
{
  "mcpServers": {
    "iris-dev-mcp": {
      "command": "npx",
      "args": ["-y", "@iris-mcp/dev"],
      "env": {
        "IRIS_HOST": "localhost",
        "IRIS_PORT": "52773",
        "IRIS_USERNAME": "_SYSTEM",
        "IRIS_PASSWORD": "your-password-here",
        "IRIS_NAMESPACE": "USER",
        "IRIS_HTTPS": "false"
      }
    }
  }
}
```

To use a different server, swap the package name in `args`:

| Server | `args` value |
|--------|-------------|
| Development | `["-y", "@iris-mcp/dev"]` |
| Administration | `["-y", "@iris-mcp/admin"]` |
| Interoperability | `["-y", "@iris-mcp/interop"]` |
| Operations | `["-y", "@iris-mcp/ops"]` |
| Data & Analytics | `["-y", "@iris-mcp/data"]` |

---

## All Five Servers

To register every server at once, add all five entries under `mcpServers`. Each server gets its own `env` block so you can point them at different IRIS instances if needed -- or use the same values across all of them.

```json
{
  "mcpServers": {
    "iris-dev-mcp": {
      "command": "npx",
      "args": ["-y", "@iris-mcp/dev"],
      "env": {
        "IRIS_HOST": "localhost",
        "IRIS_PORT": "52773",
        "IRIS_USERNAME": "_SYSTEM",
        "IRIS_PASSWORD": "your-password-here",
        "IRIS_NAMESPACE": "USER",
        "IRIS_HTTPS": "false"
      }
    },
    "iris-admin-mcp": {
      "command": "npx",
      "args": ["-y", "@iris-mcp/admin"],
      "env": {
        "IRIS_HOST": "localhost",
        "IRIS_PORT": "52773",
        "IRIS_USERNAME": "_SYSTEM",
        "IRIS_PASSWORD": "your-password-here",
        "IRIS_NAMESPACE": "USER",
        "IRIS_HTTPS": "false"
      }
    },
    "iris-interop-mcp": {
      "command": "npx",
      "args": ["-y", "@iris-mcp/interop"],
      "env": {
        "IRIS_HOST": "localhost",
        "IRIS_PORT": "52773",
        "IRIS_USERNAME": "_SYSTEM",
        "IRIS_PASSWORD": "your-password-here",
        "IRIS_NAMESPACE": "USER",
        "IRIS_HTTPS": "false"
      }
    },
    "iris-ops-mcp": {
      "command": "npx",
      "args": ["-y", "@iris-mcp/ops"],
      "env": {
        "IRIS_HOST": "localhost",
        "IRIS_PORT": "52773",
        "IRIS_USERNAME": "_SYSTEM",
        "IRIS_PASSWORD": "your-password-here",
        "IRIS_NAMESPACE": "USER",
        "IRIS_HTTPS": "false"
      }
    },
    "iris-data-mcp": {
      "command": "npx",
      "args": ["-y", "@iris-mcp/data"],
      "env": {
        "IRIS_HOST": "localhost",
        "IRIS_PORT": "52773",
        "IRIS_USERNAME": "_SYSTEM",
        "IRIS_PASSWORD": "your-password-here",
        "IRIS_NAMESPACE": "USER",
        "IRIS_HTTPS": "false"
      }
    }
  }
}
```

---

## Setting Environment Variables

The recommended approach is to put `env` values directly in the JSON config (shown above). Claude Desktop passes them to the spawned process automatically.

If you prefer system-level environment variables instead, you can omit the `env` block entirely and set the variables in your shell profile:

**macOS / Linux (`.zshrc` or `.bashrc`):**

```bash
export IRIS_HOST=localhost
export IRIS_PORT=52773
export IRIS_USERNAME=_SYSTEM
export IRIS_PASSWORD=your-password-here
export IRIS_NAMESPACE=USER
export IRIS_HTTPS=false
```

**Windows (PowerShell profile or System Environment Variables):**

```powershell
$env:IRIS_HOST = "localhost"
$env:IRIS_PORT = "52773"
$env:IRIS_USERNAME = "_SYSTEM"
$env:IRIS_PASSWORD = "your-password-here"
$env:IRIS_NAMESPACE = "USER"
$env:IRIS_HTTPS = "false"
```

> When both `env` in the config and system environment variables are set, the config values take precedence.

---

## Verification

After saving the config file, restart Claude Desktop. Then ask:

> "List the IRIS namespaces" (requires `@iris-mcp/admin`)

or

> "Show me the globals in the USER namespace" (requires `@iris-mcp/dev`)

If the server starts successfully, Claude will display results from your IRIS instance.

---

## See Also

- [Per-package tool references](../../packages/) -- each package README lists all available tools
- [Migration guide (v1 to v2)](../migration-v1-v2.md)
- [Suite-level README](../../README.md)
