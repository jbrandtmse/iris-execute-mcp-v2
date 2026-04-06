# IRIS MCP v2 — Server Suite Categorization

**Date:** 2026-04-05  
**Purpose:** Organize the 142 identified tools into separate MCP server suites, each focused on a single domain, following the industry best practice of 5-20 tools per server.

---

## Design Rationale

- **Industry best practice:** 5-15 tools per server; performance cliff past ~20 tools
- **GitHub's evidence:** Reducing from 40 to 13 tools improved benchmarks 2-5% + 400ms latency reduction
- **MCP spec support:** Multiple servers can run simultaneously; clients aggregate tool lists
- **Shared infrastructure:** All servers share the same IRIS connection config (host, port, credentials)
- **Independent deployment:** Each server can be installed/configured independently based on user needs

---

## Suite Overview

| Suite | Server Name | Tools | Primary API | Target User |
|-------|-------------|-------|-------------|-------------|
| 1 | **iris-dev-mcp** | 20 | Atelier REST API | Developers |
| 2 | **iris-admin-mcp** | 22 | Custom REST Service | System Administrators |
| 3 | **iris-interop-mcp** | 19 | Custom REST Service | Integration Engineers |
| 4 | **iris-ops-mcp** | 16 | Mixed (Monitor API + Custom) | Operations / DevOps |
| 5 | **iris-data-mcp** | 9 | Mixed (DocDB API + Atelier SQL) | Data Engineers / Analysts |
| — | **Total** | **86** | — | — |

**Note:** The original 142 tools are reduced to **86** through intentional consolidation of granular CRUD tools into broader, outcome-oriented tools (per MCP best practices). Each consolidated tool handles multiple related operations via parameters rather than exposing separate tools for each verb.

---

## Suite 1: iris-dev-mcp — Development Tools

**Focus:** ObjectScript development lifecycle — editing, compiling, testing, searching, and debugging code.  
**Primary API:** Atelier REST API (v8) — nearly all tools use existing endpoints, minimal custom code.  
**Target user:** Developers writing and maintaining ObjectScript classes, routines, and CSP pages.

| # | Tool Name | Scope | Description | Consolidates | Implementation |
|---|-----------|-------|-------------|-------------|----------------|
| 1 | `iris.doc.get` | NS | Retrieve one or more documents (classes, routines, CSP, includes) | get_document, get_documents, head_document | Atelier: GET/HEAD /doc, POST /docs |
| 2 | `iris.doc.put` | NS | Create or update a document | put_document | Atelier: PUT /doc |
| 3 | `iris.doc.delete` | NS | Delete one or more documents | delete_document, delete_documents | Atelier: DELETE /doc, /docs |
| 4 | `iris.doc.list` | NS | List documents by category/type with optional filter | list_documents, get_modified_documents | Atelier: GET /docnames, POST /modified |
| 5 | `iris.doc.compile` | NS | Compile documents (sync or async with polling) | compile_documents, compile_async | Atelier: POST /action/compile, /work |
| 6 | `iris.doc.search` | NS | Full-text search across code (regex, wildcard, case options) | search_code | Atelier: GET /action/search |
| 7 | `iris.doc.index` | NS | Get class structure (methods, properties, parameters, supers) | index_classes | Atelier: POST /action/index |
| 8 | `iris.doc.xml_export` | NS | Export documents to XML or import from XML files | export_to_xml, load_from_xml, list_xml_contents | Atelier: POST /action/xml/* |
| 9 | `iris.doc.convert` | NS | Convert between UDL and XML formats | format_convert | Atelier: POST /cvt/* |
| 10 | `iris.macro.info` | NS | Get macro definition, location, list, or expansion | get_macro_definition, get_macro_list, get_macro_location | Atelier: POST /action/getmacro* |
| 11 | `iris.sql.execute` | NS | Execute SQL query with parameters and row limits | execute_sql | Atelier: POST /action/query |
| 12 | `iris.global.get` | NS | Retrieve global value(s) with subscript support | get_global | Custom REST |
| 13 | `iris.global.set` | NS | Set global value with verification | set_global | Custom REST |
| 14 | `iris.global.kill` | NS | Kill a global node or subtree | kill_global | Custom REST |
| 15 | `iris.global.list` | NS | List globals in namespace with optional filter | list_globals | Custom REST |
| 16 | `iris.execute.command` | NS | Execute ObjectScript commands with I/O capture | execute_command | Custom REST |
| 17 | `iris.execute.classmethod` | NS | Call class methods with parameters and output params | execute_classmethod | Custom REST |
| 18 | `iris.execute.tests` | NS | Run unit tests (package, class, or method level) | execute_unit_tests | Custom REST |
| 19 | `iris.server.info` | NONE | Server version, namespaces, features, API level | get_server_info, list_namespaces | Atelier: GET / |
| 20 | `iris.server.namespace` | NS | Detailed namespace info (databases, enabled status) | get_namespace_info | Atelier: GET /v8/{ns} |

**Tool count: 20** (consolidated from 34 original tools)  
**Atelier API coverage: 14 of 20** (70%) — only globals and execution need custom REST

### Annotations Strategy
| Pattern | readOnly | destructive | idempotent |
|---------|----------|-------------|------------|
| `iris.doc.get`, `iris.doc.list`, `iris.doc.search`, `iris.doc.index`, `iris.macro.info`, `iris.server.*` | true | false | true |
| `iris.doc.put`, `iris.doc.compile`, `iris.global.set` | false | false | true |
| `iris.doc.delete`, `iris.global.kill` | false | **true** | false |
| `iris.execute.*`, `iris.sql.execute` | false | false | false |

---

## Suite 2: iris-admin-mcp — Administration Tools

**Focus:** IRIS server infrastructure — namespaces, databases, users, roles, web apps, SSL, OAuth.  
**Primary API:** Custom REST Service (wraps Security.*, Config.*, %Installer classes).  
**Target user:** System administrators configuring and managing IRIS instances.

| # | Tool Name | Scope | Description | Consolidates | Implementation |
|---|-----------|-------|-------------|-------------|----------------|
| 1 | `iris.namespace.manage` | SYS | Create, modify, or delete namespaces | create_namespace, delete_namespace | Custom REST → Config.Namespaces |
| 2 | `iris.namespace.list` | NONE | List all namespaces with database bindings | list_namespaces (detailed) | Custom REST → %SYS.Namespace |
| 3 | `iris.database.manage` | SYS | Create, modify, or delete databases | create_database, delete_database | Custom REST → Config.Databases + SYS.Database |
| 4 | `iris.database.list` | SYS | List databases with size, free space, mount status | list_databases, get_database_info | Custom REST → %SYS.DatabaseQuery |
| 5 | `iris.mapping.manage` | SYS | Create or delete global/routine/package mappings | create_mapping, delete_mapping | Custom REST → Config.Map* |
| 6 | `iris.mapping.list` | SYS | List all mappings for a namespace | list_mappings | Custom REST |
| 7 | `iris.user.manage` | SYS | Create, modify, or delete users | create_user, modify_user, delete_user | Custom REST → Security.Users |
| 8 | `iris.user.get` | SYS | Get user properties or list all users | get_user, list_users | Custom REST → Security.Users |
| 9 | `iris.user.roles` | SYS | Add or remove roles from a user | add_user_roles, remove_user_roles | Custom REST → Security.Users |
| 10 | `iris.user.password` | SYS | Change or validate user password | change_password, validate_password | Custom REST → $SYSTEM.Security |
| 11 | `iris.role.manage` | SYS | Create, modify, or delete roles | create_role, modify_role, delete_role | Custom REST → Security.Roles |
| 12 | `iris.role.list` | SYS | List all roles with granted resources | list_roles | Custom REST |
| 13 | `iris.resource.manage` | SYS | Create, modify, or delete security resources | create_resource, modify_resource, delete_resource | Custom REST → Security.Resources |
| 14 | `iris.resource.list` | SYS | List all resources | list_resources | Custom REST |
| 15 | `iris.permission.check` | SYS | Check user/role permissions on a resource | check_permission | Custom REST → $SYSTEM.Security.Check |
| 16 | `iris.webapp.manage` | SYS | Create, modify, or delete web applications | create_web_application, modify_web_application, delete_web_application | Custom REST → Security.Applications |
| 17 | `iris.webapp.get` | SYS | Get web application properties | get_web_application | Custom REST → Security.Applications |
| 18 | `iris.webapp.list` | BOTH | List all web/REST applications | list_web_applications, list_rest_applications | Atelier + Mgmnt API |
| 19 | `iris.ssl.manage` | SYS | Create, modify, or delete SSL/TLS configurations | create/modify/delete/get_ssl_config | Custom REST → Security.SSLConfigs |
| 20 | `iris.ssl.list` | SYS | List all SSL/TLS configurations | list_ssl_configs | Custom REST |
| 21 | `iris.oauth.manage` | SYS | Create OAuth2 server/client, discover via OIDC | create_oauth2_server, create_oauth2_client, discover_oauth2 | Custom REST → %SYS.OAuth2 |
| 22 | `iris.oauth.list` | SYS | List OAuth2 configurations and client details | get_oauth2_client, list_oauth2_configs | Custom REST |

**Tool count: 22** (consolidated from 52 original tools)  
**Custom REST coverage: 21 of 22** (95%) — nearly all require custom ObjectScript service in %SYS

### Annotations Strategy
| Pattern | readOnly | destructive | idempotent |
|---------|----------|-------------|------------|
| `*.list`, `*.get`, `*.check` | true | false | true |
| `*.manage` (create/modify) | false | false | false |
| `*.manage` (delete operations within) | false | **true** | false |

**Note:** Since `*.manage` tools handle both create and delete, the `destructiveHint` should be `true` for safety. The tool description should clearly state: "Supports actions: create, modify, delete. Delete operations are irreversible."

---

## Suite 3: iris-interop-mcp — Interoperability Tools

**Focus:** Ensemble/Interoperability production lifecycle — start, stop, configure, monitor productions.  
**Primary API:** Custom REST Service (wraps Ens.Director, Ens.Config.*, Ens.Util.*).  
**Target user:** Integration engineers building and managing interoperability productions.

| # | Tool Name | Scope | Description | Consolidates | Implementation |
|---|-----------|-------|-------------|-------------|----------------|
| 1 | `iris.production.manage` | NS | Create, delete, or configure a production | production_create, production_delete, production_get_config | Custom REST → Ens.Config.Production |
| 2 | `iris.production.control` | NS | Start, stop, restart, update, or recover a production | production_start, production_stop, production_restart, production_update, production_recover | Custom REST → Ens.Director |
| 3 | `iris.production.status` | NS | Get production status with optional item-level details | production_status, production_needs_update | Custom REST → Ens.Director |
| 4 | `iris.production.summary` | NONE | Get production summary across all namespaces | production_summary | Custom REST → Ens.Director |
| 5 | `iris.production.item` | NS | Enable/disable config items or get/set item settings | production_item_enable, production_item_settings | Custom REST → Ens.Director |
| 6 | `iris.production.autostart` | NS | Configure production auto-start settings | production_auto_start | Custom REST → Ens.Director |
| 7 | `iris.production.logs` | NS | Query production event logs with type/item filters | production_logs | Custom REST (SQL on Ens_Util.Log) |
| 8 | `iris.production.queues` | NS | Get queue status for all items | production_queues | Custom REST |
| 9 | `iris.production.messages` | NS | Trace message flow by session/header ID | production_message_trace | Custom REST (SQL on Ens.MessageHeader) |
| 10 | `iris.production.adapters` | NS | List available adapter types by category | production_list_adapters | Atelier: GET /ens/classes/{type} |
| 11 | `iris.credential.manage` | NS | Create, update, or delete Ensemble credentials | credential_create, credential_delete | Custom REST → Ens.Config.Credentials |
| 12 | `iris.credential.list` | NS | List all stored credentials | credential_list | Custom REST |
| 13 | `iris.lookup.manage` | NS | Get, set, or delete lookup table entries | lookup_table_get, lookup_table_set, lookup_table_delete | Custom REST → Ens.Util.LookupTable |
| 14 | `iris.lookup.transfer` | NS | Import or export lookup tables (XML) | lookup_table_import, lookup_table_export | Custom REST |
| 15 | `iris.rule.list` | NS | List business rule classes and their types | list_rules | InteropEditors API |
| 16 | `iris.rule.get` | NS | Get rule definition and structure | get_rule_definition | Custom REST |
| 17 | `iris.transform.list` | NS | List data transformation classes | list_transforms | Custom REST (SQL) |
| 18 | `iris.transform.test` | NS | Test a transformation with sample input | test_transform | Custom REST |
| 19 | `iris.interop.rest` | NS | Create REST application from OpenAPI spec | create_rest_application, delete_rest_application, get_rest_openapi_spec | Mgmnt API |

**Tool count: 19** (consolidated from 34 original tools)  
**Custom REST coverage: 16 of 19** (84%)

### Annotations Strategy
| Pattern | readOnly | destructive | idempotent |
|---------|----------|-------------|------------|
| `*.status`, `*.summary`, `*.list`, `*.get`, `*.queues`, `*.messages`, `*.logs`, `*.adapters` | true | false | true |
| `*.manage` (create/update) | false | false | false |
| `*.control` (start/stop/restart) | false | false | false |
| `*.manage` (delete) | false | **true** | false |

---

## Suite 4: iris-ops-mcp — Operations & Monitoring Tools

**Focus:** System health, monitoring, scheduled tasks, journals, mirrors, and diagnostics.  
**Primary API:** Mixed — Monitor API for metrics, Custom REST for everything else.  
**Target user:** Operations engineers, DevOps, on-call support.

| # | Tool Name | Scope | Description | Consolidates | Implementation |
|---|-----------|-------|-------------|-------------|----------------|
| 1 | `iris.metrics.system` | NONE | Prometheus-format system metrics | get_system_metrics | Monitor API: GET /api/monitor/metrics |
| 2 | `iris.metrics.alerts` | NONE | System alerts as JSON | get_system_alerts | Monitor API: GET /api/monitor/alerts |
| 3 | `iris.metrics.interop` | NONE | Interoperability volume and interface metrics | get_interop_metrics | Monitor API: GET /api/monitor/interop/* |
| 4 | `iris.jobs.list` | NONE | List running IRIS jobs/processes | list_jobs | Atelier: GET /%25SYS/jobs |
| 5 | `iris.locks.list` | NONE | List system locks | list_locks | Custom REST → %SYS.LockQuery |
| 6 | `iris.journal.info` | SYS | Current journal file info and list of journal files | get_journal_info, list_journal_files | Custom REST → %SYS.Journal |
| 7 | `iris.mirror.status` | SYS | Mirror configuration, membership, and status | get_mirror_status | Custom REST → $SYSTEM.Mirror |
| 8 | `iris.audit.events` | SYS | Query audit log events with filters | get_audit_events | Custom REST → %SYS.Audit |
| 9 | `iris.database.check` | SYS | Check database integrity status | get_database_integrity | Custom REST |
| 10 | `iris.license.info` | NONE | License usage, type, and details | get_license_info | Custom REST → %SYSTEM.License |
| 11 | `iris.ecp.status` | SYS | ECP client/server connection status | get_ecp_status | Custom REST |
| 12 | `iris.task.manage` | SYS | Create, modify, or delete scheduled tasks | create_task, modify_task, delete_task | Custom REST → %SYS.Task |
| 13 | `iris.task.list` | SYS | List all scheduled tasks with schedules | list_tasks | Custom REST (SQL on %SYS.Task) |
| 14 | `iris.task.run` | SYS | Execute a task immediately | run_task | Custom REST |
| 15 | `iris.task.history` | SYS | Get task execution history | get_task_history | Custom REST (SQL) |
| 16 | `iris.config.manage` | SYS | Get or modify system configuration (memory, journals, NLS, startup) | get/modify_system_config, get/modify_startup_config, get_nls_config, export_config | Custom REST → %SYSTEM.Config, Config.* |

**Tool count: 16** (consolidated from 24 original tools)  
**Custom REST coverage: 11 of 16** (69%)

### Annotations Strategy
| Pattern | readOnly | destructive | idempotent |
|---------|----------|-------------|------------|
| `*.list`, `*.info`, `*.status`, `*.check`, `*.events`, `*.history`, `iris.metrics.*` | true | false | true |
| `iris.task.manage` (create/modify) | false | false | false |
| `iris.task.manage` (delete) | false | **true** | false |
| `iris.task.run` | false | false | false |
| `iris.config.manage` (modify) | false | **true** | true |

---

## Suite 5: iris-data-mcp — Data & Analytics Tools

**Focus:** Document databases (DocDB), DeepSee/BI analytics, and debugging/terminal.  
**Primary API:** DocDB API + DeepSee API + Atelier WebSocket.  
**Target user:** Data engineers, analysts, and advanced developers.

| # | Tool Name | Scope | Description | Consolidates | Implementation |
|---|-----------|-------|-------------|-------------|----------------|
| 1 | `iris.docdb.manage` | NS | Create or drop document databases | docdb_create_database, docdb_drop_database | DocDB API |
| 2 | `iris.docdb.document` | NS | Insert, get, update, or delete documents | docdb_insert_document + CRUD | DocDB API |
| 3 | `iris.docdb.find` | NS | Query documents with filters | docdb_find_documents | DocDB API |
| 4 | `iris.docdb.property` | NS | Create or drop document properties/indexes | docdb_manage_property | DocDB API |
| 5 | `iris.analytics.mdx` | NS | Execute MDX query on DeepSee cube | execute_mdx_query | DeepSee API |
| 6 | `iris.analytics.cubes` | NS | List available cubes or build/sync a cube | list_cubes, build_cube | DeepSee API + Custom REST |
| 7 | `iris.debug.session` | NS | Start XDebug WebSocket session or get CSP debug ID | start_debug_session, get_csp_debug_id | Atelier WebSocket |
| 8 | `iris.debug.terminal` | NS | Execute commands via terminal WebSocket (v7+) | terminal_execute | Atelier WebSocket |
| 9 | `iris.rest.manage` | NS | Create, delete, or get OpenAPI spec for REST applications | create/delete_rest_application, get_rest_openapi_spec | Mgmnt API |

**Tool count: 9** (consolidated from 15 original tools)  
**Built-in API coverage: 8 of 9** (89%)

### Annotations Strategy
| Pattern | readOnly | destructive | idempotent |
|---------|----------|-------------|------------|
| `*.find`, `*.cubes` (list), `*.mdx` | true | false | true |
| `*.manage` (create), `*.document` (insert/update) | false | false | false |
| `*.manage` (drop/delete) | false | **true** | false |
| `iris.debug.*` | false | false | false |

---

## Consolidation Summary

### Original → Consolidated Tool Counts

| Suite | Original Tools | Consolidated Tools | Reduction |
|-------|---------------|-------------------|-----------|
| iris-dev-mcp | 34 | **20** | 41% |
| iris-admin-mcp | 52 | **22** | 58% |
| iris-interop-mcp | 34 | **19** | 44% |
| iris-ops-mcp | 24 | **16** | 33% |
| iris-data-mcp | 15 | **9** | 40% |
| **Total** | **142** → | **86** | **39%** |

*Note: 17 tools from the original list were absorbed into other tools via the `*.manage` pattern where a single tool handles create/modify/delete via an `action` parameter.*

### Consolidation Techniques Used

1. **CRUD → manage pattern:** `create_user` + `modify_user` + `delete_user` → `iris.user.manage` with `action: "create" | "modify" | "delete"` parameter
2. **Get/List → single tool:** `get_user` + `list_users` → `iris.user.get` (returns one if name provided, list if not)
3. **Related operations → single tool:** `get_macro_definition` + `get_macro_list` + `get_macro_location` → `iris.macro.info` with `type: "definition" | "list" | "location"` parameter
4. **Lifecycle → control tool:** 5 production control actions → `iris.production.control` with `action: "start" | "stop" | "restart" | "update" | "recover"` parameter

---

## Implementation Priority

### Phase 1: iris-dev-mcp (MVP)
- **Why first:** Immediate value for AI-assisted IRIS development
- **Effort:** Low — 14 of 20 tools use existing Atelier API, only 6 need custom REST
- **Timeline:** First to build

### Phase 2: iris-admin-mcp
- **Why second:** Required for setting up new IRIS environments programmatically
- **Effort:** High — 21 of 22 tools need custom REST service in %SYS
- **Dependency:** Requires deploying `ExecuteMCPv2.REST.Dispatch` on IRIS

### Phase 3: iris-interop-mcp
- **Why third:** Essential for Ensemble/Interoperability users
- **Effort:** Medium — custom REST wrapping well-documented Ens.Director API
- **Dependency:** Requires Interoperability-enabled namespace

### Phase 4: iris-ops-mcp
- **Why fourth:** Operations monitoring and task management
- **Effort:** Medium — mix of built-in Monitor API and custom REST
- **Timeline:** After core servers are stable

### Phase 5: iris-data-mcp
- **Why last:** Niche use cases (DocDB, analytics, debugging)
- **Effort:** Low — mostly built-in APIs
- **Timeline:** When demand warrants

---

## Shared Infrastructure

All five servers share:

1. **Connection configuration:** IRIS host, web port, credentials (env vars or config file)
2. **HTTP client:** Persistent connection pool to IRIS web port
3. **Authentication:** Cookie-based session with Basic Auth fallback
4. **Error handling:** Consistent JSON response format with `isError` and actionable messages
5. **Namespace parameter:** All NS-scoped tools accept optional `namespace` with configurable default
6. **Logging:** Structured logging for audit trail

### Shared Package Structure
```
iris-mcp-v2/
├── packages/
│   ├── shared/              # Shared HTTP client, auth, config, types
│   ├── iris-dev-mcp/        # Suite 1: Development tools
│   ├── iris-admin-mcp/      # Suite 2: Administration tools
│   ├── iris-interop-mcp/    # Suite 3: Interoperability tools
│   ├── iris-ops-mcp/        # Suite 4: Operations tools
│   └── iris-data-mcp/       # Suite 5: Data & Analytics tools
├── src/                     # IRIS-side custom REST service classes
│   └── ExecuteMCPv2/
│       └── REST/
│           ├── Dispatch.cls
│           ├── Command.cls
│           ├── Security.cls
│           ├── Config.cls
│           ├── Interop.cls
│           ├── Monitor.cls
│           └── Data.cls
└── package.json             # Monorepo root
```

---

*Categorization by Mary, Strategic Business Analyst — organizing the treasure into five distinct vaults for maximum efficiency.*
