# IRIS MCP Server Suite

> **Pre-Release** — This project is under active development and has not yet been published to npm or IPM. Install by cloning the repository (see [Quick Start](#quick-start) below). Package registry publishing is planned for a future release. See [CHANGELOG.md](CHANGELOG.md) for the 2026-04-19 bug-fix pass (six defects found during a manual MCP suite retest) and the 2026-04-09 pre-release breaking change to tool names.

**Give AI assistants structured, safe access to InterSystems IRIS.**

The IRIS MCP Server Suite is a collection of five specialized [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) servers that let AI coding assistants — Claude, Copilot, Cursor, and others — work directly with InterSystems IRIS. Each server covers a distinct operational domain so you can install only what you need.

---

## Servers

| Package | Domain | Tools | Description |
|---------|--------|------:|-------------|
| [@iris-mcp/dev](packages/iris-dev-mcp/README.md) | Development | 24 | ObjectScript document CRUD, compilation, SQL, globals, code execution, unit tests, package browsing, bulk export, macro-expanded routine lookup |
| [@iris-mcp/admin](packages/iris-admin-mcp/README.md) | Administration | 26 | Namespace, database, user, role, resource (incl. SQL privileges), web-app, SSL/TLS, OAuth2, service, LDAP, X.509, and audit management |
| [@iris-mcp/interop](packages/iris-interop-mcp/README.md) | Interoperability | 19 | Ensemble/Health Connect production lifecycle, credentials, lookups, rules, transforms |
| [@iris-mcp/ops](packages/iris-ops-mcp/README.md) | Operations & Monitoring | 20 | System metrics, jobs, locks, journals, mirrors, audit, database integrity, licensing, ECP, tasks, alert management, process control, database maintenance operations, backups |
| [@iris-mcp/data](packages/iris-data-mcp/README.md) | Data & Analytics | 7 | DocDB document database, DeepSee analytics (MDX/cubes), REST API management |

> **96 tools** across 5 servers — install one or all.

### Meta-package

Once published, all servers will be installable at once with `npm install -g @iris-mcp/all`. See the [meta-package README](packages/iris-mcp-all/README.md) for details.

---

## Which Server Do I Need?

| Your Role | Recommended Server(s) |
|-----------|----------------------|
| **ObjectScript developer** | `@iris-mcp/dev` — compile, edit, execute code, run SQL, manage globals |
| **System administrator** | `@iris-mcp/admin` — manage namespaces, databases, users, roles, web apps, SSL, OAuth |
| **Integration engineer** | `@iris-mcp/interop` — control productions, configure credentials, manage business rules and transforms |
| **Operations / SRE** | `@iris-mcp/ops` — monitor metrics, inspect jobs and locks, review journals, audit events, manage tasks |
| **Data / BI analyst** | `@iris-mcp/data` — query DocDB collections, run MDX against DeepSee cubes, manage REST APIs |
| **Full-stack / getting started** | `@iris-mcp/dev` + `@iris-mcp/admin`, or all five servers |

---

## Prerequisites

- **Node.js** 18 or later
- **InterSystems IRIS** 2023.1 or later (including IRIS for Health, HealthShare)
- **IRIS web port** accessible (default `52773`)

---

## Quick Start

Until packages are published to npm, install by cloning the repository and building from source.

### 1. Clone and Build

```bash
git clone https://github.com/jbrandtmse/iris-execute-mcp-v2.git
cd iris-execute-mcp-v2
pnpm install
pnpm turbo run build
```

> **Requires:** [Node.js](https://nodejs.org/) 18+ and [pnpm](https://pnpm.io/) 9+. Install pnpm with `npm install -g pnpm` if needed.

### 2. Set Environment Variables

All servers use the same environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `IRIS_HOST` | `localhost` | IRIS hostname or IP |
| `IRIS_PORT` | `52773` | IRIS web server port |
| `IRIS_USERNAME` | `_SYSTEM` | IRIS username |
| `IRIS_PASSWORD` | *(required)* | IRIS password |
| `IRIS_NAMESPACE` | `USER` | Default IRIS namespace |
| `IRIS_HTTPS` | `false` | Use HTTPS instead of HTTP |
| `IRIS_PROFILES` | *(unset)* | **Optional.** JSON map of named IRIS instances for multi-server use. Omit for single-server — the `IRIS_*` vars above define the reserved `default` profile. See [Multiple Servers & Governance](#multiple-servers--governance). |
| `IRIS_GOVERNANCE` | *(unset)* | **Optional.** JSON policy that enables/disables individual tool actions per profile. Omit to leave every tool enabled (today's behavior). See [Multiple Servers & Governance](#multiple-servers--governance). |

> **Single-server installs need no changes.** `IRIS_PROFILES` and `IRIS_GOVERNANCE` are both optional and additive. With neither set, the suite behaves exactly as it always has — the six `IRIS_*` variables above are all you need.

### 3. Configure Your MCP Client

Point your MCP client at the built server using `node` and the local `dist/index.js` path. Replace `/path/to/iris-execute-mcp-v2` with the actual path where you cloned the repo.

#### Claude Code (`.mcp.json`)

Create a `.mcp.json` file in your project root:

```json
{
  "mcpServers": {
    "iris-dev-mcp": {
      "command": "node",
      "args": ["/path/to/iris-execute-mcp-v2/packages/iris-dev-mcp/dist/index.js"],
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

> **Note:** Replace `"SYS"` with your actual IRIS password. Avoid committing real credentials to version control.

#### Claude Desktop (`claude_desktop_config.json`)

Add to your Claude Desktop configuration:

```json
{
  "mcpServers": {
    "iris-dev-mcp": {
      "command": "node",
      "args": ["/path/to/iris-execute-mcp-v2/packages/iris-dev-mcp/dist/index.js"],
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

To add more servers, include additional entries under `mcpServers` using the same pattern. For example, to add admin tools:

```json
{
  "mcpServers": {
    "iris-dev-mcp": {
      "command": "node",
      "args": ["/path/to/iris-execute-mcp-v2/packages/iris-dev-mcp/dist/index.js"],
      "env": { "IRIS_PASSWORD": "SYS" }
    },
    "iris-admin-mcp": {
      "command": "node",
      "args": ["/path/to/iris-execute-mcp-v2/packages/iris-admin-mcp/dist/index.js"],
      "env": { "IRIS_PASSWORD": "SYS" }
    }
  }
}
```

**All server entry points:**

| Server | Path (relative to repo root) |
|--------|------------------------------|
| dev | `packages/iris-dev-mcp/dist/index.js` |
| admin | `packages/iris-admin-mcp/dist/index.js` |
| interop | `packages/iris-interop-mcp/dist/index.js` |
| ops | `packages/iris-ops-mcp/dist/index.js` |
| data | `packages/iris-data-mcp/dist/index.js` |

### 4. Verify

Ask your AI assistant:

> "List the IRIS namespaces" (with `@iris-mcp/admin`)

or

> "Show me the globals in the USER namespace" (with `@iris-mcp/dev`)

If the assistant returns results from your IRIS instance, you are connected.

---

## Multiple Servers & Governance

Two optional environment variables — `IRIS_PROFILES` and `IRIS_GOVERNANCE` — let one MCP server process target **several IRIS instances** and **restrict which tool actions are allowed** per instance. Both are JSON values set in your MCP client's `env` block (no external files). **Neither is required**: with both unset, the suite behaves exactly as a single-server, fully-enabled install (see [Backward Compatibility](#backward-compatibility) below).

> **Where to put the escaped JSON:** because `IRIS_PROFILES`/`IRIS_GOVERNANCE` are JSON *strings* that live inside your client's JSON config, the inner quotes must be escaped. See the per-client guides for copy-pasteable, correctly-escaped blocks: [Claude Code](docs/client-config/claude-code.md), [Claude Desktop](docs/client-config/claude-desktop.md), [Cursor](docs/client-config/cursor.md).

### Profiles (`IRIS_PROFILES`)

A **profile** is a named IRIS instance — a host, port, and credentials. `IRIS_PROFILES` is a JSON object keyed by profile name:

```json
{
  "prod":  { "host": "iris-prod.example.com",  "port": 443,   "username": "svc_mcp", "password": "...", "namespace": "HSCUSTOM", "https": true },
  "stage": { "host": "iris-stage.example.com", "port": 52773, "username": "svc_mcp", "password": "...", "namespace": "USER" }
}
```

Each profile may carry `host`, `port`, `username`, `password`, `namespace`, and `https`. **Omitted fields are inherited** from the reserved `default` profile (which is synthesized from your `IRIS_HOST` / `IRIS_PORT` / `IRIS_USERNAME` / `IRIS_PASSWORD` / `IRIS_NAMESPACE` / `IRIS_HTTPS` variables). So a profile that only overrides the host inherits the rest of the default's connection settings.

**Selecting a profile per call.** Every tool gains an optional `server` parameter that carries **only the profile name** — credentials never travel over the wire, they stay in the server process. Omit `server` and the call runs against the `default` profile (today's behavior).

`server` and the existing per-call `namespace` parameter compose cleanly: **`server` picks the instance, `namespace` picks the namespace within it.** For example, `iris_global_list({ server: "prod", namespace: "%SYS" })` lists globals in `%SYS` on the `prod` instance, regardless of `prod`'s default namespace.

### Governance (`IRIS_GOVERNANCE`)

`IRIS_GOVERNANCE` is a JSON policy that enables or disables individual tool **actions**, optionally per profile. It has a `global` baseline and per-`profiles` overrides:

```json
{
  "global":   { "<tool>": true, "<tool>:<action>": false },
  "profiles": { "prod": { "<tool>:<action>": false } }
}
```

A governance **key** is the tool name for single-operation tools (e.g. `iris_metrics_system`) or `tool:action` for multi-action tools (e.g. `iris_database_manage:delete`). The value is a boolean: `true` = allowed, `false` = blocked.

**Effective policy** for a given action on a given profile resolves in this order:

```
effective = profile.explicit(key) ?? global.explicit(key) ?? defaultSeed(key)
```

That is: a per-profile setting wins; otherwise the global setting; otherwise the **default seed**.

**The default seed** (what happens when neither `global` nor `profiles` mentions a key):

- Every **existing** tool action (everything shipped before governance) → **enabled**.
- Every **new read** action → **enabled**.
- Every **new write / change** action → **disabled** (opt-in). Newly-added mutating capability stays off until you explicitly enable it.

The "existing action" baseline is generated mechanically from the shipped tool catalog, so no pre-existing action is ever disabled by default.

**Enforcement is call-time.** The policy is checked in the shared framework *after* the `server` profile is resolved and *before* the tool handler runs — it has to be call-time, because the governing profile is chosen per call via `server`. All tools stay advertised in `tools/list`; a blocked action does not run the handler and instead returns a structured error:

```json
{
  "isError": true,
  "structuredContent": {
    "code": "GOVERNANCE_DISABLED",
    "action": "iris_backup_manage:run",
    "server": "prod"
  }
}
```

(the human-readable text reads `action 'iris_backup_manage:run' is disabled by governance policy for server 'prod'`).

### Worked example — enable a write action globally, block it on `prod`

Suppose you want the `run` action of `iris_backup_manage` (a write action shipping in a later release — the canonical example) available everywhere **except** the `prod` profile, where backups are managed out-of-band. Set:

```json
{
  "global":   { "iris_backup_manage:run": true },
  "profiles": { "prod": { "iris_backup_manage:run": false } }
}
```

Result, by the cascade above:

- `iris_backup_manage({ action: "run" })` → uses `default` → `global` says `true` → **allowed**.
- `iris_backup_manage({ action: "run", server: "stage" })` → `stage` has no override → `global` says `true` → **allowed**.
- `iris_backup_manage({ action: "run", server: "prod" })` → `prod` override says `false` → **blocked** (`GOVERNANCE_DISABLED`).

The same shape governs any action you can name today. To try it against a write action that exists in the current release, substitute `iris_database_manage:delete` for `iris_backup_manage:run` — e.g. `"profiles": { "prod": { "iris_database_manage:delete": false } }` blocks database deletion on `prod` while leaving it enabled elsewhere. The JSON shape is identical; only the key changes.

### Inspecting effective policy — the governance resource

The suite exposes an MCP **resource** (alongside its tools) so a client can read the effective policy for a profile *before* attempting a call:

- `iris-governance://default` — the default/global effective policy (also listed in `resources/list`).
- `iris-governance://{profile}` — the effective policy for any named profile (a resource *template*).

Reading the resource returns the effective policy map as JSON. It is **advisory** — a convenience so a client can avoid issuing calls it knows are blocked. The call-time gate remains the authoritative boundary; the resource never grants or denies anything on its own.

### Backward Compatibility

**Existing single-server `IRIS_*` setups require no changes.** This is a release-gate promise:

- With **neither** `IRIS_PROFILES` nor `IRIS_GOVERNANCE` set, behavior is byte-for-byte identical to before — one instance from your `IRIS_*` vars, every tool enabled.
- The `server` parameter is an *optional* addition to each tool's input schema. Calls that omit it are unchanged; existing prompts and automations keep working.
- No `BOOTSTRAP_VERSION` change is involved — these are TypeScript-layer capabilities; nothing on the IRIS side changes.

---

## Architecture

All five servers share a common connection layer (`@iris-mcp/shared`) that handles:

- **HTTP(S) connection** to the IRIS web port using Basic Auth
- **Session cookie reuse** and CSRF token handling for efficient request batching
- **Atelier REST API** (built into IRIS) for document and code operations
- **Custom REST dispatch** (`ExecuteMCPv2.REST.Dispatch`) for execution, globals, security, interoperability, and analytics — auto-bootstrapped, and self-healing, on connection (see [Known Limitations](#migrated-or-sys-reset-instances-self-healing))
- **Built-in IRIS REST APIs** for DocDB (`/api/docdb/v1/`) and REST management (`/api/mgmnt/v2/`)

Servers communicate over the **MCP protocol** (spec v2025-11-25) using either **stdio** or **Streamable HTTP** transport. Every tool returns both `structuredContent` (machine-readable) and `text` content (human-readable), and includes tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) so clients can make informed decisions about tool usage.

```
┌────────────────────────────────────────────────────────┐
│                    MCP Client                          │
│          (Claude, Copilot, Cursor, etc.)               │
└──────────┬──────────┬──────────┬──────────┬───────────┘
           │          │          │          │
     ┌─────▼──┐ ┌─────▼──┐ ┌────▼───┐ ┌───▼────┐ ┌─────▼──┐
     │  dev   │ │ admin  │ │interop │ │  ops   │ │  data  │
     │(24)    │ │(26)    │ │(19)    │ │(20)    │ │(7)     │
     └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘
         │          │          │          │          │
         └──────────┴──────┬───┴──────────┴──────────┘
                           │
                  ┌────────▼────────┐
                  │  @iris-mcp/shared │
                  │  (HTTP client,   │
                  │   auth, config)  │
                  └────────┬────────┘
                           │  HTTP(S)
                  ┌────────▼────────┐
                  │  InterSystems   │
                  │     IRIS        │
                  └─────────────────┘
```

---

## Per-Package Documentation

Each server has its own README with a complete tool reference:

- [`@iris-mcp/dev` — Development Tools](packages/iris-dev-mcp/README.md)
- [`@iris-mcp/admin` — Administration Tools](packages/iris-admin-mcp/README.md)
- [`@iris-mcp/interop` — Interoperability Tools](packages/iris-interop-mcp/README.md)
- [`@iris-mcp/ops` — Operations & Monitoring Tools](packages/iris-ops-mcp/README.md)
- [`@iris-mcp/data` — Data & Analytics Tools](packages/iris-data-mcp/README.md)

---

## Known Limitations

### Web Application Gateway Registration

When the MCP server auto-bootstraps its custom REST endpoint, it creates the web application via `Security.Applications.Create()`. However, this ObjectScript API call does **not** notify the CSP Gateway of the new application. As a result, requests to the new web app may return 404 until one of the following steps is taken:

1. **Save via System Management Portal (SMP):** Navigate to *System Administration > Security > Applications > Web Applications*, open the newly created web application, and click **Save**. This triggers the gateway registration automatically.
2. **Restart the CSP Gateway:** If SMP access is not available, restart the CSP Gateway service (or restart the IRIS instance) to force the gateway to reload its application table.

### Migrated or `%SYS`-Reset Instances (Self-Healing)

The auto-bootstrap detects deployment state by checking **both** the deployed class version **and** whether the `/api/executemcp/v2` web application is actually registered — not the class version alone. This matters when an instance's `%SYS` state diverges from the code database that holds the `ExecuteMCPv2` classes:

- **Container migration / `%SYS` restore / remounting the code DB into a fresh instance.** The `ExecuteMCPv2.*` classes (and their embedded version stamp) live in the namespace's code database and survive intact, but the web-application registration lives in `%SYS` and is lost. The result is "class version present, web app absent" — which the class-version check alone cannot detect.
- **A first install whose privileged `Configure` step failed** (e.g., the connecting user lacked `%Admin_Manage`) leaves the same state.

On the next server start, the bootstrap recognizes this `unconfigured` state and **self-heals**: it re-registers the web application (and package mapping), then **recompiles** the classes. The recompile is deliberate — a class-version hash matching the build proves the *source* is current, but it does **not** prove the *compiled objects* are valid. A code database migrated across IRIS versions keeps the source while carrying stale or version-incompatible compiled objects, which otherwise dispatch as `<NULL VALUE>` HTTP 500 errors until recompiled. No manual steps are required, provided the connecting user has `%Admin_Manage`.

If the connecting user lacks `%Admin_Manage`, the web application cannot be created; the bootstrap reports `configured: false` with manual instructions, and a later launch by a privileged user self-heals automatically.

---

## License

[MIT](LICENSE)

## Contributing

Contributions are welcome. Please open an issue to discuss proposed changes before submitting a pull request.
