# @iris-mcp/all

**Meta-package that installs all five IRIS MCP server packages** with a single command.

Part of the [IRIS MCP Server Suite](../../README.md).

---

## What Is This?

`@iris-mcp/all` is a convenience meta-package. It contains no source code of its own -- it simply declares all five IRIS MCP servers as dependencies so you can install them in one step instead of five.

---

## Installation

```bash
npm install -g @iris-mcp/all
```

This installs all five servers:

| Package | Domain | Tools | Description |
|---------|--------|------:|-------------|
| [@iris-mcp/dev](../iris-dev-mcp/README.md) | Development | 23 | ObjectScript document CRUD, compilation, SQL, globals, code execution, unit tests, package browsing, bulk export |
| [@iris-mcp/admin](../iris-admin-mcp/README.md) | Administration | 22 | Namespace, database, user, role, resource, web-app, SSL/TLS, and OAuth2 management |
| [@iris-mcp/interop](../iris-interop-mcp/README.md) | Interoperability | 19 | Ensemble/Health Connect production lifecycle, credentials, lookups, rules, transforms |
| [@iris-mcp/ops](../iris-ops-mcp/README.md) | Operations & Monitoring | 16 | System metrics, jobs, locks, journals, mirrors, audit, database integrity, licensing, ECP, tasks |
| [@iris-mcp/data](../iris-data-mcp/README.md) | Data & Analytics | 7 | DocDB document database, DeepSee analytics (MDX/cubes), REST API management |

> **87 tools** across 5 servers.

---

## Configuration

All servers share the same environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `IRIS_HOST` | `localhost` | IRIS hostname or IP |
| `IRIS_PORT` | `52773` | IRIS web server port |
| `IRIS_USERNAME` | `_SYSTEM` | IRIS username |
| `IRIS_PASSWORD` | *(required)* | IRIS password |
| `IRIS_NAMESPACE` | `USER` | Default IRIS namespace |
| `IRIS_HTTPS` | `false` | Use HTTPS instead of HTTP |

---

## MCP Client Configuration

Each MCP server runs as a separate process. After installing `@iris-mcp/all`, configure your MCP client to launch each server you need.

### Claude Code (`.mcp.json`)

Create a `.mcp.json` file in your project root with all five servers:

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
        "IRIS_PASSWORD": "SYS",
        "IRIS_NAMESPACE": "USER"
      }
    },
    "iris-admin-mcp": {
      "command": "npx",
      "args": ["-y", "@iris-mcp/admin"],
      "env": {
        "IRIS_HOST": "localhost",
        "IRIS_PORT": "52773",
        "IRIS_USERNAME": "_SYSTEM",
        "IRIS_PASSWORD": "SYS",
        "IRIS_NAMESPACE": "USER"
      }
    },
    "iris-interop-mcp": {
      "command": "npx",
      "args": ["-y", "@iris-mcp/interop"],
      "env": {
        "IRIS_HOST": "localhost",
        "IRIS_PORT": "52773",
        "IRIS_USERNAME": "_SYSTEM",
        "IRIS_PASSWORD": "SYS",
        "IRIS_NAMESPACE": "USER"
      }
    },
    "iris-ops-mcp": {
      "command": "npx",
      "args": ["-y", "@iris-mcp/ops"],
      "env": {
        "IRIS_HOST": "localhost",
        "IRIS_PORT": "52773",
        "IRIS_USERNAME": "_SYSTEM",
        "IRIS_PASSWORD": "SYS",
        "IRIS_NAMESPACE": "USER"
      }
    },
    "iris-data-mcp": {
      "command": "npx",
      "args": ["-y", "@iris-mcp/data"],
      "env": {
        "IRIS_HOST": "localhost",
        "IRIS_PORT": "52773",
        "IRIS_USERNAME": "_SYSTEM",
        "IRIS_PASSWORD": "SYS",
        "IRIS_NAMESPACE": "USER"
      }
    }
  }
}
```

### Claude Desktop (`claude_desktop_config.json`)

Add all five servers to your Claude Desktop configuration using the same structure shown above.

> **Note:** Replace `"SYS"` with your actual IRIS password. Avoid committing real credentials to version control.

---

## Do I Need All Five?

If you only need a subset, install individual packages instead:

| Your Role | Recommended Server(s) |
|-----------|----------------------|
| **ObjectScript developer** | `@iris-mcp/dev` |
| **System administrator** | `@iris-mcp/admin` |
| **Integration engineer** | `@iris-mcp/interop` |
| **Operations / SRE** | `@iris-mcp/ops` |
| **Data / BI analyst** | `@iris-mcp/data` |
| **Full-stack / getting started** | `@iris-mcp/all` (this package) |

---

## Links

- [IRIS MCP Server Suite (root README)](../../README.md)
- [@iris-mcp/dev](../iris-dev-mcp/README.md)
- [@iris-mcp/admin](../iris-admin-mcp/README.md)
- [@iris-mcp/interop](../iris-interop-mcp/README.md)
- [@iris-mcp/ops](../iris-ops-mcp/README.md)
- [@iris-mcp/data](../iris-data-mcp/README.md)
