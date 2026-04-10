---
stepsCompleted:
  - step-01-init
  - step-02-discovery
  - step-02b-vision
  - step-02c-executive-summary
  - step-03-success
  - step-04-journeys
  - step-05-domain-skipped
  - step-06-innovation
  - step-07-project-type
  - step-08-scoping
  - step-09-functional
  - step-10-nonfunctional
  - step-11-polish
classification:
  projectType: developer_tool
  domain: general
  complexity: medium
  projectContext: greenfield
  deliveryModel: sequential-epics
  mvpScope: all-five-servers
inputDocuments:
  - product-brief-iris-execute-mcp-v2.md
  - product-brief-iris-execute-mcp-v2-distillate.md
  - research/technical-iris-mcp-v2-tools-research-2026-04-05.md
  - research/technical-mcp-server-best-practices-research-2026-04-05.md
  - research/iris-mcp-v2-server-suites-2026-04-05.md
  - research/mcp-specification-reference-2025-11-25.md
documentCounts:
  briefs: 2
  research: 4
  projectDocs: 0
workflowType: 'prd'
---

# Product Requirements Document - iris-execute-mcp-v2

**Author:** Developer
**Date:** 2026-04-05

## Executive Summary

IRIS MCP v2 is an open-source suite of five Model Context Protocol (MCP) servers that deliver full AI controllability of InterSystems IRIS. It replaces the existing `iris-execute-mcp` (8 tools) and `mcp-server-iris` (10 tools) with 86 consolidated tools spanning development, administration, interoperability, operations, and data management — all communicating exclusively through the IRIS web port via HTTP/REST.

The v1 servers proved that AI agents want to work with IRIS. What held them back was coverage (only 18 tools covering basic development) and friction (SuperServer native driver dependency that blocks containerized and remote environments). v2 removes both barriers: comprehensive coverage across every major IRIS management surface, and zero-friction connectivity using the Atelier REST API and a self-bootstrapping custom REST service that requires only `npm install` and web port access.

The suite is delivered as a TypeScript monorepo with five independently installable server packages, each containing 9-22 tools optimized for a specific domain. All five servers constitute the MVP, delivered as a sequence of epics: iris-dev-mcp (development lifecycle), iris-admin-mcp (server infrastructure), iris-interop-mcp (production management), iris-ops-mcp (monitoring and operations), and iris-data-mcp (document databases and analytics). The architecture follows MCP specification v2025-11-25 with cursor-based pagination, tool annotations for client-side safety decisions, dot-namespaced tool names, and structured output schemas.

Target users are IRIS developers using AI coding assistants (primary), system administrators automating IRIS infrastructure (secondary), and operations teams monitoring system health (tertiary).

## Differentiators

- **Web-port only architecture** eliminates the `intersystems-irispython` native driver dependency. One HTTP connection through firewalls, reverse proxies, and containers — no special port configuration.
- **Atelier API first** — 70% of the development server's tools use the battle-tested REST API that powers the VS Code ObjectScript extension. Custom ObjectScript REST services only where Atelier doesn't reach.
- **Self-bootstrapping installation** — servers detect missing IRIS-side components and auto-deploy via the Atelier API. If privileges are insufficient, explicit manual instructions are provided. IPM (`zpm "install iris-execute-mcp-v2"`) serves as a single-command fallback.
- **Suite architecture** keeps each server in the 9-22 tool sweet spot, avoiding the LLM performance cliff that occurs past ~20 tools. GitHub's evidence: reducing from 40 to 13 tools improved benchmarks 2-5% with 400ms latency reduction.
- **Full management surface coverage** — 86 tools across 5 servers covering everything from ObjectScript compilation to OAuth2 client registration, production lifecycle management, and Prometheus metrics export.

## Project Classification

- **Project Type:** Developer tool — npm-installable MCP server packages
- **Domain:** General software infrastructure (AI-IRIS connectivity layer)
- **Complexity:** Medium — multiple servers, two API integration paths, MCP spec compliance, auto-bootstrap flow
- **Project Context:** Greenfield TypeScript monorepo (clean break from Python-based v1)
- **Delivery Model:** All five servers in MVP scope, delivered as sequential epics

## Success Criteria

### User Success

- A developer can install any server via `npm install @iris-mcp/dev` and connect to IRIS within 5 minutes with zero IRIS-side manual configuration (self-bootstrap handles it)
- An AI agent (Claude Code, Copilot, Cursor) can perform the full development cycle — read source, edit, compile, run tests, fix errors — without the user leaving the AI conversation
- An administrator can provision a complete IRIS environment (namespace, database, user, roles, web application, SSL, credentials) entirely through AI-directed MCP tool calls
- An integration engineer can start, stop, configure, and debug an Interoperability production through MCP tools without opening the Management Portal

### Business Success (Open-Source Metrics)

- **Adoption:** 500+ npm downloads within 3 months of initial release; 50+ GitHub stars
- **Community engagement:** 10+ external issues or PRs within 6 months indicating real-world usage
- **Ecosystem presence:** Listed in the official MCP registry; referenced in InterSystems community posts
- **v1 migration:** Existing iris-execute-mcp and mcp-server-iris users can migrate to v2 with a documented upgrade path

### Technical Success

- All 86 consolidated tools implemented and functional across all 5 servers
- Zero SuperServer/native driver dependencies — web port HTTP only
- MCP specification v2025-11-25 compliance: pagination, tool annotations, listChanged, structured output
- Self-bootstrap succeeds fully with %Admin_Manage privileges; degrades gracefully with %Development only
- Each server stays under 25 tools (MCP best practice threshold)
- Tool response times under 2 seconds for read operations, under 10 seconds for compilation/deployment

### Measurable Outcomes

- **Completeness:** 86/86 tools passing integration tests against IRIS Community Edition
- **Reliability:** All Atelier API-based tools match VS Code extension behavior (same endpoints, same error handling)
- **Documentation:** Every tool has a description sufficient for LLM tool selection (tested by having Claude correctly choose the right tool for 20 natural-language prompts)

## User Journeys

### Journey 1: Marcus — The IRIS Developer (Primary, Happy Path)

Marcus is a senior ObjectScript developer at a healthcare organization. He's been using Claude Code for Python and JavaScript projects and loves it, but every time he switches to IRIS work, he's back to copy-pasting between the Terminal, VS Code, and the Management Portal. He installed the v1 `iris-execute-mcp` months ago but gave up after fighting with the Python native driver installation on his locked-down corporate laptop.

**Opening Scene:** Marcus runs `npm install -g @iris-mcp/dev` and adds the server to his Claude Code config. He types his IRIS web port URL and credentials. That's it — no Python, no native drivers, no IT ticket for port 1972.

**Rising Action:** He asks Claude: "Show me all the classes in the MyApp package." Claude calls `iris_doc_list` and returns the class listing. He says "Open MyApp.Service.PatientLookup" — Claude calls `iris_doc_get` and shows the source. He asks Claude to add input validation to the ProcessInput method. Claude edits the code, calls `iris_doc_put` to save, then `iris_doc_compile`. Compilation fails — a typo in a macro. Claude reads the error, fixes it, recompiles. Green.

**Climax:** Marcus says "Run the unit tests for MyApp.Test." Claude calls `iris_execute_tests`, and 14/15 tests pass. One failure — an edge case Marcus hadn't considered. Claude suggests a fix, applies it, recompiles, retests. 15/15 pass. Marcus hasn't left the conversation once.

**Resolution:** What used to be a 45-minute context-switching dance is now a 10-minute flow state. Marcus starts using Claude for all his IRIS work — not just editing, but searching code (`iris_doc_search`), running SQL queries (`iris_sql_execute`), and debugging with globals (`iris_global_get`).

### Journey 2: Priya — The System Administrator (Secondary, Admin Path)

Priya is an IRIS system administrator responsible for provisioning new namespaces for development teams. Every time a new project starts, she manually creates a database, namespace, user accounts, web applications, and SSL configurations through the Management Portal — a 30-minute checklist she's done hundreds of times.

**Opening Scene:** Priya installs `@iris-mcp/admin` and connects it to her IRIS instance. She has %Admin_Manage privileges, so the auto-bootstrap deploys the custom REST service automatically.

**Rising Action:** A new project team needs a development environment. Priya tells Claude: "Create a new namespace called DEVPROJECT with a new database, a developer user account with %Developer role, and a REST web application at /api/devproject." Claude orchestrates the calls: `iris_database_manage` (create), `iris_namespace_manage` (create), `iris_user_manage` (create with roles), `iris_webapp_manage` (create). Each step confirms success.

**Climax:** The team also needs SSL configured for their external API. Priya says "Set up an SSL configuration called DevProjectSSL using the certificates in /opt/certs/." Claude calls `iris_ssl_manage` to create the config, then `iris_webapp_manage` to update the web application with the SSL reference. Done in 2 minutes instead of 15 clicks through the SMP.

**Resolution:** Priya creates a Claude prompt template for "provision new project environment" and uses it every time. What was a 30-minute manual checklist is now a 3-minute conversation. She starts exploring OAuth2 configuration and credential management through the same interface.

### Journey 3: Raj — The Integration Engineer (Secondary, Interop Path)

Raj builds and manages HL7 FHIR integrations using IRIS Interoperability. He spends half his day in the Production Configuration page and the other half reading message traces when things go wrong.

**Opening Scene:** Raj installs `@iris-mcp/interop` alongside the dev server. He's troubleshooting why messages from Hospital B stopped flowing this morning.

**Rising Action:** He asks Claude: "What's the status of the HL7FeedProduction?" Claude calls `iris_production_status` with full item details — the TCP inbound adapter for HospitalB is in error state. He asks "Show me the last 20 error logs for HospitalB.TCPService." Claude calls `iris_production_logs` filtered by item and type. Connection refused — Hospital B changed their firewall rules overnight.

**Climax:** Raj updates the adapter settings: "Change the IP address for HospitalB.TCPService to 10.0.5.42 and restart that item." Claude calls `iris_production_item` to update the setting, then `iris_production_control` to restart just that item. Messages start flowing again. He verifies with `iris_production_messages` — new messages are completing successfully.

**Resolution:** Raj realizes he can do most of his production monitoring and configuration from Claude without ever opening the Management Portal. He starts using `iris_production_queues` to proactively check for backlogs and `iris_lookup_manage` to update routing tables on the fly.

### Journey 4: Marcus Again — First-Time Setup with Limited Privileges (Edge Case)

Marcus tries to install `@iris-mcp/admin` but his account only has %Development privileges, not %Admin_Manage.

**Opening Scene:** The admin server connects and detects the custom REST service is missing. It deploys the ObjectScript classes via Atelier (works with %Development) and compiles them (works). Then it tries to register the web application — and fails.

**Rising Action:** Instead of a cryptic error, the server displays: "Custom REST service classes deployed and compiled successfully. Web application registration requires %Admin_Manage privileges. To complete setup, either: (1) Ask your administrator to run `Do ##class(ExecuteMCPv2.Setup).Configure()` in the %SYS Terminal, or (2) Run `zpm "install iris-execute-mcp-v2"` if IPM is available, or (3) In the SMP, go to System Administration > Security > Applications > Web Applications > Create New..." with full parameter details.

**Climax:** Marcus forwards the instructions to Priya (the admin). She runs the one-liner in Terminal. The web application is registered.

**Resolution:** On Marcus's next connection, the server detects the REST service is fully configured. All admin tools become available. The bootstrapping was a one-time event, and the explicit instructions made it painless to resolve.

### Journey 5: Chen — The Operations Engineer (Tertiary, Ops Path)

Chen is the on-call operations engineer responsible for IRIS system health across three production instances. He monitors dashboards, investigates alerts, and manages scheduled maintenance tasks. Today he's investigating a system alert that fired at 3 AM.

**Opening Scene:** Chen installs `@iris-mcp/ops` and connects it to the production IRIS instance. He asks Claude: "Show me any system alerts from the last 12 hours." Claude calls `iris_metrics_alerts` and returns two alerts — one for high lock contention and one for a failed scheduled task.

**Rising Action:** Chen investigates the lock contention first: "Show me current system locks." Claude calls `iris_locks_list` — a long-running batch job is holding 15 locks. He checks the job details: "List running jobs." Claude calls `iris_jobs_list` and identifies the batch process. He then checks the failed task: "Show me the task execution history for the nightly backup task." Claude calls `iris_task_history` — last night's backup failed with a disk space error. He checks the journal: "Show me journal file information." Claude calls `iris_journal_info` and confirms the journal directory is 92% full.

**Climax:** Chen resolves both issues: "Run the journal purge task immediately." Claude calls `iris_task_run` to execute the purge. He verifies with `iris_metrics_system` — disk utilization drops to 61%. He then checks mirror status: "What's the mirror health?" Claude calls `iris_mirror_status` — both failover members are synchronized and healthy. Finally, he reviews the audit trail: "Show me audit events from the last 24 hours for the SYSTEM user." Claude calls `iris_audit_events` — no unexpected administrative actions.

**Resolution:** Chen documented and resolved both alerts in 15 minutes without opening the Management Portal or SSH-ing into any server. He updates the nightly backup task schedule to run the purge first: Claude calls `iris_task_manage` to modify the task sequence. He also exports the current system configuration for the change management record using `iris_config_manage`.

### Journey 6: Mei — The Data Analyst (Tertiary, Data Path)

Mei is a data analyst who uses IRIS as the backend for a document management system and runs BI reports using DeepSee cubes. She needs to set up a new document collection for a pilot project and run analytics on existing data.

**Opening Scene:** Mei installs `@iris-mcp/data` alongside the dev server. She asks Claude: "Create a new document database called PilotFeedback with properties for respondentId, category, rating, and comments."

**Rising Action:** Claude calls `iris_docdb_manage` to create the database, then `iris_docdb_property` to define the four properties and add an index on category. Mei imports her pilot data: "Insert these 50 feedback documents." Claude calls `iris_docdb_document` for each batch. She verifies: "Find all documents where category is 'usability' and rating is less than 3." Claude calls `iris_docdb_find` with the filter criteria — 12 documents match.

**Climax:** Mei pivots to analytics: "List the available DeepSee cubes." Claude calls `iris_analytics_cubes` — she sees the CustomerSatisfaction cube. "Run an MDX query to show average satisfaction score by region for Q1." Claude calls `iris_analytics_mdx` with her query and returns the pivot table. One region is significantly below average. She triggers a cube rebuild to include the latest data: Claude calls `iris_analytics_cubes` with the build action.

**Resolution:** Mei has stood up a new document collection, populated it, queried it, and run cross-dimensional analytics — all through her AI assistant. She starts building a routine where Claude runs her standard reports weekly using the same tool calls.

### Journey Requirements Summary

| Journey | Capabilities Revealed |
|---------|----------------------|
| Marcus (Developer) | Document CRUD, compilation with error feedback, code search, SQL execution, global access, unit test execution, server connectivity |
| Priya (Administrator) | Database/namespace provisioning, user/role management, web application configuration, SSL setup, auto-bootstrap with full privileges |
| Raj (Integration Engineer) | Production status/control, item-level management, log querying, message tracing, lookup table management, adapter configuration |
| Marcus (Edge Case) | Graceful bootstrap degradation, explicit manual instructions, privilege tier detection, IPM fallback |
| Chen (Operations Engineer) | System alerts, lock monitoring, job listing, task execution/history, journal status, mirror health, audit events, system configuration |
| Mei (Data Analyst) | DocDB create/query/manage, document CRUD, property/index management, DeepSee cube listing, MDX query execution, cube build/sync |

## Innovation & Novel Patterns

### Detected Innovation Areas

- **Suite architecture pattern for MCP servers:** Industry best practice recommends 5-15 tools per server, but no existing MCP server suite implements this as a deliberate multi-server architecture for a single platform. IRIS MCP v2 pioneers the "one server per domain" pattern — a reusable model for any complex platform.
- **Self-bootstrapping server-side components via development API:** Using the Atelier REST API (a development tool API) to auto-deploy production infrastructure (REST services, web applications) is a novel inversion — the client installs its own server-side dependencies through the same protocol it will use for normal operations.
- **Full platform AI controllability:** Moving beyond "AI can query the database" to "AI can administer the entire platform" — including security, infrastructure provisioning, production management, and operational monitoring — represents a paradigm shift in how database platforms are managed.

### Validation Approach

- **Suite architecture:** Validate by measuring LLM tool selection accuracy across suites vs. a monolithic 86-tool server. Expect measurably better tool selection and lower latency with suites.
- **Self-bootstrap:** Validate by testing against IRIS Community Edition with varying privilege levels. Success = full auto-install with %Admin_Manage, graceful degradation with %Development only.
- **Full controllability:** Validate with the end-to-end journey test (namespace → database → user → web app → class → tests → production) executed entirely via MCP tools.

## Developer Tool Specific Requirements

### Installation & Distribution

- **Primary distribution:** npm registry
  - `@iris-mcp/dev` — Development tools (21 tools)
  - `@iris-mcp/admin` — Administration tools (22 tools)
  - `@iris-mcp/interop` — Interoperability tools (19 tools)
  - `@iris-mcp/ops` — Operations tools (16 tools)
  - `@iris-mcp/data` — Data & analytics tools (9 tools)
  - `@iris-mcp/all` — Meta-package installing all five
  - `@iris-mcp/shared` — Shared HTTP client, auth, config, types (internal dependency)
- **Secondary distribution:** IPM registry for IRIS-side ObjectScript component
- **Installation:** `npm install -g @iris-mcp/dev` (or any individual package)
- **No native dependencies** — pure Node.js, no compiled modules, no Python runtime

### API Surface

- **Inbound:** MCP protocol (JSON-RPC 2.0) via stdio or Streamable HTTP transport
- **Outbound:** HTTP/REST to IRIS web port — Atelier API (auto-negotiated up to v8) and custom REST service (`/api/executemcp/v1/`)
- **Tool naming convention:** `iris.{category}.{action}` with dot-namespaced hierarchy
- **Tool count per server:** 9-22 (within MCP best practice range)
- **Schema:** JSON Schema 2020-12 for all inputSchema and outputSchema definitions

### MCP Client Compatibility

No custom IDE extension required. Compatible with any MCP client that supports stdio or Streamable HTTP transport:
- Claude Desktop
- Claude Code (CLI and VS Code extension)
- Cursor
- GitHub Copilot (via MCP support)
- Any future MCP-compatible client

Each server is configured independently in the client's MCP configuration with identical connection parameters (host, port, credentials) — only the package/command differs.

### Documentation Requirements

- **Suite-level README:** Explains the 5-server architecture, helps users choose which servers to install, shows quick-start for the most common setup
- **Per-package README:** Installation, configuration, full tool reference with parameters and examples, MCP client config snippets
- **Tool reference:** Auto-generated from tool schemas — name, description, parameters, output schema, annotations
- **Migration guide:** v1 → v2 mapping showing which v1 tools map to which v2 tools, configuration changes, and breaking changes
- **Configuration examples:** MCP client config for Claude Desktop, Claude Code, and Cursor

### Migration Path (v1 → v2)

| v1 Tool | v2 Tool | Server |
|---------|---------|--------|
| `execute_command` | `iris_execute_command` | iris-dev-mcp |
| `execute_classmethod` | `iris_execute_classmethod` | iris-dev-mcp |
| `get_global` | `iris_global_get` | iris-dev-mcp |
| `set_global` | `iris_global_set` | iris-dev-mcp |
| `get_system_info` | `iris_server_info` | iris-dev-mcp |
| `compile_objectscript_class` | `iris_doc_compile` | iris-dev-mcp |
| `compile_objectscript_package` | `iris_doc_compile` | iris-dev-mcp |
| `execute_unit_tests` | `iris_execute_tests` | iris-dev-mcp |
| `execute_sql` | `iris_sql_execute` | iris-dev-mcp |
| `interoperability_production_*` | `iris.production.*` | iris-interop-mcp |

**Breaking changes:** Connection switches from SuperServer (port 1972) to web port (52773). Python native driver replaced with HTTP. Tool names change to dot-namespaced format. Namespace parameter behavior preserved.

### Testing Strategy

- **Unit tests:** Mocked HTTP responses for testing tool parameter validation, error handling, and response parsing in isolation
- **Integration tests:** Every tool tested end-to-end against the local IRIS development instance (connected via VS Code). Each test verifies:
  - Correct HTTP request to IRIS (endpoint, method, headers, body)
  - Successful execution on IRIS
  - Correct response parsing and structured output
  - Error handling for common failure cases (invalid namespace, insufficient privileges, missing resources)
- **Bootstrap tests:** Auto-bootstrap flow tested with varying privilege levels (%Development only, %Admin_Manage)
- **Test environment:** Local IRIS development instance accessible via web port

### Language & Runtime Support

| Runtime/Language | Supported Versions | Notes |
|-----------------|-------------------|-------|
| Node.js | 18 LTS, 20 LTS, 22 LTS | Minimum 18 for native `fetch` support |
| TypeScript | 5.0+ | Source language; compiled to ES2022 JavaScript |
| IRIS | 2023.1+ | Atelier API v1+ required; v8 for full feature set |
| npm | 9+ | Required for workspace support |

### Representative Tool Call Examples

**iris-dev-mcp — Compile and test a class:**
```json
// Tool: iris_doc_compile
{ "doc": "MyApp.Service.PatientLookup.cls", "flags": "ck" }
// Response: { "status": "success", "errors": [], "time": 0.234 }

// Tool: iris_execute_tests
{ "package": "MyApp.Test", "level": "class" }
// Response: { "passed": 14, "failed": 1, "skipped": 0, "results": [...] }
```

**iris-admin-mcp — Provision a namespace:**
```json
// Tool: iris_namespace_manage
{ "action": "create", "name": "DEVPROJECT", "codeDatabase": "DEVPROJECT-CODE", "dataDatabase": "DEVPROJECT-DATA" }
// Response: { "status": "created", "namespace": "DEVPROJECT" }
```

**iris-interop-mcp — Check production status:**
```json
// Tool: iris_production_status
{ "namespace": "ENSDEMO", "detail": true }
// Response: { "name": "Demo.Production", "status": "Running", "items": [...] }
```

**iris-ops-mcp — Retrieve system metrics:**
```json
// Tool: iris_metrics_system
{}
// Response: { "format": "prometheus", "metrics": "iris_cache_hit_ratio 0.97\n..." }
```

**iris-data-mcp — Query a document database:**
```json
// Tool: iris_docdb_find
{ "database": "PilotFeedback", "filter": { "category": "usability", "rating": { "$lt": 3 } } }
// Response: { "count": 12, "documents": [...] }
```

### Implementation Considerations

- **Node.js minimum version:** 18+ (LTS) for native fetch support
- **Build system:** TypeScript with tsconfig project references for monorepo
- **Versioning:** Semver with synchronized versions across all packages in the monorepo
- **Build scripts:** Turborepo tasks for build, test, lint, and type-check

## Product Scope & Phased Development

### MVP Strategy

**MVP Approach:** Platform MVP — all five servers constitute the complete product. Each server delivers incremental value upon release, but the full vision ("full AI controllability of IRIS") requires all five. Sequential epic delivery means users get value as each server ships, not only when all five are complete.

### MVP Feature Set — Sequential Epic Delivery

**Epic 1: Shared Infrastructure**
- TypeScript monorepo setup with npm workspaces
- `@iris-mcp/shared` package: HTTP client with connection pooling, cookie-based auth with Basic Auth fallback, connection health check (`HEAD /api/atelier/`), configuration from environment variables, common types and error handling
- Atelier API version auto-negotiation: call `GET /api/atelier/` at connection, use highest available version (up to v8), graceful degradation with clear error messages for tools requiring newer API versions
- MCP server base: tool registration framework, pagination support, tool annotations, listChanged notifications
- Build and test scripts via Turborepo task orchestration

**Epic 2: iris-dev-mcp (21 tools)**
- Document management via Atelier API (get, put, delete, list, head, modified)
- Compilation (sync and async) via Atelier API
- Code intelligence (index, search, macros) via Atelier API
- XML import/export and format conversion via Atelier API
- SQL execution via Atelier API
- Server info and namespace info via Atelier API
- Integration tests for all Atelier-based tools

**Epic 3: IRIS-Side REST Service + Auto-Bootstrap**
- ExecuteMCPv2.REST.Dispatch and handler classes (ObjectScript)
- ExecuteMCPv2.Setup configuration class
- Auto-bootstrap flow: detect → deploy → compile → configure → fallback instructions
- IPM module.xml for alternative installation
- Global operations (get, set, kill, list) via custom REST
- ObjectScript execution (command, classmethod, unit tests) via custom REST
- Integration tests for all custom REST tools and bootstrap flow

**Epic 4: iris-admin-mcp (22 tools)**
- Namespace and database management via custom REST
- User, role, and resource management via custom REST
- Web application management via custom REST + Atelier
- SSL/TLS configuration management via custom REST
- OAuth2 management via custom REST
- Integration tests for all admin tools

**Epic 5: iris-interop-mcp (19 tools)**
- Production lifecycle (create, control, status, config, items) via custom REST
- Credentials and lookup table management via custom REST
- Rules and transforms via custom REST + InteropEditors API
- Message tracing and queue monitoring via custom REST
- Integration tests for all interop tools

**Epic 6: iris-ops-mcp (16 tools)**
- System metrics, alerts, and interop metrics via Monitor API
- Jobs, locks via Atelier/custom REST
- Journal, mirror, audit, ECP status via custom REST
- Task scheduling (CRUD + run + history) via custom REST
- System configuration management via custom REST
- Integration tests for all ops tools

**Epic 7: iris-data-mcp (9 tools)**
- DocDB operations via DocDB API
- DeepSee/analytics via DeepSee API + custom REST
- REST API management via Mgmnt API
- Debugging and terminal (placeholder for WebSocket in post-MVP)
- Integration tests for all data tools

**Epic 8: Documentation & Release**
- Suite-level README
- Per-package READMEs with tool references
- Migration guide (v1 → v2)
- MCP client configuration examples
- npm publish workflow
- IPM registry publish

### Post-MVP Features

- OAuth2 authentication for MCP servers themselves
- WebSocket-based XDebug and terminal tools (iris-data-mcp enhancement)
- Multi-instance management (connect to multiple IRIS instances)
- Tool usage analytics and audit logging
- `@iris-mcp/all` meta-package with unified configuration

### Vision (Future)

- FHIR/HealthShare-specific MCP server (iris-health-mcp)
- CI/CD pipeline integration (future — GitHub Actions, Jenkins)
- Mirror failover automation tools
- Embedded Python execution tools
- Community-built domain-specific servers on shared infrastructure

### Risk Mitigation Strategy

**Technical Risks:**
- *Atelier API version compatibility:* Auto-negotiate API version at connection time via `GET /api/atelier/`. Use highest available (up to v8). Tools requiring features from newer API versions return clear error messages indicating the minimum version needed. Integration tests run against IRIS Community Edition (latest).
- *Custom REST service deployment failures:* Three-tier fallback (auto → manual instructions → IPM). Integration tests verify all three paths.
- *Tool consolidation usability:* Test `*.manage` pattern tools against natural language prompts. Split back into individual tools if LLM selection accuracy drops below 90%.
- *Suite sprawl:* Risk that 5 servers feels like too many to configure. Mitigate with a meta-package (`@iris-mcp/all`) that installs all five, and clear documentation showing the MCP client config for each server. Each server's config is identical (same host, port, credentials) — just different package names.
- *Bootstrap failure on locked-down instances:* Mitigate with explicit instructions fallback and IPM alternative.

**Market Risks:**
- *MCP ecosystem adoption:* MCP is growing rapidly (spec v2025-11-25, official registry, major client support). Risk is low but mitigated by building on a standard protocol — if MCP wanes, the IRIS-side REST service remains useful independently.
- *IRIS community adoption:* Mitigated by IPM distribution, InterSystems Community posts, and Open Exchange listing.

**Resource Risks:**
- *Reduced capacity:* Epics are independent — can pause after any epic and still ship a useful product. iris-dev-mcp alone (Epics 1-3) already exceeds v1 functionality.
- *IRIS-side REST complexity:* Largest risk. Mitigated by keeping ObjectScript handlers thin (validate → delegate to system classes → return JSON) and reusing patterns across all handler classes.

## Functional Requirements

### Connection & Server Lifecycle

- FR1: MCP client can connect to any IRIS MCP server using IRIS web port URL, username, and password
- FR2: Server can auto-negotiate the Atelier API version supported by the connected IRIS instance
- FR3: Server can maintain a persistent HTTP session with cookie-based authentication to IRIS
- FR4: Server can report its available tools via `tools/list` with cursor-based pagination
- FR5: Server can declare tool annotations (readOnlyHint, destructiveHint, idempotentHint, openWorldHint) for each tool
- FR6: Server can emit `notifications/tools/list_changed` when its tool set changes
- FR7: Server can operate via stdio or Streamable HTTP transport
- FR7b: Developer can specify an optional `namespace` parameter on any namespace-scoped tool to override the configured default (environment variable `IRIS_NAMESPACE`); system-scoped tools always execute in %SYS. See **Appendix A: Tool Namespace Scope Reference** for the complete per-tool mapping.
- FR7c: Developer can execute namespace-scoped tools in any accessible namespace without affecting the namespace context of other concurrent tool calls or the server's default namespace.

### Auto-Bootstrap & Installation

- FR8: Server can detect whether the IRIS-side custom REST service is installed
- FR9: Server can deploy ObjectScript classes to IRIS via the Atelier API when the REST service is missing
- FR10: Server can compile deployed ObjectScript classes via the Atelier API
- FR11: Server can execute the configuration class method to register the `/api/executemcp` web application
- FR12: Server can detect insufficient privileges during bootstrap and report which steps succeeded and which failed
- FR13: Server can provide explicit manual instructions (Terminal commands, SMP navigation) for completing failed bootstrap steps
- FR14: Server can suggest IPM installation as an alternative when bootstrap partially fails
- FR15: Server can skip completed bootstrap steps on subsequent connections

### Document Management

- FR16: Developer can retrieve the content of any ObjectScript class, routine, CSP page, or include file
- FR17: Developer can create or update documents by pushing content to IRIS
- FR18: Developer can delete one or more documents
- FR19: Developer can list documents in a namespace filtered by category (CLS, RTN, CSP, OTH) and type
- FR20: Developer can check document existence and retrieve modification timestamps
- FR21: Developer can retrieve documents modified since a given timestamp

### Compilation & Build

- FR22: Developer can compile one or more documents with configurable compilation flags
- FR23: Developer can queue asynchronous compilation and poll for completion status
- FR24: Developer can receive detailed compilation errors with source locations

### Code Intelligence

- FR25: Developer can get class structure including methods, properties, parameters, and superclasses
- FR26: Developer can perform full-text search across documents with regex, wildcard, and case-sensitivity options
- FR27: Developer can retrieve macro definitions, source locations, and expansion
- FR28: Developer can convert documents between UDL and XML formats

### XML Import/Export

- FR29: Developer can export documents to legacy XML format
- FR30: Developer can import documents from XML files
- FR31: Developer can list documents contained in XML files before importing

### SQL & Data Access

- FR32: Developer can execute SQL queries with parameterized inputs and configurable row limits
- FR33: Developer can retrieve global values with complex subscript support
- FR34: Developer can set global values with automatic verification
- FR35: Developer can kill global nodes or subtrees
- FR36: Developer can list globals in a namespace with optional filtering

### ObjectScript Execution

- FR37: Developer can execute ObjectScript commands with captured I/O output
- FR38: Developer can call class methods with positional parameters and output parameter support
- FR39: Developer can run unit tests at package, class, or individual method level with structured results

### Namespace & Database Administration

- FR40: Administrator can create, modify, or delete namespaces with code and data database bindings
- FR41: Administrator can list all namespaces with their database associations
- FR42: Administrator can create, modify, or delete databases with full configuration options
- FR43: Administrator can list databases with size, free space, and mount status
- FR44: Administrator can create or delete global, routine, and package mappings between namespaces
- FR45: Administrator can list all mappings for a given namespace

### User & Security Management

- FR46: Administrator can create, modify, or delete user accounts with roles, password, and properties
- FR47: Administrator can retrieve user properties or list all users
- FR48: Administrator can add or remove roles from users
- FR49: Administrator can change or validate user passwords against policy
- FR50: Administrator can create, modify, or delete security roles with resource grants
- FR51: Administrator can list all roles
- FR52: Administrator can create, modify, or delete security resources
- FR53: Administrator can list all resources
- FR54: Administrator can check whether a user or role has specific permissions on a resource

### Web Application Management

- FR55: Administrator can create, modify, or delete CSP/REST web applications with full configuration
- FR56: Administrator can retrieve web application properties
- FR57: Administrator can list all web applications, optionally filtered by namespace

### SSL/TLS & Certificate Management

- FR58: Administrator can create, modify, or delete SSL/TLS configurations
- FR59: Administrator can list all SSL/TLS configurations with their details

### OAuth2 Management

- FR60: Administrator can create OAuth2 server definitions and register client applications
- FR61: Administrator can perform OpenID Connect discovery from an issuer URL
- FR62: Administrator can list OAuth2 configurations and retrieve client details

### Production Lifecycle Management

- FR63: Integration engineer can create or delete Interoperability productions
- FR64: Integration engineer can start, stop, restart, update, or recover productions
- FR65: Integration engineer can get production status with optional item-level detail
- FR66: Integration engineer can get production summary across all namespaces
- FR67: Integration engineer can enable or disable individual config items
- FR68: Integration engineer can get or set config item host and adapter settings
- FR69: Integration engineer can configure production auto-start

### Production Monitoring & Debugging

- FR70: Integration engineer can query production event logs filtered by type, item, and count
- FR71: Integration engineer can view queue status for all production items
- FR72: Integration engineer can trace message flow by session or header ID
- FR73: Integration engineer can list available adapter types by category

### Interoperability Configuration

- FR74: Integration engineer can create, update, or delete Ensemble credentials
- FR75: Integration engineer can list stored credentials
- FR76: Integration engineer can get, set, or delete lookup table entries
- FR77: Integration engineer can import or export lookup tables in XML format
- FR78: Integration engineer can list business rule classes and get rule definitions
- FR79: Integration engineer can list data transformation classes and test transforms with sample input

### REST API Management

- FR80: Integration engineer can create REST applications from OpenAPI specs, delete them, or retrieve their specs

### System Monitoring

- FR81: Operations engineer can retrieve Prometheus-format system metrics
- FR82: Operations engineer can retrieve system alerts
- FR83: Operations engineer can retrieve interoperability volume and interface metrics
- FR84: Operations engineer can list running IRIS jobs and processes
- FR85: Operations engineer can list system locks
- FR86: Operations engineer can view journal file information and list journal files
- FR87: Operations engineer can check mirror configuration, membership, and status
- FR88: Operations engineer can query audit log events
- FR89: Operations engineer can check database integrity status
- FR90: Operations engineer can view license usage and details
- FR91: Operations engineer can check ECP client/server connection status

### Task Scheduling

- FR92: Operations engineer can create, modify, or delete scheduled tasks
- FR93: Operations engineer can list all scheduled tasks with their schedules
- FR94: Operations engineer can execute a task immediately
- FR95: Operations engineer can view task execution history

### System Configuration

- FR96: Operations engineer can retrieve or modify system configuration parameters
- FR97: Operations engineer can retrieve or modify startup configuration
- FR98: Operations engineer can view NLS/locale configuration
- FR99: Operations engineer can export system configuration

### Document Database (DocDB)

- FR100: Data engineer can create or drop document databases
- FR101: Data engineer can insert, retrieve, update, or delete documents by ID
- FR102: Data engineer can query documents with filter criteria
- FR103: Data engineer can create or drop document properties and indexes

### Analytics

- FR104: Analyst can execute MDX queries on DeepSee cubes
- FR105: Analyst can list available cubes or trigger cube build/synchronization

### Debugging (Post-MVP — Deferred to iris-data-mcp v2.1)

FR106 and FR107 (XDebug sessions and terminal WebSocket) are deferred to post-MVP. They require WebSocket transport support not included in the initial MCP server implementation. See Post-MVP Features in Product Scope for details.

## Non-Functional Requirements

### Performance

- Read-only tools (`*.list`, `*.get`, `*.status`, `*.info`) must respond within 2 seconds under normal IRIS load
- Compilation tools must return within 30 seconds for single classes, 120 seconds for full packages
- SQL execution must return first results within 5 seconds (with configurable row limits to prevent unbounded queries)
- Auto-bootstrap (full flow: detect → deploy → compile → configure) must complete within 60 seconds
- Tool listing (`tools/list`) must respond within 500ms regardless of tool count

### Security

- Credentials (IRIS username/password) must never be logged, included in error messages, or exposed in tool responses
- All HTTP communication to IRIS must support HTTPS (TLS) when configured
- The MCP server must not escalate privileges beyond what the connected IRIS user has — IRIS's own permission model is the authority
- Tool annotations must accurately reflect destructive potential — `destructiveHint: true` for all tools that can delete or modify data
- The custom REST service must validate all inputs (type, range, format, and required fields) against the tool's inputSchema before passing to IRIS system classes
- The custom REST service must not expose internal IRIS error details (stack traces, global references) to external callers

### Integration

- Full compliance with MCP specification v2025-11-25 — pagination, tool annotations, listChanged, structured output, outputSchema
- Atelier API compatibility with auto-negotiated versions (v1 through v8)
- HTTP client must handle IRIS session cookies (automatic re-send), CSRF tokens (extract and include in subsequent requests), and connection timeouts (configurable via IRIS_TIMEOUT env var, default 60 seconds, with specific error code on timeout)
- Tool responses must follow the MCP content format (TextContent with optional structuredContent)
- Error responses must use MCP's two-tier model: protocol errors (JSON-RPC) for structural issues, tool execution errors (`isError: true`) with actionable messages for IRIS-side failures

### Reliability

- Connection loss to IRIS must be detected within 2 seconds and reported with an error response containing error code, human-readable message, and recovery suggestion — not silently fail
- HTTP session expiration must be handled with automatic re-authentication
- Auto-bootstrap must be idempotent — safe to run multiple times without side effects
- Failed tool calls must not leave IRIS in an inconsistent state (e.g., partially created namespaces)
- The custom REST service must not leave the IRIS connection in a different namespace after tool execution, even when the tool encounters an error — the namespace must always be restored to the configured default

## Appendix A: Tool Namespace Scope Reference

The following table defines the namespace scope for every tool across all five servers. Tools marked **NS** accept an optional `namespace` parameter. Tools marked **SYS** always execute in %SYS. Tools marked **BOTH** accept an optional namespace for filtering. Tools marked **NONE** have no namespace context.

### iris-dev-mcp

| Tool | Scope | Namespace Parameter |
|------|-------|-------------------|
| `iris_doc_get` | NS | Yes — target namespace |
| `iris_doc_put` | NS | Yes — target namespace |
| `iris_doc_delete` | NS | Yes — target namespace |
| `iris_doc_list` | NS | Yes — target namespace |
| `iris_doc_compile` | NS | Yes — target namespace |
| `iris_doc_search` | NS | Yes — target namespace |
| `iris_doc_index` | NS | Yes — target namespace |
| `iris_doc_xml_export` | NS | Yes — target namespace |
| `iris_doc_convert` | NS | Yes — target namespace |
| `iris_macro_info` | NS | Yes — target namespace |
| `iris_sql_execute` | NS | Yes — target namespace |
| `iris_global_get` | NS | Yes — target namespace |
| `iris_global_set` | NS | Yes — target namespace |
| `iris_global_kill` | NS | Yes — target namespace |
| `iris_global_list` | NS | Yes — target namespace |
| `iris_execute_command` | NS | Yes — target namespace |
| `iris_execute_classmethod` | NS | Yes — target namespace |
| `iris_execute_tests` | NS | Yes — target namespace |
| `iris_server_info` | NONE | No |
| `iris_server_namespace` | NS | Yes — target namespace |

### iris-admin-mcp

| Tool | Scope | Namespace Parameter |
|------|-------|-------------------|
| `iris_namespace_manage` | SYS | No — always %SYS (target namespace is a data parameter) |
| `iris_namespace_list` | NONE | No |
| `iris_database_manage` | SYS | No — always %SYS |
| `iris_database_list` | SYS | No — always %SYS |
| `iris_mapping_manage` | SYS | No — always %SYS (target namespace is a data parameter) |
| `iris_mapping_list` | SYS | No — always %SYS (target namespace is a data parameter) |
| `iris_user_manage` | SYS | No — always %SYS |
| `iris_user_get` | SYS | No — always %SYS |
| `iris_user_roles` | SYS | No — always %SYS |
| `iris_user_password` | SYS | No — always %SYS |
| `iris_role_manage` | SYS | No — always %SYS |
| `iris_role_list` | SYS | No — always %SYS |
| `iris_resource_manage` | SYS | No — always %SYS |
| `iris_resource_list` | SYS | No — always %SYS |
| `iris_permission_check` | SYS | No — always %SYS |
| `iris_webapp_manage` | SYS | No — always %SYS |
| `iris_webapp_get` | SYS | No — always %SYS |
| `iris_webapp_list` | BOTH | Optional — filter by namespace |
| `iris_ssl_manage` | SYS | No — always %SYS |
| `iris_ssl_list` | SYS | No — always %SYS |
| `iris_oauth_manage` | SYS | No — always %SYS |
| `iris_oauth_list` | SYS | No — always %SYS |

### iris-interop-mcp

| Tool | Scope | Namespace Parameter |
|------|-------|-------------------|
| `iris_production_manage` | NS | Yes — target namespace |
| `iris_production_control` | NS | Yes — target namespace |
| `iris_production_status` | NS | Yes — target namespace |
| `iris_production_summary` | NONE | No — queries all namespaces |
| `iris_production_item` | NS | Yes — target namespace |
| `iris_production_autostart` | NS | Yes — target namespace |
| `iris_production_logs` | NS | Yes — target namespace |
| `iris_production_queues` | NS | Yes — target namespace |
| `iris_production_messages` | NS | Yes — target namespace |
| `iris_production_adapters` | NS | Yes — target namespace |
| `iris_credential_manage` | NS | Yes — target namespace |
| `iris_credential_list` | NS | Yes — target namespace |
| `iris_lookup_manage` | NS | Yes — target namespace |
| `iris_lookup_transfer` | NS | Yes — target namespace |
| `iris_rule_list` | NS | Yes — target namespace |
| `iris_rule_get` | NS | Yes — target namespace |
| `iris_transform_list` | NS | Yes — target namespace |
| `iris_transform_test` | NS | Yes — target namespace |
| `iris_interop_rest` | NS | Yes — target namespace |

### iris-ops-mcp

| Tool | Scope | Namespace Parameter |
|------|-------|-------------------|
| `iris_metrics_system` | NONE | No |
| `iris_metrics_alerts` | NONE | No |
| `iris_metrics_interop` | NONE | No |
| `iris_jobs_list` | NONE | No |
| `iris_locks_list` | NONE | No |
| `iris_journal_info` | SYS | No — always %SYS |
| `iris_mirror_status` | SYS | No — always %SYS |
| `iris_audit_events` | SYS | No — always %SYS |
| `iris_database_check` | SYS | No — always %SYS |
| `iris_license_info` | NONE | No |
| `iris_ecp_status` | SYS | No — always %SYS |
| `iris_task_manage` | SYS | No — always %SYS |
| `iris_task_list` | SYS | No — always %SYS |
| `iris_task_run` | SYS | No — always %SYS |
| `iris_task_history` | SYS | No — always %SYS |
| `iris_config_manage` | SYS | No — always %SYS |

### iris-data-mcp

| Tool | Scope | Namespace Parameter |
|------|-------|-------------------|
| `iris_docdb_manage` | NS | Yes — target namespace |
| `iris_docdb_document` | NS | Yes — target namespace |
| `iris_docdb_find` | NS | Yes — target namespace |
| `iris_docdb_property` | NS | Yes — target namespace |
| `iris_analytics_mdx` | NS | Yes — target namespace |
| `iris_analytics_cubes` | NS | Yes — target namespace |
| `iris_debug_session` | NS | Yes — target namespace |
| `iris_debug_terminal` | NS | Yes — target namespace |
| `iris_rest_manage` | NS | Yes — target namespace |

### Scope Summary

| Scope | Count | Description |
|-------|-------|-------------|
| NS | 52 | Namespace-specific — accepts `namespace` parameter |
| SYS | 25 | System-wide — always executes in %SYS |
| BOTH | 1 | Dual scope — optional namespace filter |
| NONE | 8 | No namespace context |
| **Total** | **86** | |
