# IRIS MCP Server Suite

> **Pre-Release** — This project is under active development and has not yet been published to npm or IPM. Install by cloning the repository (see [Quick Start](#quick-start) below). Package registry publishing is planned for a future release. See [CHANGELOG.md](CHANGELOG.md) for the 2026-04-19 bug-fix pass (six defects found during a manual MCP suite retest) and the 2026-04-09 pre-release breaking change to tool names.

**Give AI assistants structured, safe access to InterSystems IRIS.**

The IRIS MCP Server Suite is a collection of five specialized [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) servers that let AI coding assistants — Claude, Copilot, Cursor, and others — work directly with InterSystems IRIS. Each server covers a distinct operational domain so you can install only what you need.

---

## Servers

| Package | Domain | Tools | Description |
|---------|--------|------:|-------------|
| [@iris-mcp/dev](packages/iris-dev-mcp/README.md) | Development | 28 | ObjectScript document CRUD, compilation, SQL, globals, code execution, unit tests, package browsing, bulk export, macro-expanded routine lookup, SQL query analysis, lines-of-code metrics, cross-profile environment diff & promotion (`iris_env_diff`, `iris_env_promote`) |
| [@iris-mcp/admin](packages/iris-admin-mcp/README.md) | Administration | 26 | Namespace, database, user, role, resource (incl. SQL privileges), web-app, SSL/TLS, OAuth2, service, LDAP, X.509, and audit management |
| [@iris-mcp/interop](packages/iris-interop-mcp/README.md) | Interoperability | 22 | Ensemble/Health Connect production lifecycle, production item management, system default settings, credentials, lookups, rules, transforms, message-trace Mermaid diagrams, message resend/replay (duplication hazard — preview before executing) |
| [@iris-mcp/ops](packages/iris-ops-mcp/README.md) | Operations & Monitoring | 21 | Composite health check (`iris_health_check` — one call, verdict + findings), system metrics, jobs, locks, journals, mirrors, audit, database integrity, licensing, ECP, tasks, alert management, process control, database maintenance operations, backups |
| [@iris-mcp/data](packages/iris-data-mcp/README.md) | Data & Analytics | 7 | DocDB document database, DeepSee analytics (MDX/cubes), REST API management |

> **104 tools** across 5 servers — install one or all. Each server additionally provides one framework tool, `iris_server_profiles` (see [Discovering profiles and policy](#discovering-profiles-and-policy-call-this-first)), so the advertised count per server is one greater than the package totals above.

### Meta-package

Once published, all servers will be installable at once with `npm install -g @iris-mcp/all`. See the [meta-package README](packages/iris-mcp-all/README.md) for details.

---

## Which Server Do I Need?

| Your Role | Recommended Server(s) |
|-----------|----------------------|
| **ObjectScript developer** | `@iris-mcp/dev` — compile, edit, execute code, run SQL, manage globals |
| **System administrator** | `@iris-mcp/admin` — manage namespaces, databases, users, roles, web apps, SSL, OAuth |
| **Integration engineer** | `@iris-mcp/interop` — control productions, configure credentials, manage business rules and transforms |
| **Operations / SRE** | `@iris-mcp/ops` — check overall instance health in one call (`iris_health_check`), monitor metrics, inspect jobs and locks, review journals, audit events, manage tasks |
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
| `IRIS_GOVERNANCE_PRESET` | *(unset)* | **Optional.** `"read-only"` or `"full"` — a one-word safety preset that blocks every write action suite-wide. Omit (or `"full"`) for today's behavior. See [Read-only mode](#read-only-mode-point-it-at-production-with-one-environment-variable). |
| `IRIS_SQL_MAX_ROWS` | *(unset — no cap)* | **Optional.** Positive integer ceiling on the number of rows `iris_sql_execute` **returns** — a post-fetch cap on the response (it bounds the returned row count, not the server-side result set or transfer). Omit for today's behavior (only the per-call `maxRows`/1000-row default apply). |
| `IRIS_SQL_TIMEOUT` | *(unset — no override)* | **Optional.** Positive number of **seconds** — a per-request timeout override for `iris_sql_execute`'s HTTP call. Omit to use the connection's default `IRIS_TIMEOUT`. |

> **Single-server installs need no changes.** `IRIS_PROFILES`, `IRIS_GOVERNANCE`, `IRIS_GOVERNANCE_PRESET`, `IRIS_SQL_MAX_ROWS`, and `IRIS_SQL_TIMEOUT` are all optional and additive. With none set, the suite behaves exactly as it always has — the six `IRIS_*` variables above are all you need.

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
>
> **Programmatic config updates:** if you write the config file with a JSON serializer (Python `json.dump`, Node `JSON.stringify`, etc.), pass `IRIS_PROFILES`/`IRIS_GOVERNANCE` as a plain string — the serializer escapes the inner quotes automatically. Do **not** pre-escape the string yourself; that produces double-escaped output (`\\"`) and the server will fail to parse the value at startup.

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

### Read-only mode — point it at production with one environment variable

**Point it at production in read-only mode with one environment variable.** Set `IRIS_GOVERNANCE_PRESET=read-only` and every write-classified tool action — across all five servers — is blocked, while every read action keeps working, with zero `IRIS_GOVERNANCE` JSON to write:

```json
{ "env": { "IRIS_GOVERNANCE_PRESET": "read-only" } }
```

What it does:

- **Blocks every write.** Any action a tool's `mutates` classification marks `"write"` (deletes, creates, sets, starts/stops, purges, `defaultEnabled` writes like `iris_production_control:clean` included — read-only means read-only, there is no "but this one's safe" exception) is denied.
- **Allows every read.** Queries, lists, gets, status/health checks, diagnostics — anything classified `"read"` — run exactly as they do today.
- **Sits UNDER your explicit `IRIS_GOVERNANCE` overrides, never over them.** The cascade is `profile.explicit ?? global.explicit ?? preset ?? defaultSeed`: an explicit `true` in `IRIS_GOVERNANCE` still wins over `read-only` if you deliberately want one specific write enabled even in a read-only deployment (and an explicit `false` still wins too — it just doesn't need to, since the preset already denies it).
- **Explains itself.** A call blocked *because of* the preset (not an explicit `false`) returns `structuredContent.presetApplied: "read-only"` alongside the standard `GOVERNANCE_DISABLED` denial, so an operator or AI client can tell "blocked by the preset" apart from "blocked by an explicit override" at a glance.
- **Is opt-in and additive.** `IRIS_GOVERNANCE_PRESET` unset (or set to `"full"`, an explicit alias for today's behavior) is byte-for-byte the pre-preset suite — nothing changes until you set it.

Pair it with the **SQL resource caps** for an extra safety margin on `iris_sql_execute` against a large production table: `IRIS_SQL_MAX_ROWS` (a ceiling on the number of rows a call **returns** — the response carries `rowsCapped: true` when it clamps a caller's request; note this bounds the returned row count post-fetch, not the server-side result set or transfer) and `IRIS_SQL_TIMEOUT` (a per-request timeout in seconds). Both are independent of the preset — they apply to `iris_sql_execute` regardless of `IRIS_GOVERNANCE_PRESET` — and both are opt-in (unset = no cap, today's behavior):

```json
{ "env": { "IRIS_GOVERNANCE_PRESET": "read-only", "IRIS_SQL_MAX_ROWS": "1000", "IRIS_SQL_TIMEOUT": "30" } }
```

See the per-client guides ([Claude Code](docs/client-config/claude-code.md), [Claude Desktop](docs/client-config/claude-desktop.md), [Cursor](docs/client-config/cursor.md)) for copy-pasteable `env` blocks.

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

### Discovering profiles and policy (call this first)

Every server provides a framework tool, **`iris_server_profiles`**, that an AI client should **call first** to learn its operating environment without reading the client's config files:

- **Profile roster** — for each configured profile: `name`, `isDefault`, `host`, `port`, `username`, `namespace`, `https`, `baseUrl`, `timeout`. The **`password` is never included** (an allow-list of non-secret fields). Use this to pick the right `server` profile for subsequent calls.
- **Effective governance policy** — the enabled/disabled action map for a selected profile (optional `profile` arg; defaults to `default`), or for every profile with `allProfiles: true`. Computed from the same engine the governance resource uses, so the two never disagree.

It does not connect to IRIS (it reports in-memory config), so it works even when the target instance is unreachable. It is a **read tool, enabled by default** — an operator can still disable it explicitly via `IRIS_GOVERNANCE`. The same call-first guidance is also surfaced via the MCP server `instructions` field at connect time.

> Note: the tool's optional `profile` arg selects which profile's *policy* to report; the framework `server` arg (which selects the connection target on every other tool) is irrelevant here, since discovery does not connect.

### Inspecting effective policy — the governance resource

The suite exposes an MCP **resource** (alongside its tools) so a client can read the effective policy for a profile *before* attempting a call:

- `iris-governance://default` — the default/global effective policy (also listed in `resources/list`).
- `iris-governance://{profile}` — the effective policy for any named profile (a resource *template*). Its `list` callback enumerates one concrete `iris-governance://<profile>` entry per configured profile, so resource-reading clients can also discover the profile roster by name via `resources/list`.

Reading the resource returns the effective policy map as JSON. It is **advisory** — a convenience so a client can avoid issuing calls it knows are blocked. The call-time gate remains the authoritative boundary; the resource never grants or denies anything on its own.

### Default-disabled write actions in the current release

Per the default-seed rule above, the **new write actions** added after governance shipped are **disabled by default** (opt-in via `IRIS_GOVERNANCE`); their sibling reads are enabled by default. The set shipped to date:

| Server | Tool | Default-**disabled** (write) actions | Default-enabled (read/pre-existing) |
|---|---|---|---|
| admin | `iris_service_manage` | `enable`, `disable`, `set` | `list`, `get` |
| admin | `iris_ldap_manage` | `create`, `modify`, `delete` | `list`, `get`, `test` |
| admin | `iris_x509_manage` | `import`, `delete` | `list`, `get` |
| admin | `iris_audit_manage` | `enable`, `disable`, `configureEvent`, `purge`, `export` | `status`, `view` |
| admin | `iris_resource_manage` (SQL privileges) | `grant`, `revoke` | `listPrivileges` (resource `create`/`modify`/`delete` are pre-governance, enabled) |
| ops | `iris_process_manage` | `terminate`, `suspend`, `resume` | `get` |
| ops | `iris_database_action` | `mount`, `dismount`, `compact`, `defragment`, `truncate`, `expandVolume` (all six) | — |
| ops | `iris_backup_manage` | `run`, `freeze`, `thaw` | `listHistory` |
| interop | `iris_default_settings_manage` | `set`, `delete` | `list`, `get` |
| interop | `iris_production_item` | `add`, `remove` (new) | `enable`, `disable`, `get`, `set` (pre-governance baseline) |
| interop | `iris_message_diagram` | — (flat read tool, no actions) | whole tool (message-trace Mermaid diagrams, Epic 21) |
| interop | `iris_message_resend` | `resend`, `resendFiltered` (message resend/replay, Epic 26) | `preview` |
| dev | `iris_sql_analyze` | — (all four actions are reads) | `explain`, `stats`, `indexUsage`, `running` |
| dev | `iris_loc_count` | — (flat read tool, no actions) | whole tool (namespace lines-of-code metrics, Epic 22) |
| dev | `iris_env_diff` | — (flat read tool, no actions) | whole tool (cross-profile environment drift detection, Epic 27) |
| dev | `iris_env_promote` | `execute` | `plan` |

Every **pre-governance** tool action (everything shipped before the governance layer) stays enabled by default. The authoritative per-tool catalog with endpoints and governance notes is [`tool_support.md`](tool_support.md).

#### "Write, default-enabled" actions (the `defaultEnabled` mechanism)

A small number of **new write actions ship enabled by default** even though they are truthfully classified `write`. This is the `defaultEnabled` mechanism (Epic 20, architecture decision F2): a tool can mark specific write actions as default-enabled so a recovery/operational action an operator expects available does not require an opt-in, **without** mislabelling it as a read and **without** modifying the frozen governance baseline. Such an action still carries `mutates: "write"` (and its truthful `destructiveHint`), and an operator can still **disable** it with an explicit `IRIS_GOVERNANCE` override — the cascade honors an explicit `false`.

| Server | Tool | Write action, but **enabled by default** | Why |
|---|---|---|---|
| interop | `iris_production_control` | `clean` | Recovery operation (unwedge a stopped production); parity with the grandfathered lifecycle actions. Its destructive `killAppData` persistent-wipe is separately double-gated behind `confirm:true`. |

Absent any tool opting in, this mechanism is inert (the governance seed is byte-for-byte its pre-F2 behavior — every other new write still default-disabled).

#### `iris_env_promote:execute` safety model (Epic 27)

`iris_env_promote`'s `execute` action is a genuine environment-mutating write, so it carries a richer safety story than a single default-disabled flag — worth its own callout:

- **Default-disabled, not `defaultEnabled`.** Unlike `iris_production_control:clean` (a recovery-of-last-resort action, Epic 20), `execute` is a real promotion write and deliberately does **not** use the `defaultEnabled` mechanism above — enable it explicitly via `IRIS_GOVERNANCE`, e.g. `{"global": {"iris_env_promote:execute": true}}`.
- **No-deletions guarantee.** `onlyInTarget` diff entries (something exists on the target only) are always emitted as informational **warnings**, never as steps. No delete/remove operation exists anywhere in any plan, in this or any future version — the one exception is `updateMapping`'s intra-step delete+create *replace* of a mapping the source also has (`Config.cls` has no in-place update); it never targets a target-only item.
- **Secrets exclusion.** A System Default Settings value whose setting name looks credential-ish (`password`/`secret`/`key`/`token`/`pwd`/`passphrase`/`credential`/`cert`/`private`/`salt`, case-insensitive) is redacted in both `iris_env_diff` and `iris_env_promote` output — the plaintext never appears in any tool result, on either the plan or the execute path (including error messages). Credentials/users/roles promotion is out of scope entirely.
- **Four refuse-before-any-write gates**, each mutating nothing on failure: (1) `confirm: true` required; (2) a non-empty `steps` allowlist whose every index exists in `plan.steps`; (3) plan-hash freshness — the SAME `diff` that produced `plan` is re-hashed and compared, refusing a stale plan; (4) the **target** profile's own governance policy must enable every write family the allowlisted steps use (`iris_doc_put`/`iris_doc_compile`, `iris_mapping_manage:create`/`:delete`, `iris_default_settings_manage:set`, `iris_webapp_manage:modify`, `iris_config_manage:set`) — this is what stops a caller on an unrestricted profile from writing into a governance-locked target, independent of the outer `iris_env_promote:execute` gate.

### Backward Compatibility

**Existing single-server `IRIS_*` setups require no changes.** This is a release-gate promise:

- With **neither** `IRIS_PROFILES` nor `IRIS_GOVERNANCE` set, behavior is byte-for-byte identical to before — one instance from your `IRIS_*` vars, every tool enabled.
- With `IRIS_GOVERNANCE_PRESET` **unset** (the default), the governance cascade's preset layer is a pure pass-through — behavior is unchanged whether or not `IRIS_GOVERNANCE`/`IRIS_PROFILES` are set.
- With `IRIS_SQL_MAX_ROWS`/`IRIS_SQL_TIMEOUT` **unset** (the default), `iris_sql_execute` is byte-for-byte today's behavior — no `rowsCapped` field, no per-request timeout override.
- The `server` parameter is an *optional* addition to each tool's input schema. Calls that omit it are unchanged; existing prompts and automations keep working.
- No `BOOTSTRAP_VERSION` change is involved — these are TypeScript-layer capabilities; nothing on the IRIS side changes.

---

## Workflow Prompts & Agent Skills

Beyond individual tools, the suite ships a pack of **MCP prompts** (Epic 25) — parameterized, workflow-shaped instructions that teach an MCP client the *sequence* of tool calls an expert would use for a task, not just the tools themselves. This is a separate MCP protocol capability from tools: prompts are discoverable via `prompts/list` and rendered via `prompts/get`, on any client that supports the [MCP `prompts` capability](https://modelcontextprotocol.io/). A server only advertises `prompts` when it has at least one registered — servers with none behave exactly as before (Rule #19 back-compat).

**Prompts do not change the 104-tool count anywhere.** They are a framework/protocol surface, not tools — no `mutates` classification, no governance key, no package tool-array change (Rule #31). See [Backward Compatibility](#backward-compatibility) above.

### The v1 pack — 11 prompts, grouped by owning server

| Server | Prompt | What it does |
|---|---|---|
| `@iris-mcp/ops` | `check-system-health` | Runs `iris_health_check`, interprets every non-`ok` finding, and names the fixing tool for each one. |
| `@iris-mcp/ops` | `run-external-backup` | Freezes the instance for an external (OS/SAN-level) snapshot and thaws it safely afterward — thaw always runs, even if the snapshot step failed. |
| `@iris-mcp/dev` | `diagnose-slow-query` | Runs `iris_sql_analyze` (`explain` → `indexUsage` → `stats`) and recommends a fix — never auto-applies one. |
| `@iris-mcp/dev` | `objectscript-review` | A concise pre-write checklist distilling this project's ObjectScript conventions ($$$ macros, `Quit` in try/catch, `%OnNew`/`initvalue`, no-underscore names, storage sections untouchable). |
| `@iris-mcp/dev` | `deploy-and-test-class` | Deploys an ObjectScript class or package (`iris_doc_load`, glob-path form), resolves compile errors, then runs its unit tests (`iris_execute_tests`) with a total-count check. |
| `@iris-mcp/dev` | `promote-environment-change` | Reviews and promotes configuration/code drift from a source IRIS environment to a target using the review-before-write `iris_env_diff` → `iris_env_promote` workflow — scoped diff, review with the user, plan, an explicit user-selected step allowlist, confirmed execute, then re-diff to verify. Never acts on `onlyInTarget` warnings; states the no-deletions guarantee and that `execute` is default-disabled. |
| `@iris-mcp/interop` | `trace-message-flow` | Traces a message's flow through a production using `iris_production_messages`, `iris_message_diagram`, and `iris_production_logs` for any erroring items. |
| `@iris-mcp/interop` | `recover-stuck-production` | Diagnoses and recovers a troubled/wedged production, following the recover-first, clean-last-resort escalation ladder — never suggests `killAppData` without the user's explicit acceptance of persistent business-state loss. |
| `@iris-mcp/interop` | `resend-failed-messages` | Resends failed messages for a config item using the dry-run-first `iris_message_resend` workflow — preview the match count, review with the user, execute only on explicit approval, then verify the new headers. States the duplication hazard and that the write actions are default-disabled. |
| `@iris-mcp/admin` | `provision-project-environment` | Provisions a new project environment (two databases, a namespace, a user, a web application), verifying each step before the next, with rollback notes. |
| `@iris-mcp/admin` | `audit-security-posture` | Audits users, roles, service authentication settings, SSL/TLS configs, and instance auditing status; reports default passwords, `%All` holders, and insecure services. |

`@iris-mcp/data` ships **no prompts in v1**.

### Using the prompts

- **Via the MCP protocol directly** (recommended when your client supports it): call `prompts/list` on the relevant server to see its prompts, then `prompts/get` with the prompt's `name` and any arguments to render the workflow text.
- **As installable Agent Skills**: the same content is generated into a repo-root [`skills/`](skills/README.md) directory — one `SKILL.md` per prompt, with YAML frontmatter (`name`, `description`) and the workflow body. Copy the skills you want into your project's `.claude/skills/` directory (see [`skills/README.md`](skills/README.md) for details). Every tool name referenced in a prompt or skill is validated against the live tool catalog in CI, so a renamed or removed tool breaks the build rather than shipping a broken workflow.

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
     │(28)    │ │(26)    │ │(22)    │ │(21)    │ │(7)     │
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
