# IRIS Execute MCP v2 — Exhaustive Tool Research Report

**Date:** 2026-04-05  
**Research Type:** Technical  
**Goal:** Determine a comprehensive list of MCP tools for v2, combining v1 iris-execute-mcp + mcp-server-iris capabilities, plus new tools replicating SMP and VS Code extension functionality — all accessed via the IRIS web port (HTTP/REST) using the Atelier API and custom web services where necessary.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Decision: Web Port Only](#2-architecture-decision)
3. [Existing Tools Inventory (v1 Baseline)](#3-existing-tools)
4. [Atelier REST API Endpoint Inventory](#4-atelier-api)
5. [Exhaustive MCP v2 Tool Catalog](#5-tool-catalog)
6. [Implementation Strategy Per Tool](#6-implementation-strategy)
7. [Sources & References](#7-sources)

---

## 1. Executive Summary

This research analyzed **7 source codebases** and external documentation to produce an exhaustive inventory of potential MCP v2 tools:

| Source | Tools/Endpoints Found |
|--------|----------------------|
| iris-execute-mcp v1 | 8 tools (SuperServer) |
| mcp-server-iris | 10 tools (SuperServer) |
| Atelier REST API (%Api) | 100+ endpoints across 8 API families |
| VS Code Extensions (3) | 30+ distinct IRIS operations |
| Security/Config/SYS packages | 130+ administration classes |
| Interoperability (Ensemble) | 40+ adapter types, full production lifecycle |
| System Management Portal | 200+ portal pages, all backed by programmatic APIs |

**Key Finding:** The Atelier API (v1-v8) covers ~60% of desired operations natively via the web port. The remaining ~40% (system administration: users, databases, namespaces, SSL, OAuth, etc.) requires a **custom REST web service** deployed on IRIS that wraps the `Security.*`, `Config.*`, `%Installer`, and `Ens.Director` class methods.

**Design Principle:** Atelier API first. Custom web service only when Atelier lacks coverage.

---

## 2. Architecture Decision: Web Port Only

### Current State (v1)
- **iris-execute-mcp**: Python Native API → SuperServer port 1972
- **mcp-server-iris**: Python Native API (`intersystems-irispython`) ��� SuperServer port 1972

### Target State (v2)
- **All communication via HTTP/HTTPS** on the IRIS web port (default 52773)
- **Two integration paths:**
  1. **Atelier REST API** (`/api/atelier/v8/{namespace}/...`) — for development operations
  2. **Custom REST Service** (`/api/executemcp/v1/...`) — for administration operations not covered by Atelier
  3. **Other built-in APIs** (`/api/mgmnt/`, `/api/monitor/`, `/api/deepsee/`, `/api/docdb/`) — for specific domains

### Why Web Port Only
- Single port simplifies firewall/network configuration
- HTTP is universally supported (no native driver dependency)
- Cookie-based auth with session persistence
- Compatible with reverse proxies and load balancers
- No `intersystems-irispython` package dependency

---

## 3. Existing Tools Inventory (v1 Baseline)

### iris-execute-mcp v1 (8 tools)

| # | Tool | Description | v2 Implementation |
|---|------|-------------|-------------------|
| 1 | `execute_command` | Execute ObjectScript commands with I/O capture | Custom REST service |
| 2 | `execute_classmethod` | Call class methods with parameters | Custom REST service |
| 3 | `get_global` | Retrieve global values | Custom REST service |
| 4 | `set_global` | Set global values | Custom REST service |
| 5 | `get_system_info` | IRIS version, namespace, time | Atelier API: `GET /api/atelier/` |
| 6 | `compile_objectscript_class` | Compile class(es) | Atelier API: `POST /action/compile` |
| 7 | `compile_objectscript_package` | Compile package | Atelier API: `POST /action/compile` |
| 8 | `execute_unit_tests` | Run unit tests | Custom REST service |

### mcp-server-iris (10 tools)

| # | Tool | Description | v2 Implementation |
|---|------|-------------|-------------------|
| 1 | `execute_sql` | Execute SQL queries | Atelier API: `POST /action/query` |
| 2 | `interoperability_production_create` | Create production | Custom REST service |
| 3 | `interoperability_production_status` | Get production status | Custom REST service |
| 4 | `interoperability_production_start` | Start production | Custom REST service |
| 5 | `interoperability_production_stop` | Stop production | Custom REST service |
| 6 | `interoperability_production_recover` | Recover production | Custom REST service |
| 7 | `interoperability_production_needsupdate` | Check update needed | Custom REST service |
| 8 | `interoperability_production_update` | Update production | Custom REST service |
| 9 | `interoperability_production_logs` | Get production logs | Atelier API SQL or Custom REST |
| 10 | `interoperability_production_queues` | Get queue info | Custom REST service |

---

## 4. Atelier REST API Endpoint Inventory

### 4.1 Atelier Core (v1-v8) — `/api/atelier/`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Server info (version, namespaces, features) |
| `/` | HEAD | Server ping/availability check |
| `/v8/{ns}` | GET | Namespace information |
| `/v8/{ns}/docnames` | GET | List all document names |
| `/v8/{ns}/docnames/{cat}` | GET | List by category (CLS, RTN, CSP, OTH) |
| `/v8/{ns}/docnames/{cat}/{type}` | GET | List by category and type |
| `/v8/{ns}/doc/{name}` | GET | Get document content |
| `/v8/{ns}/doc/{name}` | PUT | Create/update document |
| `/v8/{ns}/doc/{name}` | DELETE | Delete document |
| `/v8/{ns}/doc/{name}` | HEAD | Check existence / ETag |
| `/v8/{ns}/docs` | POST | Get multiple documents |
| `/v8/{ns}/docs` | DELETE | Delete multiple documents |
| `/v8/{ns}/modified/{type}` | POST | Get documents modified since timestamp |
| `/v8/{ns}/action/compile` | POST | Compile documents |
| `/v8/{ns}/action/index` | POST | Index classes (structure, methods, properties) |
| `/v8/{ns}/action/query` | POST | Execute SQL query |
| `/v8/{ns}/action/search` | GET | Server-side search (v2+) |
| `/v8/{ns}/action/getmacrolist` | POST | List available macros (v2+) |
| `/v8/{ns}/action/getmacrosignature` | POST | Macro signature (v2+) |
| `/v8/{ns}/action/getmacrolocation` | POST | Macro source location (v2+) |
| `/v8/{ns}/action/getmacrodefinition` | POST | Macro definition (v2+) |
| `/v8/{ns}/action/getmacroexpansion` | POST | Macro expansion (v2+) |
| `/v8/{ns}/action/xml/export` | POST | Export to XML (v7+) |
| `/v8/{ns}/action/xml/load` | POST | Load from XML (v7+) |
| `/v8/{ns}/action/xml/list` | POST | List XML contents (v7+) |
| `/v8/{ns}/work` | POST | Queue async operation |
| `/v8/{ns}/work/{id}` | GET | Poll async operation |
| `/v8/{ns}/work/{id}` | DELETE | Cancel async operation |
| `/v8/{ns}/ens/classes/{type}` | GET | Ensemble classes by type |
| `/v8/{ns}/ens/adapter/{name}` | GET | Adapter input/output classes |
| `/v8/{ns}/cvt/doc/xml` | POST | Convert UDL to XML |
| `/v8/{ns}/cvt/xml/doc` | POST | Convert XML to UDL |
| `/v8/{ns}/saschema/{url}` | GET | Structured Analytics schema (v2+) |
| `/%25SYS/cspapps` | GET | List all CSP applications |
| `/%25SYS/cspapps/{ns}` | GET | CSP apps in namespace |
| `/%25SYS/jobs` | GET | Running jobs list |
| `/%25SYS/metadata/{db}` | GET | Database metadata |
| `/%25SYS/debug` | GET | Debugger access |
| `/%25SYS/cspdebugid` | GET | CSP debug ID (v2+) |
| `/%25SYS/terminal` | GET | Terminal access (v7+ WebSocket) |

### 4.2 Management API — `/api/mgmnt/`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/mgmnt/v2/` | GET | List all REST applications |
| `/api/mgmnt/v2/{ns}/` | GET | List REST apps in namespace |
| `/api/mgmnt/v2/{ns}/{app}` | GET | Get OpenAPI 2.0 spec |
| `/api/mgmnt/v2/{ns}/{app}` | POST | Create/update REST app |
| `/api/mgmnt/v2/{ns}/{app}` | DELETE | Delete REST application |

### 4.3 Monitor API — `/api/monitor/`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/monitor/metrics` | GET | Prometheus metrics |
| `/api/monitor/alerts` | GET | System alerts JSON |
| `/api/monitor/interop/current/interfaces` | GET | Active interfaces |
| `/api/monitor/interop/current/volume` | GET | Current message volume |
| `/api/monitor/interop/current/databaseimpact` | GET | Current DB impact |
| `/api/monitor/interop/historical/interfaces` | GET | Historical interfaces |
| `/api/monitor/interop/historical/volume` | GET | Historical volume |

### 4.4 DocDB API — `/api/docdb/`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/docdb/v1/{ns}` | GET | List document databases |
| `/api/docdb/v1/{ns}/db/{db}` | GET/POST/DELETE | Manage document database |
| `/api/docdb/v1/{ns}/doc/{db}/{id}` | GET/PUT/DELETE | CRUD document by ID |
| `/api/docdb/v1/{ns}/find/{db}` | POST | Query documents |
| `/api/docdb/v1/{ns}/prop/{db}/{prop}` | GET/POST/DELETE | Manage properties |

### 4.5 DeepSee API — `/api/deepsee/`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/deepsee/v3/{ns}/*` | Various | Analytics/BI operations |

### 4.6 InteropEditors API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/{ns}/rules` | GET | List rule classes |
| `/{ns}/packages` | GET | List packages |
| `/{ns}/classSummaries` | GET | Class summaries |
| `/{ns}/rules/types` | GET | Available rule types |

### 4.7 IAM License API — `/api/iam/`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/iam/v1/license` | GET | IAM license key |

---

## 5. Exhaustive MCP v2 Tool Catalog

Below is the complete proposed tool list organized by category. Each tool indicates whether it can be implemented via the **Atelier API** or requires a **Custom REST Service**.

### Namespace Scope Legend

Each tool is marked with a **Namespace Scope** indicator:

| Scope | Meaning | MCP Parameter |
|-------|---------|---------------|
| **NS** | **Namespace-specific** — operates on code, data, or resources within a specific namespace. Requires a `namespace` parameter so the user can target any namespace. | `namespace` (string, required, with configurable default) |
| **SYS** | **System-wide** — operates on server-level infrastructure (users, databases, namespaces, SSL, etc.). Always executes in `%SYS` context. No namespace parameter needed. | None (always %SYS) |
| **BOTH** | **Dual scope** — can operate system-wide or within a namespace depending on context. | `namespace` (string, optional) |
| **NONE** | **No namespace context** — server-level queries that don't operate within any namespace. | None |

**Design note:** For NS-scoped tools, the MCP server should accept an optional `namespace` parameter that defaults to a configured value (e.g., from environment variable `IRIS_NAMESPACE`). This mirrors the v1 behavior where each tool accepted an optional namespace override.

### Category 1: CORE DEVELOPMENT TOOLS (18 tools)

#### 1.1 Document Management

| # | Tool Name | Scope | Description | Implementation |
|---|-----------|-------|-------------|----------------|
| 1 | `get_document` | **NS** | Retrieve class, routine, CSP, or other document content | Atelier: `GET /v8/{ns}/doc/{name}` |
| 2 | `put_document` | **NS** | Create or update a document (class, routine, CSP, include file) | Atelier: `PUT /v8/{ns}/doc/{name}` |
| 3 | `delete_document` | **NS** | Delete a single document | Atelier: `DELETE /v8/{ns}/doc/{name}` |
| 4 | `delete_documents` | **NS** | Delete multiple documents in batch | Atelier: `DELETE /v8/{ns}/docs` |
| 5 | `head_document` | **NS** | Check document existence and get ETag/timestamp | Atelier: `HEAD /v8/{ns}/doc/{name}` |
| 6 | `get_documents` | **NS** | Retrieve multiple documents in one call | Atelier: `POST /v8/{ns}/docs` |
| 7 | `list_documents` | **NS** | List all document names (optionally by category/type) | Atelier: `GET /v8/{ns}/docnames/{cat}/{type}` |
| 8 | `get_modified_documents` | **NS** | Get documents modified since a timestamp | Atelier: `POST /v8/{ns}/modified/{type}` |

#### 1.2 Compilation

| # | Tool Name | Scope | Description | Implementation |
|---|-----------|-------|-------------|----------------|
| 9 | `compile_documents` | **NS** | Compile one or more documents with flags | Atelier: `POST /v8/{ns}/action/compile` |
| 10 | `compile_async` | **NS** | Queue async compilation and poll for results | Atelier: `POST /v8/{ns}/work` + `GET /work/{id}` |

#### 1.3 Code Intelligence

| # | Tool Name | Scope | Description | Implementation |
|---|-----------|-------|-------------|----------------|
| 11 | `index_classes` | **NS** | Get class structure (methods, properties, parameters, supers) | Atelier: `POST /v8/{ns}/action/index` |
| 12 | `search_code` | **NS** | Full-text search across documents (regex, wildcard, case-sensitive) | Atelier: `GET /v8/{ns}/action/search` |
| 13 | `get_macro_definition` | **NS** | Get macro definition and expansion | Atelier: `POST /v8/{ns}/action/getmacrodefinition` |
| 14 | `get_macro_list` | **NS** | List available macros for completion | Atelier: `POST /v8/{ns}/action/getmacrolist` |
| 15 | `get_macro_location` | **NS** | Find macro source location | Atelier: `POST /v8/{ns}/action/getmacrolocation` |

#### 1.4 XML Import/Export

| # | Tool Name | Scope | Description | Implementation |
|---|-----------|-------|-------------|----------------|
| 16 | `export_to_xml` | **NS** | Export documents to legacy XML file | Atelier: `POST /v8/{ns}/action/xml/export` |
| 17 | `load_from_xml` | **NS** | Load documents from XML files | Atelier: `POST /v8/{ns}/action/xml/load` |
| 18 | `list_xml_contents` | **NS** | List documents contained in XML files | Atelier: `POST /v8/{ns}/action/xml/list` |

---

### Category 2: SQL & DATA TOOLS (5 tools)

| # | Tool Name | Scope | Description | Implementation |
|---|-----------|-------|-------------|----------------|
| 19 | `execute_sql` | **NS** | Execute SQL query with parameters (max rows, positional params) | Atelier: `POST /v8/{ns}/action/query` |
| 20 | `get_global` | **NS** | Retrieve global value with subscript support | Custom REST |
| 21 | `set_global` | **NS** | Set global value with verification | Custom REST |
| 22 | `kill_global` | **NS** | Kill a global node or subtree | Custom REST |
| 23 | `list_globals` | **NS** | List globals in namespace with optional filter | Custom REST (wraps `$ORDER` / `%SYS.GlobalQuery`) |

---

### Category 3: OBJECTSCRIPT EXECUTION TOOLS (4 tools)

| # | Tool Name | Scope | Description | Implementation |
|---|-----------|-------|-------------|----------------|
| 24 | `execute_command` | **NS** | Execute ObjectScript commands with I/O capture | Custom REST |
| 25 | `execute_classmethod` | **NS** | Call class methods with parameters and output params | Custom REST |
| 26 | `execute_unit_tests` | **NS** | Run unit tests (package, class, or method level) | Custom REST |
| 27 | `execute_routine` | **NS** | Execute a routine entry point | Custom REST |

---

### Category 4: SERVER & NAMESPACE MANAGEMENT (12 tools)

| # | Tool Name | Scope | Description | Implementation |
|---|-----------|-------|-------------|----------------|
| 28 | `get_server_info` | **NONE** | Server version, instance GUID, features, API level | Atelier: `GET /api/atelier/` |
| 29 | `list_namespaces` | **NONE** | List all namespaces with details | Atelier: `GET /api/atelier/` (namespaces in response) |
| 30 | `get_namespace_info` | **NS** | Detailed namespace info (databases, mappings) | Atelier: `GET /v8/{ns}` + Custom REST for mappings |
| 31 | `create_namespace` | **SYS** | Create a new namespace with code/data DB bindings | Custom REST (wraps `Config.Namespaces.Create`) |
| 32 | `delete_namespace` | **SYS** | Delete a namespace | Custom REST (wraps `Config.Namespaces.Delete`) |
| 33 | `create_database` | **SYS** | Create a new database with full options | Custom REST (wraps `Config.Databases.Create` + `SYS.Database.CreateDatabase`) |
| 34 | `delete_database` | **SYS** | Delete a database | Custom REST (wraps `Config.Databases.Delete`) |
| 35 | `list_databases` | **SYS** | List all databases with properties | Custom REST (SQL: `SELECT * FROM Config.Databases`) |
| 36 | `create_mapping` | **SYS** | Create global/routine/package mapping (targets a namespace) | Custom REST (wraps `Config.MapGlobals/MapRoutines/MapPackages`) |
| 37 | `delete_mapping` | **SYS** | Delete a mapping | Custom REST |
| 38 | `list_mappings` | **SYS** | List all mappings for a namespace | Custom REST |
| 39 | `get_database_info` | **SYS** | Get database size, free space, mount status | Custom REST (wraps `SYS.Database` / `%SYS.DatabaseQuery`) |

---

### Category 5: SECURITY & USER MANAGEMENT (18 tools)

| # | Tool Name | Scope | Description | Implementation |
|---|-----------|-------|-------------|----------------|
| 40 | `create_user` | **SYS** | Create a user with roles, password, properties | Custom REST (wraps `Security.Users.Create`) |
| 41 | `modify_user` | **SYS** | Modify user properties (roles, password, namespace, etc.) | Custom REST (wraps `Security.Users.Modify`) |
| 42 | `delete_user` | **SYS** | Delete a user | Custom REST (wraps `Security.Users.Delete`) |
| 43 | `get_user` | **SYS** | Get user properties | Custom REST (wraps `Security.Users.Get`) |
| 44 | `list_users` | **SYS** | List all users with properties | Custom REST (SQL: `SELECT * FROM Security.Users`) |
| 45 | `create_role` | **SYS** | Create a role with resources and granted roles | Custom REST (wraps `Security.Roles.Create`) |
| 46 | `modify_role` | **SYS** | Modify role properties | Custom REST (wraps `Security.Roles.Modify`) |
| 47 | `delete_role` | **SYS** | Delete a role | Custom REST (wraps `Security.Roles.Delete`) |
| 48 | `list_roles` | **SYS** | List all roles | Custom REST |
| 49 | `create_resource` | **SYS** | Create a security resource | Custom REST (wraps `Security.Resources.Create`) |
| 50 | `modify_resource` | **SYS** | Modify resource properties | Custom REST (wraps `Security.Resources.Modify`) |
| 51 | `delete_resource` | **SYS** | Delete a resource | Custom REST (wraps `Security.Resources.Delete`) |
| 52 | `list_resources` | **SYS** | List all resources | Custom REST |
| 53 | `add_user_roles` | **SYS** | Add roles to a user | Custom REST (wraps `Security.Users.AddRoles`) |
| 54 | `remove_user_roles` | **SYS** | Remove roles from a user | Custom REST (wraps `Security.Users.RemoveRoles`) |
| 55 | `check_permission` | **SYS** | Check if user/role has permission on resource | Custom REST (wraps `$SYSTEM.Security.Check`) |
| 56 | `change_password` | **SYS** | Change user password | Custom REST (wraps `$SYSTEM.Security.ChangePassword`) |
| 57 | `validate_password` | **SYS** | Validate password against policy | Custom REST (wraps `$SYSTEM.Security.ValidatePassword`) |

---

### Category 6: WEB APPLICATION MANAGEMENT (6 tools)

| # | Tool Name | Scope | Description | Implementation |
|---|-----------|-------|-------------|----------------|
| 58 | `create_web_application` | **SYS** | Create CSP/REST web application with full options | Custom REST (wraps `Security.Applications.Create`) |
| 59 | `modify_web_application` | **SYS** | Modify web application properties | Custom REST (wraps `Security.Applications.Modify`) |
| 60 | `delete_web_application` | **SYS** | Delete a web application | Custom REST (wraps `Security.Applications.Delete`) |
| 61 | `get_web_application` | **SYS** | Get web application properties | Custom REST (wraps `Security.Applications.Get`) |
| 62 | `list_web_applications` | **BOTH** | List all web applications (all or per-namespace) | Atelier: `GET /%25SYS/cspapps` or `/%25SYS/cspapps/{ns}` |
| 63 | `list_rest_applications` | **BOTH** | List REST-enabled applications (all or per-namespace) | Mgmnt API: `GET /api/mgmnt/v2/` or `/api/mgmnt/v2/{ns}/` |

---

### Category 7: SSL/TLS & CERTIFICATE MANAGEMENT (5 tools)

| # | Tool Name | Scope | Description | Implementation |
|---|-----------|-------|-------------|----------------|
| 64 | `create_ssl_config` | **SYS** | Create SSL/TLS configuration | Custom REST (wraps `Security.SSLConfigs.Create`) |
| 65 | `modify_ssl_config` | **SYS** | Modify SSL configuration | Custom REST (wraps `Security.SSLConfigs.Modify`) |
| 66 | `delete_ssl_config` | **SYS** | Delete SSL configuration | Custom REST (wraps `Security.SSLConfigs.Delete`) |
| 67 | `get_ssl_config` | **SYS** | Get SSL configuration details | Custom REST (wraps `Security.SSLConfigs.Get`) |
| 68 | `list_ssl_configs` | **SYS** | List all SSL/TLS configurations | Custom REST |

---

### Category 8: OAUTH2 MANAGEMENT (5 tools)

| # | Tool Name | Scope | Description | Implementation |
|---|-----------|-------|-------------|----------------|
| 69 | `create_oauth2_server` | **SYS** | Create/configure OAuth2 server definition | Custom REST (wraps OAuth2 server classes) |
| 70 | `create_oauth2_client` | **SYS** | Register OAuth2 client application | Custom REST (wraps `%SYS.OAuth2.Registration`) |
| 71 | `discover_oauth2` | **SYS** | OpenID Connect discovery from issuer URL | Custom REST (wraps `%SYS.OAuth2.Registration.Discover`) |
| 72 | `get_oauth2_client` | **SYS** | Read OAuth2 client metadata | Custom REST |
| 73 | `list_oauth2_configs` | **SYS** | List all OAuth2 configurations | Custom REST |

---

### Category 9: INTEROPERABILITY / PRODUCTION MANAGEMENT (18 tools)

| # | Tool Name | Scope | Description | Implementation |
|---|-----------|-------|-------------|----------------|
| 74 | `production_create` | **NS** | Create new Interoperability production | Custom REST (wraps `Ens.Config.Production`) |
| 75 | `production_delete` | **NS** | Delete a production | Custom REST (wraps `Ens.Director.DeleteProduction`) |
| 76 | `production_start` | **NS** | Start a production | Custom REST (wraps `Ens.Director.StartProduction`) |
| 77 | `production_stop` | **NS** | Stop a production (with timeout/force) | Custom REST (wraps `Ens.Director.StopProduction`) |
| 78 | `production_restart` | **NS** | Restart a production | Custom REST (wraps `Ens.Director.RestartProduction`) |
| 79 | `production_update` | **NS** | Update running production config | Custom REST (wraps `Ens.Director.UpdateProduction`) |
| 80 | `production_recover` | **NS** | Recover production after crash | Custom REST (wraps `Ens.Director.RecoverProduction`) |
| 81 | `production_status` | **NS** | Get production status with optional item details | Custom REST (wraps `Ens.Director.GetProductionStatus`) |
| 82 | `production_needs_update` | **NS** | Check if production needs update | Custom REST (wraps `Ens.Director.ProductionNeedsUpdate`) |
| 83 | `production_get_config` | **NS** | Get full production configuration (items, settings) | Custom REST |
| 84 | `production_item_enable` | **NS** | Enable/disable a config item | Custom REST (wraps `Ens.Director.EnableConfigItem`) |
| 85 | `production_item_settings` | **NS** | Get/set config item settings | Custom REST (wraps `Ens.Director.GetHostSettings/GetAdapterSettings`) |
| 86 | `production_logs` | **NS** | Query production event logs with filters | Custom REST or Atelier SQL |
| 87 | `production_queues` | **NS** | Get queue status for all items | Custom REST |
| 88 | `production_message_trace` | **NS** | Trace message flow by session/header ID | Custom REST (SQL on `Ens.MessageHeader`) |
| 89 | `production_list_adapters` | **NS** | List available adapter types | Atelier: `GET /v8/{ns}/ens/classes/{type}` |
| 90 | `production_auto_start` | **NS** | Configure production auto-start | Custom REST (wraps `Ens.Director.SetAutoStart`) |
| 91 | `production_summary` | **NONE** | Get production summary across all namespaces | Custom REST (wraps `Ens.Director.GetSystemProductionSummary`) |

---

### Category 10: INTEROPERABILITY CONFIGURATION (8 tools)

| # | Tool Name | Scope | Description | Implementation |
|---|-----------|-------|-------------|----------------|
| 92 | `credential_create` | **NS** | Create/update Ensemble credentials | Custom REST (wraps `Ens.Config.Credentials.SetCredential`) |
| 93 | `credential_delete` | **NS** | Delete credentials | Custom REST |
| 94 | `credential_list` | **NS** | List all credentials | Custom REST |
| 95 | `lookup_table_get` | **NS** | Get lookup table entries | Custom REST (wraps `Ens.Util.LookupTable`) |
| 96 | `lookup_table_set` | **NS** | Create/update lookup table entries | Custom REST (wraps `Ens.Util.LookupTable.%UpdateValue`) |
| 97 | `lookup_table_delete` | **NS** | Delete lookup table entry or clear table | Custom REST |
| 98 | `lookup_table_import` | **NS** | Import lookup table from XML | Custom REST |
| 99 | `lookup_table_export` | **NS** | Export lookup table to XML | Custom REST |

---

### Category 11: INTEROPERABILITY RULES & TRANSFORMS (4 tools)

| # | Tool Name | Scope | Description | Implementation |
|---|-----------|-------|-------------|----------------|
| 100 | `list_rules` | **NS** | List business rule classes | InteropEditors API: `GET /{ns}/rules` |
| 101 | `get_rule_definition` | **NS** | Get rule definition/structure | Custom REST |
| 102 | `list_transforms` | **NS** | List data transformation classes | Custom REST (SQL on `%Dictionary.CompiledClass`) |
| 103 | `test_transform` | **NS** | Test a data transformation with sample input | Custom REST |

---

### Category 12: TASK SCHEDULING (6 tools)

| # | Tool Name | Scope | Description | Implementation |
|---|-----------|-------|-------------|----------------|
| 104 | `create_task` | **SYS** | Create a scheduled task | Custom REST (wraps `%SYS.Task`) |
| 105 | `modify_task` | **SYS** | Modify task schedule/properties | Custom REST |
| 106 | `delete_task` | **SYS** | Delete a scheduled task | Custom REST |
| 107 | `list_tasks` | **SYS** | List all scheduled tasks | Custom REST (SQL on `%SYS.Task`) |
| 108 | `run_task` | **SYS** | Execute a task immediately | Custom REST |
| 109 | `get_task_history` | **SYS** | Get task execution history | Custom REST (SQL on `%SYS.Task.History`) |

---

### Category 13: MONITORING & DIAGNOSTICS (12 tools)

| # | Tool Name | Scope | Description | Implementation |
|---|-----------|-------|-------------|----------------|
| 110 | `get_system_metrics` | **NONE** | Prometheus-format system metrics | Monitor API: `GET /api/monitor/metrics` |
| 111 | `get_system_alerts` | **NONE** | System alerts as JSON | Monitor API: `GET /api/monitor/alerts` |
| 112 | `get_interop_metrics` | **NONE** | Interoperability volume/interface metrics | Monitor API: `GET /api/monitor/interop/*` |
| 113 | `list_jobs` | **NONE** | List running IRIS jobs/processes | Atelier: `GET /%25SYS/jobs` |
| 114 | `list_locks` | **NONE** | List system locks | Custom REST (wraps `%SYS.LockQuery`) |
| 115 | `get_journal_info` | **SYS** | Current journal file info | Custom REST (wraps `%SYS.Journal.System`) |
| 116 | `list_journal_files` | **SYS** | List journal files | Custom REST (wraps `%SYS.Journal.File`) |
| 117 | `get_mirror_status` | **SYS** | Mirror configuration and status | Custom REST (wraps `$SYSTEM.Mirror.GetStatus`) |
| 118 | `get_audit_events` | **SYS** | Query audit log events | Custom REST (wraps `%SYS.Audit`) |
| 119 | `get_database_integrity` | **SYS** | Check database integrity status | Custom REST |
| 120 | `get_license_info` | **NONE** | License usage and details | Custom REST (wraps `%SYSTEM.License`) |
| 121 | `get_ecp_status` | **SYS** | ECP client/server connection status | Custom REST |

---

### Category 14: DOCUMENT DATABASE (DocDB) TOOLS (5 tools)

| # | Tool Name | Scope | Description | Implementation |
|---|-----------|-------|-------------|----------------|
| 122 | `docdb_create_database` | **NS** | Create a document database | DocDB API: `POST /api/docdb/v1/{ns}/db/{db}` |
| 123 | `docdb_drop_database` | **NS** | Drop a document database | DocDB API: `DELETE /api/docdb/v1/{ns}/db/{db}` |
| 124 | `docdb_insert_document` | **NS** | Insert a document | DocDB API: `POST /api/docdb/v1/{ns}/doc/{db}/` |
| 125 | `docdb_find_documents` | **NS** | Query documents | DocDB API: `POST /api/docdb/v1/{ns}/find/{db}` |
| 126 | `docdb_manage_property` | **NS** | Create/drop document properties | DocDB API: `POST/DELETE /api/docdb/v1/{ns}/prop/{db}/{prop}` |

---

### Category 15: DEBUGGING & TERMINAL (4 tools)

| # | Tool Name | Scope | Description | Implementation |
|---|-----------|-------|-------------|----------------|
| 127 | `start_debug_session` | **NS** | Start XDebug WebSocket session | Atelier: WebSocket `/%25SYS/debug` |
| 128 | `get_csp_debug_id` | **NONE** | Get CSP debug ID for attaching | Atelier: `GET /%25SYS/cspdebugid` |
| 129 | `terminal_execute` | **NS** | Execute commands via terminal WebSocket (v7+) | Atelier: WebSocket `/%25SYS/terminal` |
| 130 | `format_convert` | **NS** | Convert between UDL and XML formats | Atelier: `POST /v8/{ns}/cvt/xml/doc` |

---

### Category 16: ANALYTICS (DeepSee/BI) (3 tools)

| # | Tool Name | Scope | Description | Implementation |
|---|-----------|-------|-------------|----------------|
| 131 | `execute_mdx_query` | **NS** | Execute MDX query on DeepSee cube | DeepSee API: `/api/deepsee/v3/{ns}/` |
| 132 | `list_cubes` | **NS** | List available DeepSee cubes | DeepSee API |
| 133 | `build_cube` | **NS** | Build/synchronize a DeepSee cube | Custom REST (wraps `%DeepSee.Utils`) |

---

### Category 17: REST API MANAGEMENT (3 tools)

| # | Tool Name | Scope | Description | Implementation |
|---|-----------|-------|-------------|----------------|
| 134 | `create_rest_application` | **NS** | Create REST application from OpenAPI spec | Mgmnt API: `POST /api/mgmnt/v2/{ns}/{app}` |
| 135 | `delete_rest_application` | **NS** | Delete a REST application | Mgmnt API: `DELETE /api/mgmnt/v2/{ns}/{app}` |
| 136 | `get_rest_openapi_spec` | **NS** | Get OpenAPI spec for REST application | Mgmnt API: `GET /api/mgmnt/v2/{ns}/{app}` |

---

### Category 18: SYSTEM CONFIGURATION (6 tools)

| # | Tool Name | Scope | Description | Implementation |
|---|-----------|-------|-------------|----------------|
| 137 | `get_system_config` | **SYS** | Get current system configuration parameters | Custom REST |
| 138 | `modify_system_config` | **SYS** | Modify system configuration (memory, journals, etc.) | Custom REST (wraps `%SYSTEM.Config.Modify*` and `Config.*`) |
| 139 | `get_startup_config` | **SYS** | Get startup configuration | Custom REST (wraps `Config.Startup`) |
| 140 | `modify_startup_config` | **SYS** | Modify startup settings | Custom REST |
| 141 | `get_nls_config` | **SYS** | Get NLS/locale configuration | Custom REST (wraps `%SYS.NLS`) |
| 142 | `export_config` | **SYS** | Export system configuration (CPF) | Custom REST |

---

## COMPLETE TOOL COUNT SUMMARY

| Category | Tools | Via Atelier/Built-in API | Via Custom REST | NS | SYS | BOTH | NONE |
|----------|-------|--------------------------|-----------------|-----|-----|------|------|
| 1. Core Development | 18 | **18** | 0 | 18 | 0 | 0 | 0 |
| 2. SQL & Data | 5 | 1 | 4 | 5 | 0 | 0 | 0 |
| 3. ObjectScript Execution | 4 | 0 | **4** | 4 | 0 | 0 | 0 |
| 4. Server & Namespace Mgmt | 12 | 2 | **10** | 1 | 9 | 0 | 2 |
| 5. Security & Users | 18 | 0 | **18** | 0 | 18 | 0 | 0 |
| 6. Web Applications | 6 | 2 | **4** | 0 | 4 | 2 | 0 |
| 7. SSL/TLS Certificates | 5 | 0 | **5** | 0 | 5 | 0 | 0 |
| 8. OAuth2 | 5 | 0 | **5** | 0 | 5 | 0 | 0 |
| 9. Interop Productions | 18 | 1 | **17** | 17 | 0 | 0 | 1 |
| 10. Interop Configuration | 8 | 0 | **8** | 8 | 0 | 0 | 0 |
| 11. Rules & Transforms | 4 | 1 | 3 | 4 | 0 | 0 | 0 |
| 12. Task Scheduling | 6 | 0 | **6** | 0 | 6 | 0 | 0 |
| 13. Monitoring & Diagnostics | 12 | 4 | **8** | 0 | 5 | 0 | 7 |
| 14. DocDB | 5 | **5** | 0 | 5 | 0 | 0 | 0 |
| 15. Debugging & Terminal | 4 | **4** | 0 | 2 | 0 | 0 | 2 |
| 16. Analytics (DeepSee) | 3 | 2 | 1 | 3 | 0 | 0 | 0 |
| 17. REST API Management | 3 | **3** | 0 | 3 | 0 | 0 | 0 |
| 18. System Configuration | 6 | 0 | **6** | 0 | 6 | 0 | 0 |
| **TOTAL** | **142** | **43 (30%)** | **99 (70%)** | **70** | **52** | **2** | **12** |

### Namespace Scope Summary

- **70 tools (49%)** are **namespace-specific (NS)** — require a `namespace` parameter with configurable default
- **52 tools (37%)** are **system-wide (SYS)** — always execute in %SYS, no namespace parameter needed
- **2 tools (1%)** are **dual-scope (BOTH)** — accept optional namespace to filter results
- **12 tools (8%)** are **no-scope (NONE)** — server-level queries with no namespace context
- **6 tools (4%)** in SYS category (mappings #36-38) accept a *target namespace name* as a data parameter, but still execute in %SYS

---

## 6. Implementation Strategy Per Tool

### 6.1 Tools Using Atelier API (43 tools) — No Custom Code Needed

These tools make standard HTTP requests to existing IRIS REST endpoints:

```
MCP Server (TypeScript/Python)
    → HTTP Request to /api/atelier/v8/...
    → Parse JSON response
    → Return to MCP client
```

**Authentication:** Basic Auth or cookie-based session  
**Content-Type:** `application/json`  
**Error Handling:** HTTP status codes + `status.errors[]` array in response

### 6.2 Tools Using Custom REST Service (99 tools)

These require a custom ObjectScript REST dispatch class deployed on IRIS:

```
MCP Server (TypeScript/Python)
    → HTTP Request to /api/executemcp/v1/...
    → Custom REST class (ExecuteMCPv2.REST.Dispatch)
        → Calls Security.*, Config.*, Ens.Director, etc.
        → Returns JSON response
    → Parse JSON response
    → Return to MCP client
```

**Custom REST Service Architecture:**

```
ExecuteMCPv2.REST.Dispatch extends %CSP.REST
├── ExecuteMCPv2.REST.Command          (execute_command, execute_classmethod, globals)
├��─ ExecuteMCPv2.REST.UnitTest         (execute_unit_tests)
├── ExecuteMCPv2.REST.Security         (users, roles, resources, permissions)
├── ExecuteMCPv2.REST.Config           (namespaces, databases, mappings)
├── ExecuteMCPv2.REST.WebApp           (web applications)
├── ExecuteMCPv2.REST.SSL              (SSL/TLS configurations)
├── ExecuteMCPv2.REST.OAuth2           (OAuth2 client/server management)
├── ExecuteMCPv2.REST.Interop          (productions, items, credentials, lookups)
├── ExecuteMCPv2.REST.Task             (task scheduling)
├── ExecuteMCPv2.REST.Monitor          (jobs, locks, journals, mirrors, audit)
├── ExecuteMCPv2.REST.SystemConfig     (system configuration, startup, NLS)
└── ExecuteMCPv2.REST.Analytics        (DeepSee cube management)
```

**Web Application Setup:**
- URL: `/api/executemcp`
- Namespace: `%SYS` (required for admin operations; namespace switching for user operations)
- Resource: `%Admin_Manage:USE` (or similar)
- Authentication: Password + OAuth2 (recommended)
- Dispatch Class: `ExecuteMCPv2.REST.Dispatch`

### 6.3 Implementation Priority (Recommended Phases)

**Phase 1 — Core (MVP):** 27 tools
- All 18 Core Development tools (Atelier API — easiest wins)
- SQL & Data (5 tools)
- ObjectScript Execution (4 tools)

**Phase 2 — Server Administration:** 30 tools
- Server & Namespace Management (12)
- Security & Users (18)

**Phase 3 — Web & Security Infrastructure:** 16 tools
- Web Application Management (6)
- SSL/TLS (5)
- OAuth2 (5)

**Phase 4 — Interoperability:** 30 tools
- Production Management (18)
- Interop Configuration (8)
- Rules & Transforms (4)

**Phase 5 — Operations & Monitoring:** 27 tools
- Task Scheduling (6)
- Monitoring & Diagnostics (12)
- System Configuration (6)
- REST API Management (3)

**Phase 6 — Advanced:** 12 tools
- DocDB (5)
- Debugging & Terminal (4)
- Analytics (3)

---

## 7. Sources & References

### Source Code Analyzed
1. `sources/iris-execute-mcp/` — v1 MCP server (8 tools, Python + ObjectScript)
2. `sources/mcp-server-iris/` — mcp-server-iris (10 tools, Python)
3. `irislib/%Api/` — Atelier REST API (34 classes, 100+ endpoints)
4. `sources/vscode-objectscript/` — VS Code ObjectScript extension
5. `sources/language-server/` — IRIS Language Server
6. `sources/intersystems-servermanager/` — Server Manager extension
7. `irislib/Security/` — Security management classes
8. `irislib/Config/` — Configuration management classes
9. `irislib/%SYS/` — System management classes
10. `irislib/%Installer/` — Installation framework (43 classes)
11. `irislib/Ens/` — Ensemble/Interoperability classes
12. `irislib/EnsLib/` — Adapter library (40+ adapter types)
13. `irislib/%CSP/UI/Portal/` — System Management Portal (200+ pages)

### External Documentation
- InterSystems IRIS Atelier REST API Reference: https://docs.intersystems.com/irislatest/csp/docbook/DocBook.UI.Page.cls?KEY=GSCF_ref
- Atelier API Class Documentation: https://docs.intersystems.com/irislatest/csp/documatic/%25CSP.Documatic.cls?LIBRARY=%25SYS&CLASSNAME=%25Api.Atelier
- REST API Management: https://docs.intersystems.com/irislatest/csp/docbook/DocBook.UI.Page.cls?KEY=GREST_reference
- Security.Users Programmatic API: https://community.intersystems.com/post/security-package-editing-users-programmatically
- Config.Databases API: https://docs.intersystems.com/irislatest/csp/documatic/%25CSP.Documatic.cls?LIBRARY=%25SYS&CLASSNAME=Config.Databases

---

*Research conducted by Mary, Strategic Business Analyst — assembling the complete treasure map for IRIS MCP v2.*
