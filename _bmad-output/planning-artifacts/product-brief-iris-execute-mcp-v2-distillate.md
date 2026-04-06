---
title: "Product Brief Distillate: IRIS MCP v2"
type: llm-distillate
source: "product-brief-iris-execute-mcp-v2.md"
created: "2026-04-05"
purpose: "Token-efficient context for downstream PRD and architecture creation"
---

# IRIS MCP v2 — Detail Pack for PRD Creation

## Design Decisions (Confirmed)

- **Atelier API first:** Use the Atelier REST API (/api/atelier/v8/) for all operations it supports; only create custom REST services for operations Atelier doesn't cover (~30% of tools)
- **Web port only:** All communication via HTTP/HTTPS on IRIS web port (default 52773). No SuperServer port 1972. No `intersystems-irispython` native driver.
- **Five separate MCP servers:** Following industry best practice of 5-15 tools per server. Split by domain: dev, admin, interop, ops, data.
- **TypeScript monorepo:** Shared package for HTTP client, auth, config, types. Each server is an independent package.
- **MCP spec v2025-11-25:** Latest spec version. Support pagination, tool annotations, listChanged, structured output, outputSchema.
- **Self-bootstrapping:** Custom REST service auto-deploys via Atelier API when missing. Includes a configuration/setup class method that registers the `/api/executemcp` web application on IRIS.
- **Tool consolidation:** 142 original tools consolidated to 86 using the `*.manage` pattern (CRUD via action parameter) and grouping related operations.
- **Dot-namespaced tool names:** `iris.{category}.{action}` pattern (e.g., `iris.doc.compile`, `iris.security.user.manage`). Spec-compliant, LLM-friendly.

## Architecture Requirements

- **Shared HTTP client** with persistent connection pool to IRIS web port
- **Cookie-based session management** with Basic Auth fallback (matching VS Code extension pattern)
- **Connection health check** via `HEAD /api/atelier/` on startup
- **Auto-bootstrap flow (progressive, best-effort):**
  1. Check for custom REST service presence (GET /api/executemcp or HEAD on a known endpoint)
  2. If missing, deploy ObjectScript classes via Atelier API (`PUT /v8/%25SYS/doc/ExecuteMCPv2.*.cls`)
  3. Compile classes via Atelier API (`POST /v8/%25SYS/action/compile`)
  4. Attempt to execute `ExecuteMCPv2.Setup::Configure()` class method via the Atelier SQL action (`POST /action/query` with `SELECT ExecuteMCPv2.Setup_Configure()`) or via a temporary bootstrap routine
  5. The Configure() method creates the `/api/executemcp` web application via `Security.Applications.Create()`, sets namespace to %SYS, configures auth methods, and grants resources
  6. **If any step fails due to insufficient privileges:** Stop at the point of failure, report what was completed successfully, and provide explicit instructions for the remaining steps — including exact ObjectScript commands to run in Terminal or exact SMP navigation paths (e.g., "Go to System Administration > Security > Applications > Web Applications > Create New, set URL to /api/executemcp, Namespace to %SYS, Dispatch Class to ExecuteMCPv2.REST.Dispatch")
  7. On subsequent connections, re-check and skip completed steps
- **Privilege tiers for bootstrap:**
  - %Development:USE — sufficient to deploy and compile classes (steps 2-3)
  - %Admin_Manage:USE — required to register web application (steps 4-5)
  - If user only has %Development, classes deploy successfully but web app registration requires admin intervention
- **IPM (InterSystems Package Manager) as fallback:**
  - If auto-bootstrap cannot fully complete (e.g., insufficient privileges for web app registration), offer IPM as an alternative installation method
  - IPM's `module.xml` manifest can declaratively define class deployment, compilation, web application creation, and namespace configuration — all in one `zpm "install iris-execute-mcp-v2"` command
  - IPM handles Security.Applications registration natively via `<CSPApplication>` elements in the manifest
  - This also provides a standard distribution channel via the IPM registry for the IRIS community
  - **Fallback chain:** (1) Fully automated via Atelier API → (2) If partial failure, provide explicit manual instructions → (3) If IPM is available, offer `zpm "install iris-execute-mcp-v2"` as a single-command alternative
- **Namespace parameter:** All NS-scoped tools accept optional `namespace` with configurable default (env var `IRIS_NAMESPACE`)
- **SYS-scoped tools** always execute in %SYS namespace — no namespace parameter
- **BOTH-scoped tools** accept optional namespace for filtering

## Tool Annotations Strategy

| Tool Pattern | readOnlyHint | destructiveHint | idempotentHint | openWorldHint |
|-------------|-------------|-----------------|----------------|---------------|
| `*.get`, `*.list`, `*.search`, `*.info`, `*.status` | true | false | true | false |
| `*.put`, `*.compile`, `*.set` | false | false | true | false |
| `*.manage` (create/modify/delete combined) | false | true | false | false |
| `*.delete`, `*.kill` | false | true | false | false |
| `*.execute`, `*.control` | false | false | false | false |

## Server Suite Details

### Suite 1: iris-dev-mcp (20 tools)
- **API:** 70% Atelier REST API, 30% Custom REST
- **Scope:** NS (namespace-specific, all tools accept namespace parameter)
- **Tools:** iris.doc.get, iris.doc.put, iris.doc.delete, iris.doc.list, iris.doc.compile, iris.doc.search, iris.doc.index, iris.doc.xml_export, iris.doc.convert, iris.macro.info, iris.sql.execute, iris.global.get, iris.global.set, iris.global.kill, iris.global.list, iris.execute.command, iris.execute.classmethod, iris.execute.tests, iris.server.info, iris.server.namespace
- **Custom REST needed for:** globals (get/set/kill/list), execute (command/classmethod/tests)
- **Priority:** Phase 1 (MVP)

### Suite 2: iris-admin-mcp (22 tools)
- **API:** 95% Custom REST (wraps Security.*, Config.*, %Installer)
- **Scope:** SYS (always %SYS namespace, except iris.webapp.list which is BOTH)
- **Tools:** iris.namespace.manage, iris.namespace.list, iris.database.manage, iris.database.list, iris.mapping.manage, iris.mapping.list, iris.user.manage, iris.user.get, iris.user.roles, iris.user.password, iris.role.manage, iris.role.list, iris.resource.manage, iris.resource.list, iris.permission.check, iris.webapp.manage, iris.webapp.get, iris.webapp.list, iris.ssl.manage, iris.ssl.list, iris.oauth.manage, iris.oauth.list
- **IRIS classes wrapped:** Security.Users, Security.Roles, Security.Resources, Security.Applications, Security.SSLConfigs, Config.Databases, Config.Namespaces, Config.MapGlobals, Config.MapRoutines, Config.MapPackages, %SYS.OAuth2.Registration, $SYSTEM.Security
- **Priority:** Phase 2

### Suite 3: iris-interop-mcp (19 tools)
- **API:** 84% Custom REST (wraps Ens.Director, Ens.Config.*)
- **Scope:** NS (namespace-specific, except iris.production.summary which is NONE)
- **Tools:** iris.production.manage, iris.production.control, iris.production.status, iris.production.summary, iris.production.item, iris.production.autostart, iris.production.logs, iris.production.queues, iris.production.messages, iris.production.adapters, iris.credential.manage, iris.credential.list, iris.lookup.manage, iris.lookup.transfer, iris.rule.list, iris.rule.get, iris.transform.list, iris.transform.test, iris.interop.rest
- **IRIS classes wrapped:** Ens.Director (StartProduction, StopProduction, etc.), Ens.Config.Production, Ens.Config.Credentials, Ens.Util.LookupTable, Ens.MessageHeader (SQL)
- **Priority:** Phase 3

### Suite 4: iris-ops-mcp (16 tools)
- **API:** 69% Custom REST, 31% built-in Monitor/Atelier API
- **Scope:** Mixed (NONE for metrics/jobs/locks/license, SYS for journals/mirrors/audit/tasks/config)
- **Tools:** iris.metrics.system, iris.metrics.alerts, iris.metrics.interop, iris.jobs.list, iris.locks.list, iris.journal.info, iris.mirror.status, iris.audit.events, iris.database.check, iris.license.info, iris.ecp.status, iris.task.manage, iris.task.list, iris.task.run, iris.task.history, iris.config.manage
- **Built-in APIs used:** /api/monitor/metrics, /api/monitor/alerts, /api/monitor/interop/*, /%25SYS/jobs
- **Priority:** Phase 4

### Suite 5: iris-data-mcp (9 tools)
- **API:** 89% built-in APIs (DocDB, DeepSee, Mgmnt)
- **Scope:** NS (all namespace-specific)
- **Tools:** iris.docdb.manage, iris.docdb.document, iris.docdb.find, iris.docdb.property, iris.analytics.mdx, iris.analytics.cubes, iris.debug.session, iris.debug.terminal, iris.rest.manage
- **Priority:** Phase 5

## IRIS-Side Custom REST Service Architecture

```
ExecuteMCPv2.REST.Dispatch extends %CSP.REST
├── ExecuteMCPv2.REST.Command      — execute_command, execute_classmethod, globals
├── ExecuteMCPv2.REST.UnitTest     — execute_unit_tests
├── ExecuteMCPv2.REST.Security     — users, roles, resources, permissions
├── ExecuteMCPv2.REST.Config       — namespaces, databases, mappings
├── ExecuteMCPv2.REST.WebApp       — web applications
├── ExecuteMCPv2.REST.SSL          — SSL/TLS configurations
├── ExecuteMCPv2.REST.OAuth2       — OAuth2 client/server management
├── ExecuteMCPv2.REST.Interop      — productions, items, credentials, lookups
├── ExecuteMCPv2.REST.Task         — task scheduling
├── ExecuteMCPv2.REST.Monitor      — jobs, locks, journals, mirrors, audit
├── ExecuteMCPv2.REST.SystemConfig — system configuration, startup, NLS
├── ExecuteMCPv2.REST.Analytics    — DeepSee cube management
└── ExecuteMCPv2.Setup             — Auto-configuration class (registers web app)
```

**Web application config for /api/executemcp:**
- Namespace: %SYS (required for admin operations; tool handlers switch namespace as needed)
- Resource: %Admin_Manage:USE (or custom resource)
- Authentication: Password (+ future OAuth2)
- Dispatch class: ExecuteMCPv2.REST.Dispatch
- CORS: Enabled (HandleCorsRequest = 1)

## Atelier API Endpoints Used (Complete List)

### By iris-dev-mcp:
- `GET /api/atelier/` — server info
- `GET /v8/{ns}` — namespace info
- `GET/HEAD /v8/{ns}/doc/{name}` — get/check document
- `PUT /v8/{ns}/doc/{name}` — create/update document
- `DELETE /v8/{ns}/doc/{name}` — delete document
- `POST /v8/{ns}/docs` — get multiple documents
- `DELETE /v8/{ns}/docs` — delete multiple documents
- `GET /v8/{ns}/docnames/{cat}/{type}` — list documents
- `POST /v8/{ns}/modified/{type}` — modified documents
- `POST /v8/{ns}/action/compile` — compile
- `POST /v8/{ns}/work` + `GET /v8/{ns}/work/{id}` — async compile
- `POST /v8/{ns}/action/index` — class structure
- `GET /v8/{ns}/action/search` — code search
- `POST /v8/{ns}/action/getmacrodefinition` — macro info
- `POST /v8/{ns}/action/getmacrolist` — macro list
- `POST /v8/{ns}/action/getmacrolocation` — macro location
- `POST /v8/{ns}/action/query` — SQL execution
- `POST /v8/{ns}/action/xml/export` — XML export
- `POST /v8/{ns}/action/xml/load` — XML import
- `POST /v8/{ns}/action/xml/list` — XML list
- `POST /v8/{ns}/cvt/xml/doc` — format conversion

### By other suites:
- `GET /%25SYS/cspapps` — list web apps (iris-admin-mcp)
- `GET /%25SYS/jobs` — list jobs (iris-ops-mcp)
- `GET /v8/{ns}/ens/classes/{type}` — adapter types (iris-interop-mcp)
- `GET /api/mgmnt/v2/` — REST apps (iris-admin-mcp, iris-interop-mcp)
- `GET /api/monitor/metrics` — Prometheus metrics (iris-ops-mcp)
- `GET /api/monitor/alerts` — alerts (iris-ops-mcp)
- `GET /api/monitor/interop/*` — interop metrics (iris-ops-mcp)
- `/api/docdb/v1/*` — DocDB operations (iris-data-mcp)
- `/api/deepsee/v3/*` — DeepSee operations (iris-data-mcp)

## Rejected Approaches

- **Single server with all 142 tools:** Rejected due to LLM performance cliff past ~20 tools (GitHub evidence: 40→13 tools = 2-5% benchmark improvement)
- **Profile-switching pattern:** Considered (single server with `iris.switch_profile` meta-tool) but rejected in favor of separate servers — simpler, more aligned with MCP ecosystem conventions, independent deployment
- **SuperServer/native driver retention:** Rejected — adds dependency, blocks containerized deployments, no benefit over HTTP for our use cases
- **Python SDK:** Considered but TypeScript chosen — better MCP ecosystem alignment, Tier 1 SDK, monorepo tooling

## Open Questions

- **Atelier API version:** Should we target v7 or v8? v8 is latest but v7 has wider deployment. Need to verify target IRIS versions.
- **Custom REST service versioning:** How to handle upgrading the IRIS-side service when a new MCP server version requires schema changes?
- **Authentication scope:** The auto-bootstrap requires %Admin_Manage privileges. Should the dev server work with lower privileges (%Development only) by skipping admin-level tools?
- **Monorepo structure:** npm workspaces vs pnpm workspaces vs Turborepo? Need to evaluate build/publish workflow.
- **Testing strategy:** How to test against IRIS in CI? Docker container with IRIS Community? Mock HTTP responses?

## Technical Constraints

- IRIS web port must be accessible (default 52773, configurable)
- User credentials must have %Development:USE for dev tools, %Admin_Manage:USE for admin tools
- Custom REST service requires %SYS namespace access for deployment
- Atelier API requires /api/atelier web application to be enabled (default in IRIS)
- Some admin operations (Config.*, Security.*) are only available in %SYS namespace
- Ensemble/Interoperability tools require an Interoperability-enabled namespace
- Tool name max length is 128 chars per MCP spec (our longest: `iris.production.autostart` = 26 chars — well within limit)

## Scope Signals

**MVP (iris-dev-mcp):** Must ship first. Replaces both v1 servers for development use cases.
**Fast follow (iris-admin-mcp):** Critical for the "full AI controllability" vision. Without admin tools, AI can develop but not deploy.
**Interop (iris-interop-mcp):** Important for HealthShare/integration users. Can ship independently.
**Ops and Data:** Lower priority. Ship when demand warrants.
