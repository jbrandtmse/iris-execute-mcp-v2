# Cursor Configuration

Connect the IRIS MCP Server Suite to [Cursor](https://cursor.com/).

---

## Config File Location

Cursor supports two scopes for MCP server configuration:

| Scope | Path | When to Use |
|-------|------|-------------|
| **Project** | `.cursor/mcp.json` in the project root | Shared with teammates via version control |
| **Global** | `~/.cursor/mcp.json` | Available in every project on your machine |

Both files use the same format.

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

Create `.cursor/mcp.json` in your project root (or `~/.cursor/mcp.json` for global access):

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

## Multiple Servers & Governance (optional)

Two optional environment variables let a single server target several IRIS instances and restrict tool actions per instance:

| Variable | Purpose |
|----------|---------|
| `IRIS_PROFILES` | JSON map of named IRIS instances. Each profile may set `host`, `port`, `username`, `password`, `namespace`, `https`; omitted fields inherit from the `default` profile (your `IRIS_*` vars). Tools take an optional `server` parameter (profile name) to pick the instance. |
| `IRIS_GOVERNANCE` | JSON policy that enables/disables tool actions, optionally per profile. Effective policy = `profile.explicit ?? global.explicit ?? defaultSeed` (existing + new-read enabled, new-write disabled). Blocked calls return a `GOVERNANCE_DISABLED` error. |

Both are **optional** — omit them for a single-server, fully-enabled install. See the [suite README](../../README.md#multiple-servers--governance) for the full model and worked examples.

> **Escaping matters.** The *value* of `IRIS_PROFILES` / `IRIS_GOVERNANCE` is a JSON string that lives inside `.cursor/mcp.json`, so every inner `"` must be escaped as `\"`. The block below is already correctly escaped — copy it as-is and edit the values.

```json
{
  "mcpServers": {
    "iris-admin-mcp": {
      "command": "npx",
      "args": ["-y", "@iris-mcp/admin"],
      "env": {
        "IRIS_HOST": "localhost",
        "IRIS_PORT": "52773",
        "IRIS_USERNAME": "_SYSTEM",
        "IRIS_PASSWORD": "your-password-here",
        "IRIS_NAMESPACE": "USER",
        "IRIS_HTTPS": "false",
        "IRIS_PROFILES": "{\"prod\":{\"host\":\"iris-prod.example.com\",\"port\":443,\"username\":\"svc_mcp\",\"password\":\"prod-password\",\"namespace\":\"HSCUSTOM\",\"https\":true},\"stage\":{\"host\":\"iris-stage.example.com\",\"namespace\":\"USER\"}}",
        "IRIS_GOVERNANCE": "{\"global\":{\"iris_backup_manage:run\":true},\"profiles\":{\"prod\":{\"iris_backup_manage:run\":false,\"iris_database_manage:delete\":false}}}"
      }
    }
  }
}
```

Un-escaped, the two values above are simply:

```jsonc
// IRIS_PROFILES
{
  "prod":  { "host": "iris-prod.example.com",  "port": 443,   "username": "svc_mcp", "password": "prod-password", "namespace": "HSCUSTOM", "https": true },
  "stage": { "host": "iris-stage.example.com", "namespace": "USER" }   // inherits port/username/password/https from default
}

// IRIS_GOVERNANCE — enable iris_backup_manage:run everywhere except the prod profile
{
  "global":   { "iris_backup_manage:run": true },
  "profiles": { "prod": { "iris_backup_manage:run": false, "iris_database_manage:delete": false } }
}
```

With this config, `iris_global_list({ server: "prod" })` runs against the prod instance, while `iris_backup_manage({ action: "run", server: "prod" })` is blocked. Omit `server` and the call uses the `default` profile from your `IRIS_*` vars — exactly as before.

---

## Read-only Mode + SQL Resource Caps (optional)

Point a server at production in **read-only mode** with one environment variable — no `IRIS_GOVERNANCE` JSON required:

| Variable | Purpose |
|----------|---------|
| `IRIS_GOVERNANCE_PRESET` | `"read-only"` blocks every write-classified tool action (suite-wide) while every read keeps working; `"full"` is an explicit alias for today's behavior. An explicit `IRIS_GOVERNANCE` override still wins over the preset. Omit for today's behavior. |
| `IRIS_SQL_MAX_ROWS` | Optional positive integer — a hard cap on `iris_sql_execute`'s effective row limit, independent of the preset. The response carries `rowsCapped: true` when it clamps a caller's request. Omit for no cap. |
| `IRIS_SQL_TIMEOUT` | Optional positive number of **seconds** — a per-request timeout override for `iris_sql_execute`. Omit to use the connection's default timeout. |

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
        "IRIS_HTTPS": "false",
        "IRIS_GOVERNANCE_PRESET": "read-only",
        "IRIS_SQL_MAX_ROWS": "1000",
        "IRIS_SQL_TIMEOUT": "30"
      }
    }
  }
}
```

All three are **optional** and apply to every server the same way (`IRIS_GOVERNANCE_PRESET` is framework configuration, not a tool; `IRIS_SQL_MAX_ROWS`/`IRIS_SQL_TIMEOUT` govern `iris_sql_execute` specifically, which ships on `@iris-mcp/dev`). See the [suite README](../../README.md#read-only-mode-point-it-at-production-with-one-environment-variable) for the full model.

---

## Audit Log (optional)

Three optional environment variables turn on a secrets-free, structured JSONL log of every MCP tool call — useful for regulated (e.g. healthcare) deployments that need to answer "what did the AI do?":

| Variable | Purpose |
|----------|---------|
| `IRIS_AUDIT_LOG` | **Optional.** Absolute path to a JSONL audit file. Unset (the default) = OFF, a mechanical no-op — no file, no `fs` writes. Setting it enables auditing for every tool call across all five servers. |
| `IRIS_AUDIT_LOG_MAX_MB` | **Optional**, default `50`. Rotates the audit file at this size (`<path>` → `<path>.1`, single generation). Only relevant when `IRIS_AUDIT_LOG` is set. |
| `IRIS_AUDIT_LOG_PARAMS` | **Optional**, default `false`. When `true`, entries also include each call's redacted parameter values; the default logs parameter key names only (safest). Only relevant when `IRIS_AUDIT_LOG` is set. |

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
        "IRIS_HTTPS": "false",
        "IRIS_AUDIT_LOG": "/var/log/iris-mcp/audit.jsonl"
      }
    }
  }
}
```

This is server **configuration**, not a governed tool — there is no `IRIS_GOVERNANCE` key for it, and it cannot be disabled by an AI client operating through the MCP protocol. See [Compliance & Auditability](../../README.md#compliance--auditability) in the suite README for the entry format, redaction guarantee, and the disambiguation from the IRIS-native `iris_audit_manage`/`iris_audit_events` security-audit tools.

---

## Setting Environment Variables

The recommended approach is to include `env` values directly in the JSON config (shown above). Cursor passes them to the spawned process.

Alternatively, set variables in your shell profile so they are inherited by all processes:

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

## Cursor Settings UI

You can also add MCP servers through Cursor's settings UI:

1. Open **Settings** (`Ctrl+,` / `Cmd+,`)
2. Search for **"MCP"**
3. Click **"Add MCP Server"**
4. Enter the server name (e.g., `iris-dev-mcp`) and the command/args/env from the examples above

This writes to the same `.cursor/mcp.json` file.

---

## Verification

After saving the config, restart Cursor (or reload the window). Then ask the AI assistant:

> "List the IRIS namespaces" (requires `@iris-mcp/admin`)

or

> "Show me the globals in the USER namespace" (requires `@iris-mcp/dev`)

If the server starts successfully, the assistant will display results from your IRIS instance.

---

## See Also

- [Per-package tool references](../../packages/) -- each package README lists all available tools
- [Migration guide (v1 to v2)](../migration-v1-v2.md)
- [Suite-level README](../../README.md)
