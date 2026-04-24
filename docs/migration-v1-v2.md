# Migration Guide: v1 to v2

Migrate from **iris-execute-mcp** (v1) or **mcp-server-iris** (CaretDev v1) to the **iris-mcp v2** suite.

---

## Why v2?

The original `iris-execute-mcp` provided 8 development tools over a Python/SuperServer connection. The v2 rewrite brings:

- **88 tools** across 5 specialized MCP servers (up from 8 in a single server)
- **Node.js/TypeScript** runtime instead of Python
- **HTTP/REST connection** via the Atelier API instead of the IRIS SuperServer binary protocol
- **Auto-bootstrap**: IRIS helper classes install automatically on first connection -- no manual import or compile step
- **Monorepo architecture** with shared infrastructure and per-domain packages

Both v1 projects (`iris-execute-mcp` by jbrandtmse and `mcp-server-iris` by CaretDev) are still functional. This guide simply shows the upgrade path; nothing is deprecated.

---

## Breaking Changes

| Area | v1 | v2 |
|------|----|----|
| **Connection** | SuperServer port `1972` (native IRIS binary protocol) | Web port `52773` (HTTP/HTTPS via Atelier REST API) |
| **Runtime** | Python (FastMCP / uvx) | Node.js / TypeScript (npx) |
| **Installation** | `pip install` / venv / `uvx` | `npx -y @iris-mcp/<package>` (no install step) |
| **Tool naming** | `execute_command`, `get_global`, etc. | Dot-namespaced: `iris.execute.command`, `iris.global.get`, etc. |
| **Architecture** | Single server, 8 tools | 5 servers, 88 tools total |
| **IRIS classes** | `ExecuteMCP.*` (manual import required) | `ExecuteMCPv2.*` (auto-bootstrapped on first connection) |
| **Env var: host** | `IRIS_HOSTNAME` | `IRIS_HOST` |
| **Env var: port** | `IRIS_PORT` = `1972` (SuperServer) | `IRIS_PORT` = `52773` (web server) |
| **New env var** | -- | `IRIS_HTTPS` (default `false`) |

### Unchanged

- `IRIS_NAMESPACE` -- same name, same behavior
- `IRIS_USERNAME` -- same name, same behavior
- `IRIS_PASSWORD` -- same name, same behavior
- The `namespace` parameter is available on every v2 tool, preserving v1's namespace-aware behavior

---

## Environment Variable Mapping

| v1 Variable | v2 Variable | Notes |
|-------------|-------------|-------|
| `IRIS_HOSTNAME` | `IRIS_HOST` | Renamed (drop the "NAME") |
| `IRIS_PORT` | `IRIS_PORT` | **Value changes**: `1972` (SuperServer) becomes `52773` (web port) |
| `IRIS_NAMESPACE` | `IRIS_NAMESPACE` | No change |
| `IRIS_USERNAME` | `IRIS_USERNAME` | No change |
| `IRIS_PASSWORD` | `IRIS_PASSWORD` | No change |
| -- | `IRIS_HTTPS` | New in v2. Set to `true` if your IRIS web server uses HTTPS. Default: `false` |

---

## Tool Mapping: iris-execute-mcp (v1) to v2

Every v1 tool has a direct equivalent in the `@iris-mcp/dev` package:

| v1 Tool | v2 Tool | v2 Package | Notes |
|---------|---------|------------|-------|
| `execute_command` | `iris.execute.command` | `@iris-mcp/dev` | Same functionality |
| `execute_classmethod` | `iris.execute.classmethod` | `@iris-mcp/dev` | Same functionality |
| `get_global` | `iris.global.get` | `@iris-mcp/dev` | Same functionality |
| `set_global` | `iris.global.set` | `@iris-mcp/dev` | Same functionality |
| `get_system_info` | `iris.server.info` | `@iris-mcp/dev` | Renamed |
| `compile_objectscript_class` | `iris.doc.compile` | `@iris-mcp/dev` | Pass class name(s) |
| `compile_objectscript_package` | `iris.doc.compile` | `@iris-mcp/dev` | Same tool -- pass package name |
| `execute_unit_tests` | `iris.execute.tests` | `@iris-mcp/dev` | Same functionality |

### Additional v2 tools in @iris-mcp/dev (no v1 equivalent)

v2 adds many tools that had no v1 counterpart:

- `iris.doc.get`, `iris.doc.put`, `iris.doc.delete`, `iris.doc.list` -- document CRUD via Atelier API
- `iris.doc.load` -- bulk load `.cls` / `.mac` files from disk
- `iris.doc.index`, `iris.doc.search` -- code intelligence and search
- `iris.doc.convert`, `iris.doc.xml_export` -- format conversion
- `iris.sql.execute` -- direct SQL execution
- `iris.server.namespace` -- namespace listing
- `iris.global.kill`, `iris.global.list` -- additional global operations
- `iris.macro.info` -- macro lookup

---

## Tool Mapping: mcp-server-iris (CaretDev v1) to v2

The CaretDev `mcp-server-iris` also connects via SuperServer port 1972 with Python. Its tools map to various v2 packages depending on domain. The CaretDev server provides general IRIS interaction capabilities; the v2 suite covers the same ground and more across its 5 specialized servers:

| v2 Package | Domain | Tool Count |
|------------|--------|------------|
| `@iris-mcp/dev` | Development, compilation, execution, globals, SQL, package browsing, bulk export, macro-expanded routine lookup | 24 |
| `@iris-mcp/admin` | Namespaces, databases, users, roles, security, web apps, SSL, OAuth | 22 |
| `@iris-mcp/interop` | Interoperability productions, credentials, lookups, rules, transforms | 19 |
| `@iris-mcp/ops` | Metrics, jobs, locks, journals, mirrors, tasks, config, auditing | 16 |
| `@iris-mcp/data` | DocDB, analytics/MDX, REST API management | 7 |

If you were using `mcp-server-iris` for ObjectScript execution and SQL, the `@iris-mcp/dev` package covers those needs. For administration tasks, add `@iris-mcp/admin`. Install only the packages you need.

---

## Configuration Migration

### v1 Config (iris-execute-mcp)

```json
{
  "mcpServers": {
    "iris-execute-mcp": {
      "type": "stdio",
      "command": "C:/iris-execute-mcp/venv/Scripts/python.exe",
      "args": ["C:/iris-execute-mcp/iris_execute_mcp.py"],
      "env": {
        "IRIS_HOSTNAME": "localhost",
        "IRIS_PORT": "1972",
        "IRIS_NAMESPACE": "HSCUSTOM",
        "IRIS_USERNAME": "_SYSTEM",
        "IRIS_PASSWORD": "SYS"
      }
    }
  }
}
```

### v1 Config (mcp-server-iris / CaretDev)

```json
{
  "mcpServers": {
    "iris": {
      "command": "uvx",
      "args": ["mcp-server-iris"],
      "env": {
        "IRIS_HOSTNAME": "localhost",
        "IRIS_PORT": "1972",
        "IRIS_NAMESPACE": "USER",
        "IRIS_USERNAME": "_SYSTEM",
        "IRIS_PASSWORD": "SYS"
      }
    }
  }
}
```

### v2 Config (equivalent -- dev server only)

```json
{
  "mcpServers": {
    "iris-dev-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@iris-mcp/dev"],
      "env": {
        "IRIS_HOST": "localhost",
        "IRIS_PORT": "52773",
        "IRIS_NAMESPACE": "HSCUSTOM",
        "IRIS_USERNAME": "_SYSTEM",
        "IRIS_PASSWORD": "SYS",
        "IRIS_HTTPS": "false"
      }
    }
  }
}
```

### v2 Config (all five servers)

```json
{
  "mcpServers": {
    "iris-dev-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@iris-mcp/dev"],
      "env": {
        "IRIS_HOST": "localhost",
        "IRIS_PORT": "52773",
        "IRIS_NAMESPACE": "HSCUSTOM",
        "IRIS_USERNAME": "_SYSTEM",
        "IRIS_PASSWORD": "SYS",
        "IRIS_HTTPS": "false"
      }
    },
    "iris-admin-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@iris-mcp/admin"],
      "env": {
        "IRIS_HOST": "localhost",
        "IRIS_PORT": "52773",
        "IRIS_NAMESPACE": "HSCUSTOM",
        "IRIS_USERNAME": "_SYSTEM",
        "IRIS_PASSWORD": "SYS",
        "IRIS_HTTPS": "false"
      }
    },
    "iris-interop-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@iris-mcp/interop"],
      "env": {
        "IRIS_HOST": "localhost",
        "IRIS_PORT": "52773",
        "IRIS_NAMESPACE": "HSCUSTOM",
        "IRIS_USERNAME": "_SYSTEM",
        "IRIS_PASSWORD": "SYS",
        "IRIS_HTTPS": "false"
      }
    },
    "iris-ops-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@iris-mcp/ops"],
      "env": {
        "IRIS_HOST": "localhost",
        "IRIS_PORT": "52773",
        "IRIS_NAMESPACE": "HSCUSTOM",
        "IRIS_USERNAME": "_SYSTEM",
        "IRIS_PASSWORD": "SYS",
        "IRIS_HTTPS": "false"
      }
    },
    "iris-data-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@iris-mcp/data"],
      "env": {
        "IRIS_HOST": "localhost",
        "IRIS_PORT": "52773",
        "IRIS_NAMESPACE": "HSCUSTOM",
        "IRIS_USERNAME": "_SYSTEM",
        "IRIS_PASSWORD": "SYS",
        "IRIS_HTTPS": "false"
      }
    }
  }
}
```

**Key changes to note in the config:**

1. `command` changes from a Python path to `npx`
2. `args` changes from a script path to `["-y", "@iris-mcp/<package>"]`
3. `IRIS_HOSTNAME` becomes `IRIS_HOST`
4. `IRIS_PORT` value changes from `1972` to `52773`
5. New `IRIS_HTTPS` variable (set to `"true"` if using HTTPS)

---

## Namespace Behavior

The `namespace` parameter is preserved in v2. Every v2 tool accepts an optional `namespace` parameter that overrides the `IRIS_NAMESPACE` environment variable for that call. This matches v1 behavior where the namespace was set globally via environment and used for all operations.

If you relied on switching namespaces in v1, the same pattern works in v2 -- just pass `namespace` to any tool call.

---

## Uninstalling v1 Packages

### iris-execute-mcp (Python/venv)

```bash
# Remove the virtual environment and cloned repo
rm -rf C:/iris-execute-mcp

# Or if installed via pip in a venv:
deactivate
rm -rf /path/to/iris-execute-mcp/venv
```

Remove the `iris-execute-mcp` entry from your MCP client configuration (e.g., Cline's `settings.json` or Claude Desktop's `claude_desktop_config.json`).

### mcp-server-iris (CaretDev / uvx)

```bash
# If installed via pip:
pip uninstall mcp-server-iris

# If using uvx, simply remove the config entry -- uvx downloads on demand
```

Remove the `iris` (or `mcp-server-iris`) entry from your MCP client configuration.

### IRIS Classes (Optional)

v1 installed `ExecuteMCP.*` classes on the IRIS server. These can be removed if no longer needed:

```objectscript
Do $System.OBJ.DeletePackage("ExecuteMCP")
```

v2 uses `ExecuteMCPv2.*` classes that are auto-bootstrapped. They do not conflict with v1 classes, so removal is optional.

---

## FAQ

### Can I run v1 and v2 side by side?

Yes. The v1 and v2 servers use different connection protocols (SuperServer vs. HTTP), different tool names, and different IRIS class packages. They can coexist in your MCP client configuration without conflict.

### Do I need to install anything on the IRIS server for v2?

No. v2 auto-bootstraps its `ExecuteMCPv2.*` helper classes on first connection. No manual import or compile step is needed. The only prerequisite is that the IRIS web server is enabled on port 52773 (or your configured port) and the `/api/atelier/` web application is available (enabled by default in IRIS).

### My v1 scripts reference tool names like `execute_command`. Will they break?

Yes, v2 uses dot-namespaced tool names (e.g., `iris.execute.command`). You will need to update any automation or prompts that reference v1 tool names. See the [Tool Mapping](#tool-mapping-iris-execute-mcp-v1-to-v2) section above for the complete mapping.

### What about the DirectTestRunner performance improvements from v1?

v2's `iris.execute.tests` tool provides the same fast test execution. The `ExecuteMCPv2.TestRunner` class is auto-bootstrapped and provides equivalent performance to v1's DirectTestRunner.

### I only need development tools. Do I need all five v2 servers?

No. Install only the packages you need. For a direct replacement of v1's 8 tools, `@iris-mcp/dev` alone is sufficient. Add other packages as needed for administration, interoperability, operations, or data tasks.

### Does v2 support the same IRIS versions as v1?

v2 requires IRIS 2023.1 or later with the Atelier REST API enabled (available by default). v1 required IRIS 2024.3+ due to its SuperServer protocol dependency. In practice, v2 has broader IRIS version compatibility.

### Where do I report issues?

v2 issues: [github.com/jbrandtmse/iris-execute-mcp-v2/issues](https://github.com/jbrandtmse/iris-execute-mcp-v2/issues)
