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
| [@iris-mcp/dev](../iris-dev-mcp/README.md) | Development | 28 | ObjectScript document CRUD, compilation, SQL, globals, code execution, unit tests, package browsing, bulk export, macro-expanded routine lookup, SQL query analysis and performance advisories, lines-of-code metrics, cross-profile environment diff & promotion |
| [@iris-mcp/admin](../iris-admin-mcp/README.md) | Administration | 26 | Namespace, database, user, role, resource (incl. SQL privileges), web-app, SSL/TLS, OAuth2, service, LDAP, X.509, and audit management |
| [@iris-mcp/interop](../iris-interop-mcp/README.md) | Interoperability | 22 | Ensemble/Health Connect production lifecycle, production item management, system default settings, credentials, lookups, rules, transforms, message-trace Mermaid diagrams, message resend/replay |
| [@iris-mcp/ops](../iris-ops-mcp/README.md) | Operations & Monitoring | 21 | Composite health check (`iris_health_check`), system metrics, jobs, locks, journals, mirrors, audit, database integrity, licensing, ECP, tasks, alert management, process control, database maintenance operations, backups |
| [@iris-mcp/data](../iris-data-mcp/README.md) | Data & Analytics | 7 | DocDB document database, DeepSee analytics (MDX/cubes), REST API management |

> **104 tools** across 5 servers. Each server additionally provides the framework tool `iris_server_profiles` (so each advertises one more than its package total).

### Discover profiles & policy first

Every server provides a framework tool, **`iris_server_profiles`** — call it **first** to discover the configured server-profile roster (non-secret connection metadata; the `password` is never included) and the effective governance policy (which actions are enabled/disabled), so a client can pick the right `server` profile and avoid disabled actions without reading config files. It is a **read tool, enabled by default**, reports in-memory config, and does not connect to IRIS. The same guidance is surfaced via the MCP server `instructions` field at connect time. Details: [Discovering profiles and policy](../../README.md#discovering-profiles-and-policy-call-this-first).

### Tool Visibility (`IRIS_TOOLS_PRESET`)

Every server in this suite supports `IRIS_TOOLS_PRESET`/`IRIS_TOOLS_DISABLE`/`IRIS_TOOLS_ENABLE` to trim what it advertises on `tools/list` — orthogonal to governance (visibility = does the agent know a tool exists; governance = is an already-visible call allowed). `core` is the small-model everyday subset (≤13 runtime tools per server); `developer` hides security & enterprise administration. Default (`full`, unset) is today's behavior for every server, byte-for-byte.

| Server | full (runtime) | core (runtime) | developer (runtime) |
|---|:---:|:---:|:---:|
| `@iris-mcp/dev` | 29 | 13 | 29 |
| `@iris-mcp/admin` | 27 | 13 | 11 |
| `@iris-mcp/interop` | 23 | 10 | 23 |
| `@iris-mcp/ops` | 22 | 10 | 10 |
| `@iris-mcp/data` | 8 | 8 | 8 |

Full model, per-server per-tool rosters, and the measured `tools/list` payload-size win: [Tool Visibility Presets](../../README.md#tool-visibility-presets) in the suite README.

### Audit Logging (`IRIS_AUDIT_LOG`)

Every server in this suite supports the opt-in, secrets-free tool-call audit log: set `IRIS_AUDIT_LOG=/path/to/audit.jsonl` (plus optional `IRIS_AUDIT_LOG_MAX_MB` / `IRIS_AUDIT_LOG_PARAMS`) to record **every MCP tool call — success, error, or governance denial — as JSONL, across all five servers**. Off by default (unset ⇒ a mechanical no-op); it is server-side configuration an AI client cannot switch off, and is distinct from IRIS's own `iris_audit_*` security-audit tools. Full details: [Compliance & Auditability](../../README.md#compliance--auditability) in the suite README.

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

### Multiple servers & the `server` parameter

Optionally, set `IRIS_PROFILES` (a JSON map of named IRIS instances) and `IRIS_GOVERNANCE` (a JSON tool-action policy) to target several instances from one server and restrict which actions are allowed. Every tool across all five servers accepts an optional `server` parameter (a profile name from `IRIS_PROFILES`) that selects which instance the call targets; omit it to use the `default` profile. It composes with the existing per-call `namespace` override. Both variables are **optional and additive** — omit them and the servers behave exactly as single-instance, fully-enabled installs. Full model, escaping, and worked examples: [Multiple Servers & Governance](../../README.md#multiple-servers--governance).

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
