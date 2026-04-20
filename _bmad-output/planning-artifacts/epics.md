---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
  - step-03-create-stories
  - step-04-final-validation
inputDocuments:
  - prd.md
  - architecture.md
---

# iris-execute-mcp-v2 - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for iris-execute-mcp-v2, decomposing the requirements from the PRD and Architecture into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: MCP client can connect to any IRIS MCP server using IRIS web port URL, username, and password
FR2: Server can auto-negotiate the Atelier API version supported by the connected IRIS instance
FR3: Server can maintain a persistent HTTP session with cookie-based authentication to IRIS
FR4: Server can report its available tools via `tools/list` with cursor-based pagination
FR5: Server can declare tool annotations (readOnlyHint, destructiveHint, idempotentHint, openWorldHint) for each tool
FR6: Server can emit `notifications/tools/list_changed` when its tool set changes
FR7: Server can operate via stdio or Streamable HTTP transport
FR7b: Developer can specify an optional `namespace` parameter on any namespace-scoped tool to override the configured default
FR7c: Developer can execute namespace-scoped tools in any accessible namespace without affecting the namespace context of other concurrent tool calls
FR8: Server can detect whether the IRIS-side custom REST service is installed
FR9: Server can deploy ObjectScript classes to IRIS via the Atelier API when the REST service is missing
FR10: Server can compile deployed ObjectScript classes via the Atelier API
FR11: Server can execute the configuration class method to register the `/api/executemcp` web application
FR12: Server can detect insufficient privileges during bootstrap and report which steps succeeded and which failed
FR13: Server can provide explicit manual instructions (Terminal commands, SMP navigation) for completing failed bootstrap steps
FR14: Server can suggest IPM installation as an alternative when bootstrap partially fails
FR15: Server can skip completed bootstrap steps on subsequent connections
FR16: Developer can retrieve the content of any ObjectScript class, routine, CSP page, or include file
FR17: Developer can create or update documents by pushing content to IRIS
FR18: Developer can delete one or more documents
FR19: Developer can list documents in a namespace filtered by category (CLS, RTN, CSP, OTH) and type
FR20: Developer can check document existence and retrieve modification timestamps
FR21: Developer can retrieve documents modified since a given timestamp
FR22: Developer can compile one or more documents with configurable compilation flags
FR23: Developer can queue asynchronous compilation and poll for completion status
FR24: Developer can receive detailed compilation errors with source locations
FR25: Developer can get class structure including methods, properties, parameters, and superclasses
FR26: Developer can perform full-text search across documents with regex, wildcard, and case-sensitivity options
FR27: Developer can retrieve macro definitions, source locations, and expansion
FR28: Developer can convert documents between UDL and XML formats
FR29: Developer can export documents to legacy XML format
FR30: Developer can import documents from XML files
FR31: Developer can list documents contained in XML files before importing
FR32: Developer can execute SQL queries with parameterized inputs and configurable row limits
FR33: Developer can retrieve global values with complex subscript support
FR34: Developer can set global values with automatic verification
FR35: Developer can kill global nodes or subtrees
FR36: Developer can list globals in a namespace with optional filtering
FR37: Developer can execute ObjectScript commands with captured I/O output
FR38: Developer can call class methods with positional parameters and output parameter support
FR39: Developer can run unit tests at package, class, or individual method level with structured results
FR40: Administrator can create, modify, or delete namespaces with code and data database bindings
FR41: Administrator can list all namespaces with their database associations
FR42: Administrator can create, modify, or delete databases with full configuration options
FR43: Administrator can list databases with size, free space, and mount status
FR44: Administrator can create or delete global, routine, and package mappings between namespaces
FR45: Administrator can list all mappings for a given namespace
FR46: Administrator can create, modify, or delete user accounts with roles, password, and properties
FR47: Administrator can retrieve user properties or list all users
FR48: Administrator can add or remove roles from users
FR49: Administrator can change or validate user passwords against policy
FR50: Administrator can create, modify, or delete security roles with resource grants
FR51: Administrator can list all roles
FR52: Administrator can create, modify, or delete security resources
FR53: Administrator can list all resources
FR54: Administrator can check whether a user or role has specific permissions on a resource
FR55: Administrator can create, modify, or delete CSP/REST web applications with full configuration
FR56: Administrator can retrieve web application properties
FR57: Administrator can list all web applications, optionally filtered by namespace
FR58: Administrator can create, modify, or delete SSL/TLS configurations
FR59: Administrator can list all SSL/TLS configurations with their details
FR60: Administrator can create OAuth2 server definitions and register client applications
FR61: Administrator can perform OpenID Connect discovery from an issuer URL
FR62: Administrator can list OAuth2 configurations and retrieve client details
FR63: Integration engineer can create or delete Interoperability productions
FR64: Integration engineer can start, stop, restart, update, or recover productions
FR65: Integration engineer can get production status with optional item-level detail
FR66: Integration engineer can get production summary across all namespaces
FR67: Integration engineer can enable or disable individual config items
FR68: Integration engineer can get or set config item host and adapter settings
FR69: Integration engineer can configure production auto-start
FR70: Integration engineer can query production event logs filtered by type, item, and count
FR71: Integration engineer can view queue status for all production items
FR72: Integration engineer can trace message flow by session or header ID
FR73: Integration engineer can list available adapter types by category
FR74: Integration engineer can create, update, or delete Ensemble credentials
FR75: Integration engineer can list stored credentials
FR76: Integration engineer can get, set, or delete lookup table entries
FR77: Integration engineer can import or export lookup tables in XML format
FR78: Integration engineer can list business rule classes and get rule definitions
FR79: Integration engineer can list data transformation classes and test transforms with sample input
FR80: Integration engineer can create REST applications from OpenAPI specs, delete them, or retrieve their specs
FR81: Operations engineer can retrieve Prometheus-format system metrics
FR82: Operations engineer can retrieve system alerts
FR83: Operations engineer can retrieve interoperability volume and interface metrics
FR84: Operations engineer can list running IRIS jobs and processes
FR85: Operations engineer can list system locks
FR86: Operations engineer can view journal file information and list journal files
FR87: Operations engineer can check mirror configuration, membership, and status
FR88: Operations engineer can query audit log events
FR89: Operations engineer can check database integrity status
FR90: Operations engineer can view license usage and details
FR91: Operations engineer can check ECP client/server connection status
FR92: Operations engineer can create, modify, or delete scheduled tasks
FR93: Operations engineer can list all scheduled tasks with their schedules
FR94: Operations engineer can execute a task immediately
FR95: Operations engineer can view task execution history
FR96: Operations engineer can retrieve or modify system configuration parameters
FR97: Operations engineer can retrieve or modify startup configuration
FR98: Operations engineer can view NLS/locale configuration
FR99: Operations engineer can export system configuration
FR100: Data engineer can create or drop document databases
FR101: Data engineer can insert, retrieve, update, or delete documents by ID
FR102: Data engineer can query documents with filter criteria
FR103: Data engineer can create or drop document properties and indexes
FR104: Analyst can execute MDX queries on DeepSee cubes
FR105: Analyst can list available cubes or trigger cube build/synchronization
FR106: (Deferred post-MVP) Developer can create and manage XDebug sessions
FR107: (Deferred post-MVP) Developer can open interactive terminal sessions via WebSocket

### NonFunctional Requirements

NFR1: Read-only tools (*.list, *.get, *.status, *.info) must respond within 2 seconds under normal IRIS load
NFR2: Compilation tools must return within 30 seconds for single classes, 120 seconds for full packages
NFR3: SQL execution must return first results within 5 seconds (with configurable row limits)
NFR4: Auto-bootstrap (full flow: detect, deploy, compile, configure) must complete within 60 seconds
NFR5: Tool listing (tools/list) must respond within 500ms regardless of tool count
NFR6: Credentials (IRIS username/password) must never be logged, included in error messages, or exposed in tool responses
NFR7: All HTTP communication to IRIS must support HTTPS (TLS) when configured
NFR8: The MCP server must not escalate privileges beyond what the connected IRIS user has
NFR9: Tool annotations must accurately reflect destructive potential (destructiveHint: true for all modify/delete tools)
NFR10: The custom REST service must validate all inputs at the REST boundary before passing to IRIS system classes
NFR11: The custom REST service must not expose internal IRIS error details (stack traces, global references) to external callers
NFR12: Full compliance with MCP specification v2025-11-25 (pagination, tool annotations, listChanged, structured output, outputSchema)
NFR13: Atelier API compatibility with auto-negotiated versions (v1 through v8)
NFR14: HTTP client must handle IRIS session cookies, CSRF tokens, and connection timeouts (configurable via IRIS_TIMEOUT env var, default 60s)
NFR15: Tool responses must follow MCP content format (TextContent with optional structuredContent)
NFR16: Error responses must use MCP two-tier model: protocol errors (JSON-RPC) for structural issues, tool execution errors (isError: true) for IRIS-side failures
NFR17: Connection loss to IRIS must be detected within 2 seconds and reported with actionable error response
NFR18: HTTP session expiration must be handled with automatic re-authentication
NFR19: Auto-bootstrap must be idempotent — safe to run multiple times without side effects
NFR20: Failed tool calls must not leave IRIS in an inconsistent state
NFR21: The custom REST service must not leave the IRIS connection in a different namespace after tool execution, even on error

### Additional Requirements

- Starter Template: Turborepo + pnpm workspaces (npx create-turbo@latest) — impacts Epic 1, Story 1
- Synchronized semver versioning via Changesets across all 7 npm packages
- Atelier API version negotiation algorithm to be resolved during Epic 1 (reference: vscode-objectscript)
- Streamable HTTP transport server configuration to be resolved during Epic 1
- Dual-boundary input validation: TypeScript (Zod) + ObjectScript REST handlers
- Structured logging to stderr with [ERROR], [WARN], [INFO], [DEBUG] prefixes — stdout reserved for MCP protocol
- ObjectScript REST service extends %Atelier.REST for unified three-part response envelope ({status, console, result})
- Read-only boundary enforcement: sources/ and irislib/ directories are never modified
- Build and test orchestration via Turborepo tasks against local IRIS development instance
- CI/CD pipeline (GitHub Actions) and npm publish automation deferred to post-MVP
- IPM module.xml for alternative IRIS-side installation

### UX Design Requirements

N/A — No UI component. This is a suite of MCP server packages (CLI/protocol layer).

### FR Coverage Map

FR1: Epic 1 — MCP client connection via web port
FR2: Epic 1 — Atelier API version auto-negotiation
FR3: Epic 1 — Persistent HTTP session with cookies
FR4: Epic 1 — tools/list with cursor-based pagination
FR5: Epic 1 — Tool annotations declaration
FR6: Epic 1 — tools/list_changed notifications
FR7: Epic 1 — stdio and Streamable HTTP transport
FR7b: Epic 1 — Optional namespace parameter on NS-scoped tools
FR7c: Epic 1 — Namespace isolation between concurrent calls
FR8: Epic 3 — Detect missing custom REST service
FR9: Epic 3 — Deploy ObjectScript classes via Atelier API
FR10: Epic 3 — Compile deployed classes via Atelier API
FR11: Epic 3 — Execute config class method for web app registration
FR12: Epic 3 — Detect insufficient privileges during bootstrap
FR13: Epic 3 — Provide manual fallback instructions
FR14: Epic 3 — Suggest IPM installation alternative
FR15: Epic 3 — Skip completed bootstrap steps on reconnect
FR16: Epic 2 — Retrieve document content
FR17: Epic 2 — Create or update documents
FR18: Epic 2 — Delete documents
FR19: Epic 2 — List documents filtered by category/type
FR20: Epic 2 — Check document existence and timestamps (via iris_doc_get metadata mode)
FR21: Epic 2 — Retrieve documents modified since timestamp (via iris_doc_list modifiedSince filter)
FR22: Epic 2 — Compile documents with configurable flags
FR23: Epic 2 — Queue async compilation and poll status
FR24: Epic 2 — Detailed compilation errors with source locations
FR25: Epic 2 — Class structure (methods, properties, parameters)
FR26: Epic 2 — Full-text search across documents
FR27: Epic 2 — Macro definitions and expansion
FR28: Epic 2 — Convert documents between UDL and XML
FR29: Epic 2 — Export documents to XML format (via iris_doc_xml_export action "export")
FR30: Epic 2 — Import documents from XML (via iris_doc_xml_export action "import")
FR31: Epic 2 — List XML file contents before import (via iris_doc_xml_export action "list")
FR32: Epic 2 — Execute SQL queries with parameters
FR33: Epic 3 — Retrieve global values
FR34: Epic 3 — Set global values with verification
FR35: Epic 3 — Kill global nodes or subtrees
FR36: Epic 3 — List globals with filtering
FR37: Epic 3 — Execute ObjectScript commands
FR38: Epic 3 — Call class methods with parameters
FR39: Epic 3 — Run unit tests with structured results
FR40: Epic 4 — Namespace create/modify/delete
FR41: Epic 4 — List namespaces with database associations
FR42: Epic 4 — Database create/modify/delete
FR43: Epic 4 — List databases with size/status
FR44: Epic 4 — Global/routine/package mappings
FR45: Epic 4 — List mappings for namespace
FR46: Epic 4 — User account create/modify/delete
FR47: Epic 4 — Retrieve user properties or list users
FR48: Epic 4 — Add/remove roles from users
FR49: Epic 4 — Change/validate passwords
FR50: Epic 4 — Security role create/modify/delete
FR51: Epic 4 — List all roles
FR52: Epic 4 — Security resource create/modify/delete
FR53: Epic 4 — List all resources
FR54: Epic 4 — Check permissions on resources
FR55: Epic 4 — Web application create/modify/delete
FR56: Epic 4 — Retrieve web app properties
FR57: Epic 4 — List web apps with namespace filter
FR58: Epic 4 — SSL/TLS config create/modify/delete
FR59: Epic 4 — List SSL/TLS configurations
FR60: Epic 4 — OAuth2 server/client setup
FR61: Epic 4 — OpenID Connect discovery
FR62: Epic 4 — List OAuth2 configurations
FR63: Epic 5 — Create/delete productions
FR64: Epic 5 — Start/stop/restart/update/recover productions
FR65: Epic 5 — Production status with item detail
FR66: Epic 5 — Production summary across namespaces
FR67: Epic 5 — Enable/disable config items
FR68: Epic 5 — Get/set config item settings
FR69: Epic 5 — Configure production auto-start
FR70: Epic 5 — Query production event logs
FR71: Epic 5 — View queue status
FR72: Epic 5 — Trace message flow
FR73: Epic 5 — List adapter types
FR74: Epic 5 — Credential create/update/delete
FR75: Epic 5 — List credentials
FR76: Epic 5 — Lookup table get/set/delete
FR77: Epic 5 — Import/export lookup tables
FR78: Epic 5 — List business rules and definitions
FR79: Epic 5 — List transforms and test with sample input
FR80: Epic 5 — REST API from OpenAPI specs
FR81: Epic 6 — Prometheus-format system metrics
FR82: Epic 6 — System alerts
FR83: Epic 6 — Interoperability metrics
FR84: Epic 6 — List running jobs/processes
FR85: Epic 6 — List system locks
FR86: Epic 6 — Journal file info
FR87: Epic 6 — Mirror status
FR88: Epic 6 — Audit log events
FR89: Epic 6 — Database integrity status
FR90: Epic 6 — License usage/details
FR91: Epic 6 — ECP connection status
FR92: Epic 6 — Task create/modify/delete
FR93: Epic 6 — List scheduled tasks
FR94: Epic 6 — Execute task immediately
FR95: Epic 6 — Task execution history
FR96: Epic 6 — System configuration parameters
FR97: Epic 6 — Startup configuration
FR98: Epic 6 — NLS/locale configuration
FR99: Epic 6 — Export system configuration
FR100: Epic 7 — DocDB create/drop
FR101: Epic 7 — Document insert/retrieve/update/delete
FR102: Epic 7 — Query documents with filters
FR103: Epic 7 — Document properties and indexes
FR104: Epic 7 — MDX queries on DeepSee cubes
FR105: Epic 7 — Cube list/build/sync
FR106: Deferred — XDebug sessions (post-MVP)
FR107: Deferred — Terminal WebSocket (post-MVP)

## Epic List

### Epic 1: Shared Infrastructure & Developer Connection
A developer can install an MCP server package, connect to their IRIS instance, and establish a persistent authenticated session. The shared foundation (HTTP client, auth, config, MCP server base, Atelier version negotiation) is complete and reusable by all subsequent server packages.
**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR7b, FR7c
**NFRs addressed:** NFR5, NFR6, NFR7, NFR8, NFR12, NFR13, NFR14, NFR15, NFR16, NFR17, NFR18

### Epic 2: IRIS Development Tools — Atelier API (iris-dev-mcp)
A developer can manage ObjectScript documents (read, write, delete, list), compile code with error feedback, search across codebases, work with macros, execute SQL queries, and get server/namespace info — all through their AI assistant. Covers the Atelier API-based tools.
**FRs covered:** FR16, FR17, FR18, FR19, FR20, FR21, FR22, FR23, FR24, FR25, FR26, FR27, FR28, FR29, FR30, FR31, FR32
**NFRs addressed:** NFR1, NFR2, NFR3

### Epic 3: Custom REST Service, Auto-Bootstrap & Execution Tools
The IRIS-side REST service is deployed (automatically or manually), enabling global operations, ObjectScript command execution, class method calls, and unit test execution. Developers get the remaining iris-dev-mcp tools that require the custom REST backend. The auto-bootstrap flow handles installation transparently.
**FRs covered:** FR8, FR9, FR10, FR11, FR12, FR13, FR14, FR15, FR33, FR34, FR35, FR36, FR37, FR38, FR39
**NFRs addressed:** NFR4, NFR10, NFR11, NFR19, NFR20, NFR21

### Epic 4: IRIS Administration (iris-admin-mcp)
An administrator can provision complete IRIS environments — namespaces, databases, users, roles, resources, web applications, SSL configs, and OAuth2 — entirely through AI-directed MCP tool calls, without opening the Management Portal.
**FRs covered:** FR40, FR41, FR42, FR43, FR44, FR45, FR46, FR47, FR48, FR49, FR50, FR51, FR52, FR53, FR54, FR55, FR56, FR57, FR58, FR59, FR60, FR61, FR62
**NFRs addressed:** NFR9, NFR10, NFR11

### Epic 5: Interoperability Management (iris-interop-mcp)
An integration engineer can create, control, monitor, and debug Interoperability productions — including credentials, lookup tables, rules, transforms, and REST API management — through MCP tools.
**FRs covered:** FR63, FR64, FR65, FR66, FR67, FR68, FR69, FR70, FR71, FR72, FR73, FR74, FR75, FR76, FR77, FR78, FR79, FR80
**NFRs addressed:** NFR1, NFR9, NFR10, NFR11

### Epic 6: Operations & Monitoring (iris-ops-mcp)
An operations engineer can monitor system health, manage scheduled tasks, inspect jobs/locks/journals/mirrors, query audit logs, check license and ECP status, and manage system configuration — all through AI-driven MCP tools.
**FRs covered:** FR81, FR82, FR83, FR84, FR85, FR86, FR87, FR88, FR89, FR90, FR91, FR92, FR93, FR94, FR95, FR96, FR97, FR98, FR99
**NFRs addressed:** NFR1, NFR9, NFR10, NFR11

### Epic 7: Data & Analytics (iris-data-mcp)
A data engineer or analyst can create and query document databases, manage documents and indexes, execute MDX queries on DeepSee cubes, and manage REST APIs — through MCP tools.
**FRs covered:** FR100, FR101, FR102, FR103, FR104, FR105
**Deferred:** FR106, FR107 (XDebug/terminal — post-MVP)
**NFRs addressed:** NFR1, NFR9, NFR10, NFR11

### Epic 8: Documentation & Release Preparation
Users can find comprehensive documentation — suite-level README, per-package tool references, v1-to-v2 migration guide, and MCP client config examples — enabling self-service installation and adoption.
**FRs covered:** Documentation requirements (non-numbered)
**NFRs addressed:** N/A

### Epic 9: Tool Name Flattening for Anthropic API / Claude Desktop Compatibility
A beta-testing defect in Claude Desktop revealed that dotted tool names (`iris.doc.get`) are rejected by the Anthropic Messages API regex `^[a-zA-Z0-9_-]+$`. All 85 tool names are flattened to `iris_<domain>_<verb>`, package READMEs are updated, a regression-guard test is added, and a CHANGELOG entry documents the pre-release breaking change. Unblocks first npm publish. Living planning artifacts (architecture.md, prd.md, epics.md) were updated by the analyst as part of the Sprint Change Proposal on 2026-04-09 and are out of scope for the dev stories.
**FRs covered:** None (cross-cutting cleanup for release compatibility)
**NFRs addressed:** NFR1 (MCP client compatibility)

## Epic 1: Shared Infrastructure & Developer Connection

A developer can install an MCP server package, connect to their IRIS instance, and establish a persistent authenticated session. The shared foundation is complete and reusable by all subsequent server packages.

### Story 1.1: Monorepo Scaffold & Package Structure

As a developer,
I want a properly structured TypeScript monorepo with all package directories and build tooling configured,
So that I have a solid foundation to build all five MCP server packages on.

**Acceptance Criteria:**

**Given** a fresh clone of the repository
**When** I run `npx create-turbo@latest` and restructure into the defined package layout
**Then** the monorepo contains packages/ directory with shared/, iris-dev-mcp/, iris-admin-mcp/, iris-interop-mcp/, iris-ops-mcp/, iris-data-mcp/, and iris-mcp-all/ subdirectories
**And** a root turbo.json defines build, test, lint, and type-check task pipelines with shared as a dependency of all server packages
**And** pnpm-workspace.yaml includes `packages/*`
**And** tsconfig.base.json targets ES2022 with module Node16, moduleResolution Node16, and strict mode enabled
**And** each package has its own tsconfig.json extending the base
**And** ESLint is configured with TypeScript rules at the root
**And** Prettier is configured at the root
**And** Vitest is configured as the test framework
**And** Changesets is configured for synchronized versioning across all packages
**And** .env.example documents IRIS_HOST, IRIS_PORT, IRIS_USERNAME, IRIS_PASSWORD, IRIS_NAMESPACE, IRIS_HTTPS
**And** .gitignore covers node_modules, dist, .env, and build artifacts
**And** `pnpm install` succeeds and `turbo build` runs without errors (even if packages are empty skeletons)

### Story 1.2: HTTP Client, Configuration & Authentication

As a developer,
I want a shared HTTP client that connects to IRIS via the web port with automatic authentication and session management,
So that all MCP server packages can communicate with IRIS reliably without duplicating connection logic.

**Acceptance Criteria:**

**Given** valid IRIS connection parameters in environment variables (IRIS_HOST, IRIS_PORT, IRIS_USERNAME, IRIS_PASSWORD)
**When** IrisHttpClient is instantiated with IrisConnectionConfig loaded from environment variables
**Then** the client sends an initial request with Basic Auth headers to establish a session
**And** the client extracts and stores the IRIS session cookie from the response
**And** subsequent requests include the session cookie instead of re-sending credentials
**And** the client extracts CSRF tokens from response headers and includes them in all POST/PUT/DELETE requests

**Given** a session cookie that has expired (IRIS returns 401)
**When** the client receives a 401 response
**Then** the client automatically retries the request with Basic Auth to re-establish the session
**And** the new session cookie is stored for subsequent requests

**Given** IRIS_HTTPS is set to true
**When** the client makes requests
**Then** all requests use HTTPS protocol

**Given** a request that exceeds the configured timeout (default 30s)
**When** the timeout is reached
**Then** the client throws an IrisConnectionError with a descriptive message

**Given** any error during IRIS communication
**When** the error is logged
**Then** credentials, session cookies, and full request bodies are never included in log output (NFR6)
**And** logging uses console.error() with structured prefixes ([ERROR], [WARN], [INFO], [DEBUG])

**Given** a connection failure (network error, DNS failure)
**When** the client detects the failure
**Then** the client throws an IrisConnectionError with error code, human-readable message, and recovery suggestion

**And** the error class hierarchy is implemented: IrisConnectionError (connection issues), IrisApiError (IRIS 4xx/5xx), McpProtocolError (unknown tool, malformed args)

### Story 1.3: Connection Health & Atelier Version Negotiation

As a developer,
I want the MCP server to verify IRIS connectivity and auto-detect the best Atelier API version at startup,
So that I get immediate feedback on connection problems and optimal API compatibility.

**Acceptance Criteria:**

**Given** a valid IRIS connection
**When** the server starts up
**Then** a health check is performed via `HEAD /api/atelier/` to confirm IRIS is reachable
**And** the server calls `GET /api/atelier/` to retrieve version information
**And** the highest supported Atelier API version (up to v8) is detected and stored for use in all subsequent Atelier API calls
**And** the recommended minimum version is v7

**Given** the IRIS instance supports only an older Atelier API version (e.g., v4)
**When** a tool requires features from a newer version
**Then** the tool returns a clear error message specifying the minimum version needed

**Given** an established connection that is lost
**When** the connection is interrupted
**Then** the loss is detected within 2 seconds (NFR17)
**And** an IrisConnectionError is raised with an actionable error response containing error code, message, and recovery suggestion

**Given** a server startup against an unreachable IRIS instance
**When** the health check fails
**Then** a clear error message is displayed indicating the connection cannot be established
**And** the error includes the configured host, port, and a suggestion to verify the web port is accessible

### Story 1.4: MCP Server Base & Tool Registration Framework

As a developer,
I want a reusable MCP server base class that handles tool registration, validation, pagination, and transport,
So that each server package can focus on tool-specific logic without reimplementing MCP protocol concerns.

**Acceptance Criteria:**

**Given** a server package with an array of ToolDefinition objects
**When** the server is initialized
**Then** all tools are registered with the MCP SDK using their name, title, description, inputSchema (Zod), outputSchema, and annotations

**Given** a client calls `tools/list`
**When** the tool list is requested
**Then** all registered tools are returned with cursor-based pagination (default 50 per page) (FR4)
**And** the response completes within 500ms (NFR5)
**And** each tool includes readOnlyHint, destructiveHint, idempotentHint, and openWorldHint annotations (FR5)

**Given** the tool set changes at runtime (e.g., bootstrap completes and enables previously unavailable tools)
**When** tools are added or removed
**Then** a `notifications/tools/list_changed` notification is emitted (FR6)
**And** note: this is primarily for MCP spec compliance and the bootstrap scenario where tools become available after REST service deployment; static tool registrations do not trigger this

**Given** a tool call with a `namespace` parameter on a namespace-scoped (NS) tool
**When** the handler is invoked
**Then** `ctx.resolveNamespace()` returns the provided namespace, overriding the configured default (FR7b)
**And** the namespace context does not affect other concurrent tool calls (FR7c)

**Given** a tool call on a SYS-scoped tool
**When** the handler is invoked
**Then** the tool always executes in %SYS regardless of any namespace parameter

**Given** a tool call with invalid arguments (wrong types, missing required fields)
**When** Zod validation fails
**Then** a JSON-RPC error (-32602) is returned with a description of the validation failure (NFR16)

**Given** a server configured for stdio transport
**When** the server starts
**Then** it communicates via stdin/stdout using JSON-RPC (FR7)

**Given** a server configured for Streamable HTTP transport
**When** the server starts
**Then** it listens on the configured port and accepts HTTP connections (FR7)

**And** MCP specification v2025-11-25 compliance is maintained for pagination, annotations, listChanged, structured output, and outputSchema (NFR12)
**And** tool responses include both `content` (TextContent) and `structuredContent` when returning data (NFR15)
**And** the @iris-mcp/shared package exports a defined public API via src/index.ts barrel: IrisHttpClient, IrisConnectionConfig, McpServerBase, ToolDefinition, ToolContext, ToolResult, ToolAnnotations, IrisConnectionError, IrisApiError, McpProtocolError, and config/logger utilities

### Story 1.5: Shared Package Integration Tests

As a developer,
I want integration tests that verify the shared infrastructure works against my local IRIS instance,
So that I have confidence the HTTP client, auth, health check, and version negotiation work correctly before building tools.

**Acceptance Criteria:**

**Given** a local IRIS development instance accessible via the web port
**When** the integration test suite runs
**Then** IrisHttpClient successfully authenticates with Basic Auth and receives a session cookie
**And** subsequent requests use the cookie-based session
**And** the health check via `HEAD /api/atelier/` succeeds
**And** Atelier API version negotiation via `GET /api/atelier/` returns a valid version number
**And** CSRF token extraction works correctly for mutating requests

**Given** invalid credentials
**When** the client attempts to authenticate
**Then** an IrisApiError is thrown with an actionable message about invalid credentials

**Given** an incorrect IRIS host or port
**When** the client attempts to connect
**Then** an IrisConnectionError is thrown within 2 seconds

**And** all tests use the Vitest framework
**And** integration test files are named `*.integration.test.ts` to distinguish from unit tests

## Epic 2: IRIS Development Tools — Atelier API (iris-dev-mcp)

A developer can manage ObjectScript documents, compile code with error feedback, search across codebases, work with macros, execute SQL queries, and get server/namespace info — all through their AI assistant via Atelier API-based tools.

### Story 2.1: iris-dev-mcp Package Setup & Server Entry Point

As a developer,
I want the iris-dev-mcp package initialized with its entry point and connected to the shared infrastructure,
So that I can start registering and using development tools.

**Acceptance Criteria:**

**Given** the @iris-mcp/shared package from Epic 1
**When** the iris-dev-mcp package is created
**Then** packages/iris-dev-mcp/ contains package.json with name @iris-mcp/dev and dependency on @iris-mcp/shared
**And** src/index.ts creates an McpServerBase instance and connects the configured transport (stdio or HTTP)
**And** src/tools/index.ts exports an empty ToolDefinition array (ready for tools to be added)
**And** tsconfig.json extends the base config with project reference to shared
**And** the server starts successfully with `node dist/index.js` and responds to `tools/list` with an empty tool list
**And** `turbo build` builds shared first, then iris-dev-mcp without errors

### Story 2.2: Document CRUD Tools

As a developer,
I want to read, create, update, delete, and list ObjectScript documents through my AI assistant,
So that I can manage source code on IRIS without leaving the AI conversation.

**Acceptance Criteria:**

**Given** a valid IRIS connection with an existing class document
**When** `iris_doc_get` is called with the document name (e.g., "MyApp.Service.cls")
**Then** the document content is returned in UDL format by default (FR16)
**And** an optional `format` parameter allows requesting XML format
**And** an optional `namespace` parameter overrides the default namespace

**Given** new or modified ObjectScript source code
**When** `iris_doc_put` is called with the document name and content
**Then** the document is created or updated on IRIS via the Atelier API (FR17)
**And** the response confirms the save was successful

**Given** one or more existing documents
**When** `iris_doc_delete` is called with the document name(s)
**Then** the specified documents are deleted from IRIS (FR18)
**And** the response confirms deletion

**Given** a namespace with ObjectScript documents
**When** `iris_doc_list` is called with optional category filter (CLS, RTN, CSP, OTH)
**Then** a filtered list of documents in the namespace is returned (FR19)
**And** results support pagination via the server base

**Given** a document that does not exist
**When** `iris_doc_get` is called
**Then** an MCP tool error is returned with `isError: true` and message: "Document '{name}' not found in namespace '{ns}'. Check the document name or try a different namespace."

**And** all four tools follow the ToolDefinition interface with appropriate annotations (readOnlyHint for get/list, destructiveHint for delete)
**And** unit tests with mocked HTTP responses verify parameter validation, response parsing, and error handling for each tool
**And** all tools respond within 2 seconds under normal IRIS load (NFR1)

### Story 2.3: Document Metadata & Modified Tracking

As a developer,
I want to check if a document exists and find documents that changed recently,
So that I can efficiently track modifications without downloading full document contents.

**Acceptance Criteria:**

**Given** an existing document name
**When** `iris_doc_get` is called with a metadata-only option (e.g., HEAD verb on the Atelier /doc/ endpoint)
**Then** the response includes the document's existence status and last modification timestamp without transferring content (FR20)

**Given** a timestamp
**When** `iris_doc_list` is called with a `modifiedSince` filter parameter
**Then** only documents modified since that timestamp are returned (FR21)
**And** an optional namespace parameter scopes the query

**Given** a document that does not exist
**When** `iris_doc_get` is called with metadata-only option
**Then** the response indicates the document does not exist without raising an error

**And** these capabilities are modes of existing tools (iris_doc_get and iris_doc_list), not separate tools — keeping iris-dev-mcp at exactly 20 tools per the PRD specification
**And** responses complete within 2 seconds (NFR1)

### Story 2.4: Compilation Tools

As a developer,
I want to compile ObjectScript documents with detailed error feedback,
So that I can fix compilation issues directly through my AI assistant without switching to the Management Portal.

**Acceptance Criteria:**

**Given** one or more valid document names
**When** `iris_doc_compile` is called with default flags
**Then** synchronous compilation is performed via the Atelier API (FR22)
**And** the response includes success/failure status and compilation time

**Given** compilation flags (e.g., "ck", "cku")
**When** `iris_doc_compile` is called with the flags parameter
**Then** the specified flags are passed to the Atelier compilation endpoint

**Given** a large package or multiple documents
**When** `iris_doc_compile` is called with an async option
**Then** asynchronous compilation is queued and the response includes a job ID for polling completion status (FR23)

**Given** source code with errors
**When** compilation fails
**Then** detailed compilation errors are returned including error message, source document, line number, and character position (FR24)
**And** the response uses isError: false (compilation completed, errors are in the result data)

**Given** a single class compilation
**When** the compilation runs
**Then** it completes within 30 seconds (NFR2)

**Given** a full package compilation
**When** the compilation runs
**Then** it completes within 120 seconds (NFR2)

**And** the tool is annotated as readOnlyHint: false, destructiveHint: false, idempotentHint: true
**And** unit tests with mocked HTTP responses verify compilation flag handling, async polling, and error parsing

### Story 2.5: Code Intelligence Tools

As a developer,
I want to inspect class structures, search across code, and look up macro definitions,
So that I can understand and navigate the IRIS codebase through my AI assistant.

**Acceptance Criteria:**

**Given** a class document name
**When** `iris_doc_index` is called
**Then** the class structure is returned including methods, properties, parameters, and superclasses (FR25)
**And** each member includes its type, signature, and relevant metadata

**Given** a search query (text or regex pattern)
**When** `iris_doc_search` is called with the pattern
**Then** matching documents and locations are returned (FR26)
**And** options for regex, wildcard, and case-sensitivity are supported
**And** an optional namespace parameter scopes the search

**Given** a macro name
**When** `iris_macro_info` is called
**Then** the macro definition, source location, and expanded value are returned (FR27)

**Given** a search with no results
**When** `iris_doc_search` returns empty
**Then** an empty result set is returned (not an error)

**And** all three tools are annotated as readOnlyHint: true
**And** responses complete within 2 seconds (NFR1)

### Story 2.6: Document Format & XML Tools

As a developer,
I want to convert documents between formats and import/export XML,
So that I can work with legacy XML-based workflows and convert between UDL and XML representations.

**Acceptance Criteria:**

**Given** a document in UDL format
**When** `iris_doc_convert` is called with target format XML
**Then** the document is converted and returned in XML format (FR28)

**Given** a document in XML format
**When** `iris_doc_convert` is called with target format UDL
**Then** the document is converted and returned in UDL format (FR28)

**Given** one or more document names
**When** `iris_doc_xml_export` is called with action "export"
**Then** the documents are exported to legacy XML format and the XML content is returned (FR29)

**Given** XML content containing ObjectScript documents
**When** `iris_doc_xml_export` is called with action "import"
**Then** the documents are imported into IRIS from the provided XML content (FR30)

**Given** XML content
**When** `iris_doc_xml_export` is called with action "list"
**Then** a list of documents contained in the XML is returned without importing them (FR31)

**And** FR29-FR31 are handled as action parameters on `iris_doc_xml_export` — no separate tools are created, keeping iris-dev-mcp at exactly 20 tools per the PRD specification
**And** iris_doc_xml_export with action "export"/"list" is annotated as readOnlyHint: true
**And** iris_doc_xml_export with action "import" is annotated as destructiveHint: true
**And** iris_doc_convert is annotated as readOnlyHint: true

### Story 2.7: SQL Execution & Server Info

As a developer,
I want to execute SQL queries and retrieve IRIS server information through MCP tools,
So that I can query data and understand my IRIS environment without leaving the AI conversation.

**Acceptance Criteria:**

**Given** a valid SQL query
**When** `iris_sql_execute` is called with the query string
**Then** the query is executed via the Atelier API and results are returned with column names and row data (FR32)
**And** parameterized inputs are supported to prevent SQL injection
**And** a configurable row limit parameter prevents unbounded result sets (default reasonable limit)

**Given** a SQL query
**When** execution begins
**Then** first results are returned within 5 seconds (NFR3)

**Given** an invalid SQL query
**When** `iris_sql_execute` is called
**Then** an MCP tool error is returned with the SQL error message

**Given** a connected IRIS instance
**When** `iris_server_info` is called
**Then** server information is returned including IRIS version, platform, and instance name
**And** the tool has scope NONE (no namespace context)

**Given** a namespace name
**When** `iris_server_namespace` is called
**Then** namespace details are returned including associated databases and enabled features
**And** the tool has scope NS (accepts namespace parameter)

**And** iris_sql_execute is annotated as readOnlyHint: false (can execute INSERT/UPDATE/DELETE)
**And** iris_server_info and iris_server_namespace are annotated as readOnlyHint: true

### Story 2.8: iris-dev-mcp Unit & Integration Tests

As a developer,
I want unit tests (mocked HTTP) and integration tests (real IRIS) for all Atelier API-based tools,
So that I can verify parameter validation, response parsing, and end-to-end behavior.

**Acceptance Criteria:**

**Given** a local IRIS development instance
**When** the integration test suite runs
**Then** iris_doc_get retrieves an existing class document successfully
**And** iris_doc_put creates a new test document and iris_doc_get confirms it exists
**And** iris_doc_delete removes the test document and iris_doc_head confirms it is gone
**And** iris_doc_list returns documents filtered by category (CLS)
**And** iris_doc_head returns metadata for an existing document
**And** iris_doc_modified returns documents modified in the last hour
**And** iris_doc_compile compiles a valid class successfully and returns compilation errors for an invalid class
**And** iris_doc_index returns class structure for a known class
**And** iris_doc_search finds a known string in a document
**And** iris_macro_info returns definition for a known macro
**And** iris_doc_convert converts between UDL and XML
**And** iris_doc_xml_export exports a document to XML
**And** iris_sql_execute runs a SELECT query and returns results
**And** iris_server_info returns valid server information
**And** iris_server_namespace returns details for the configured namespace

**And** unit tests (`__tests__/*.test.ts`) with mocked HTTP responses verify parameter validation, response parsing, and error handling for every tool
**And** each integration test cleans up any test documents it creates
**And** integration tests are in `__tests__/*.integration.test.ts` files
**And** all tests use the Vitest framework

## Epic 3: Custom REST Service, Auto-Bootstrap & Execution Tools

The IRIS-side REST service is deployed (automatically or manually), enabling global operations, ObjectScript command execution, class method calls, and unit test execution. The auto-bootstrap flow handles installation transparently.

### Story 3.1: ObjectScript REST Dispatch & Utils Classes

As a developer,
I want the IRIS-side REST service foundation with URL routing and shared utilities,
So that all custom REST handlers have a consistent base for request handling, namespace management, and response formatting.

**Acceptance Criteria:**

**Given** the ExecuteMCPv2 package on IRIS
**When** ExecuteMCPv2.REST.Dispatch is created
**Then** it extends %Atelier.REST and defines the UrlMap for Epic 3 REST endpoints only
**And** initial routes map to handler classes: /command, /classmethod → Command, /tests → UnitTest, /global → Global
**And** the URL prefix is /api/executemcp/v2/
**And** the Dispatch class is designed to be extended in subsequent epics (Epics 4-7) as new handler classes are created — each epic adds its routes to the UrlMap and recompiles Dispatch

**Given** a request to any REST endpoint
**When** the handler processes the request
**Then** the response uses the Atelier-style three-part envelope ({status, console, result}) inherited from %Atelier.REST via RenderResponseBody()
**And** errors are returned via StatusToJSON() converting %Status to structured error objects

**Given** the ExecuteMCPv2.Utils class
**When** a handler needs to switch namespace
**Then** Utils provides a namespace switch helper that saves current $NAMESPACE, switches to the target, and guarantees restore in both normal and error paths
**And** Utils provides input validation helpers for common parameter types (string, integer, boolean, required fields) (NFR10)

**Given** any REST handler encountering an error
**When** the error is returned to the caller
**Then** internal IRIS details (stack traces, global references, $ZERROR) are stripped — only safe, actionable messages are returned (NFR11)

**And** the Dispatch class compiles successfully on IRIS
**And** all ObjectScript follows the handler pattern: namespace save → try → work → RenderResponseBody → catch → RenderResponseBody → restore namespace

### Story 3.2: Global Operations REST Handler & Tools

As a developer,
I want to read, write, delete, and list globals through my AI assistant,
So that I can inspect and manipulate IRIS data structures without using the Terminal.

**Acceptance Criteria:**

**Given** a global name and optional subscripts
**When** `iris_global_get` is called
**Then** the value at the specified global node is returned via the custom REST endpoint GET /api/executemcp/v2/global (FR33)
**And** complex subscript expressions are supported (multi-level, string subscripts)

**Given** a global name, subscripts, and a value
**When** `iris_global_set` is called
**Then** the global value is set via PUT /api/executemcp/v2/global (FR34)
**And** the response includes automatic verification that the value was set correctly

**Given** a global name and optional subscripts
**When** `iris_global_kill` is called
**Then** the specified global node or subtree is deleted via DELETE /api/executemcp/v2/global (FR35)

**Given** a namespace
**When** `iris_global_list` is called with an optional filter pattern
**Then** a list of globals in the namespace is returned (FR36)

**Given** a global operation that would leave IRIS in an inconsistent state
**When** an error occurs mid-operation
**Then** the operation fails cleanly without partial state changes (NFR20)
**And** the namespace is always restored to its original value (NFR21)

**And** the ExecuteMCPv2.REST.Global handler class is created and compiles on IRIS
**And** the four iris.global.* tools are registered in iris-dev-mcp's tool registry (src/tools/global.ts exported via src/tools/index.ts)
**And** iris_global_get and iris_global_list are annotated as readOnlyHint: true
**And** iris_global_set is annotated as destructiveHint: false (creates/updates data)
**And** iris_global_kill is annotated as destructiveHint: true
**And** unit tests with mocked HTTP responses verify parameter validation, response parsing, and error handling
**And** all tools respond within 2 seconds for read operations (NFR1)

### Story 3.3: ObjectScript Execution REST Handler & Tools

As a developer,
I want to execute ObjectScript commands and call class methods through my AI assistant,
So that I can run code on IRIS directly from the AI conversation.

**Acceptance Criteria:**

**Given** a valid ObjectScript command string
**When** `iris_execute_command` is called
**Then** the command is executed on IRIS via POST /api/executemcp/v2/command (FR37)
**And** captured I/O output (Write statements, error messages) is returned in the response

**Given** a class name, method name, and optional positional parameters
**When** `iris_execute_classmethod` is called
**Then** the class method is invoked on IRIS via POST /api/executemcp/v2/classmethod (FR38)
**And** the return value is included in the response
**And** output parameters are supported and returned

**Given** a command or classmethod call that fails
**When** an ObjectScript error occurs
**Then** the error is returned as a structured MCP tool error with an actionable message
**And** internal IRIS error details ($ZERROR, stack traces) are not exposed (NFR11)

**Given** any execution request with a namespace parameter
**When** the handler processes the request
**Then** execution occurs in the specified namespace
**And** the namespace is restored after execution, even on error (NFR21)

**And** the ExecuteMCPv2.REST.Command handler class is created and compiles on IRIS
**And** both tools are registered in iris-dev-mcp's tool registry (src/tools/execute.ts)
**And** both tools are annotated as readOnlyHint: false, destructiveHint: false (general-purpose execution)
**And** unit tests with mocked HTTP responses verify parameter validation, response parsing, and error handling

### Story 3.4: Unit Test Execution REST Handler & Tool

As a developer,
I want to run ObjectScript unit tests through my AI assistant with structured results,
So that I can verify code correctness without leaving the AI conversation.

**Acceptance Criteria:**

**Given** a test package name (e.g., "MyApp.Test")
**When** `iris_execute_tests` is called with level "package"
**Then** all test classes in the package are executed via POST /api/executemcp/v2/tests (FR39)
**And** structured results are returned including: total tests, passed, failed, skipped, and per-test details (class, method, status, message)

**Given** a test class name
**When** `iris_execute_tests` is called with level "class"
**Then** only the specified test class is executed

**Given** a test class name and method name
**When** `iris_execute_tests` is called with level "method"
**Then** only the specified test method is executed

**Given** the REST handler processing a test request
**When** ^UnitTestRoot is not defined in the target namespace
**Then** the handler sets ^UnitTestRoot = "" before running tests (guard pattern)
**And** if ^UnitTestRoot is already defined, its value is preserved

**Given** any test execution
**When** RunTest is called
**Then** the /noload/nodelete qualifiers are always used (tests are pre-compiled via MCP, not loaded from disk)

**Given** test failures
**When** tests complete with failures
**Then** the response includes failure details per test (assertion message, expected vs actual) but isError is false (test execution succeeded, failures are in the result data)

**And** the ExecuteMCPv2.REST.UnitTest handler class is created and compiles on IRIS
**And** the tool is registered in iris-dev-mcp's tool registry (src/tools/execute.ts)
**And** the tool is annotated as readOnlyHint: true (tests observe, don't modify production data)
**And** unit tests with mocked HTTP responses verify parameter validation, response parsing, and error handling

### Story 3.5: Setup Class & IPM Module

As an administrator,
I want a one-command IRIS-side setup option and an IPM package for alternative installation,
So that I can complete server setup manually when auto-bootstrap lacks sufficient privileges.

**Note:** This story must precede the Auto-Bootstrap story because the bootstrap flow calls Setup.Configure().

**Acceptance Criteria:**

**Given** the ExecuteMCPv2.Setup class on IRIS
**When** `Do ##class(ExecuteMCPv2.Setup).Configure()` is called in the %SYS Terminal
**Then** the /api/executemcp web application is registered with the correct configuration (REST dispatch class, allowed authentication methods, CSP application path)
**And** the method returns $$$OK on success or a descriptive %Status error on failure

**Given** the ipm/module.xml file
**When** `zpm "install iris-execute-mcp-v2"` is run on IRIS
**Then** all ExecuteMCPv2 ObjectScript classes are loaded and compiled
**And** the web application is registered via the Setup.Configure() method
**And** the installation is a single-command alternative to auto-bootstrap

**And** ExecuteMCPv2.Setup.cls compiles successfully on IRIS
**And** module.xml references all classes in src/ExecuteMCPv2/ and includes the web application configuration

### Story 3.6: Auto-Bootstrap Flow

As a developer,
I want the MCP server to automatically deploy its IRIS-side components when they're missing,
So that I can start using the server with zero manual IRIS configuration.

**Acceptance Criteria:**

**Given** a fresh IRIS instance with no ExecuteMCPv2 classes installed
**When** any MCP server that requires the custom REST service starts up
**Then** the bootstrap flow detects the REST service is missing via a probe request to /api/executemcp/v2/ (FR8)
**And** ObjectScript classes are deployed to IRIS via the Atelier API PUT /doc endpoint (FR9)
**And** deployed classes are compiled via the Atelier API POST /action/compile (FR10)
**And** the Setup.Configure() class method (from Story 3.5) is called to register the /api/executemcp web application (FR11)

**Given** a user with %Admin_Manage privileges
**When** the full bootstrap flow runs
**Then** all steps complete successfully (deploy, compile, configure web app)
**And** the entire flow completes within 60 seconds (NFR4)

**Given** a user with only %Development privileges (no %Admin_Manage)
**When** the bootstrap runs
**Then** class deployment and compilation succeed
**And** web application registration fails
**And** the server reports which steps succeeded and which failed (FR12)
**And** explicit manual instructions are provided: Terminal command `Do ##class(ExecuteMCPv2.Setup).Configure()`, SMP navigation path, and parameter details (FR13)
**And** IPM installation is suggested as an alternative: `zpm "install iris-execute-mcp-v2"` (FR14)

**Given** a subsequent server connection after successful bootstrap
**When** the bootstrap check runs
**Then** completed steps are detected and skipped (FR15)
**And** the bootstrap is idempotent — running it multiple times has no side effects (NFR19)

**And** bootstrap state tracking is implemented in shared/bootstrap.ts
**And** bootstrap runs only at server startup or reconnection, never during tool execution

### Story 3.7: Epic 3 Unit & Integration Tests

As a developer,
I want unit tests (mocked HTTP) and integration tests (real IRIS) for all custom REST tools and the bootstrap flow,
So that I can verify parameter validation, response parsing, and end-to-end behavior.

**Acceptance Criteria:**

**Given** a local IRIS development instance with the ExecuteMCPv2 REST service deployed
**When** the integration test suite runs
**Then** iris_global_get retrieves a known global value
**And** iris_global_set writes a test global and iris_global_get confirms the value
**And** iris_global_kill removes the test global and iris_global_get confirms it is gone
**And** iris_global_list returns globals in the test namespace
**And** iris_execute_command runs a simple SET command and returns captured output
**And** iris_execute_classmethod calls a known class method and returns the result
**And** iris_execute_tests runs a simple test class and returns structured pass/fail results

**Given** the bootstrap flow
**When** tested against the local IRIS instance
**Then** the bootstrap detects the existing REST service and skips deployment (idempotent behavior)

**And** unit tests (`__tests__/*.test.ts`) with mocked HTTP responses verify parameter validation, response parsing, and error handling for every custom REST tool
**And** each integration test cleans up any test globals or artifacts it creates
**And** integration tests verify namespace restoration after each tool call
**And** integration tests are in `__tests__/*.integration.test.ts` files using Vitest

### Story 3.8: Configurable HTTP Client Timeout

As a developer,
I want the HTTP client timeout to be configurable via an IRIS_TIMEOUT environment variable with a 60-second default,
So that long-running operations like package compilation and unit test execution don't prematurely abort.

**Acceptance Criteria:**

**Given** no IRIS_TIMEOUT environment variable is set
**When** the MCP server starts
**Then** the IrisHttpClient uses a 60,000ms default timeout (up from 30,000ms)

**Given** IRIS_TIMEOUT=120000 is set in the environment
**When** the MCP server starts
**Then** the IrisHttpClient uses 120,000ms as the default timeout

**Given** a tool handler that passes a per-request timeout via RequestOptions.timeout
**When** the request is made
**Then** the per-request timeout overrides the server-level default

**Given** the health check and ping functions
**When** they execute
**Then** they continue to use their own independent timeouts (5s and 2s respectively)

**Given** the .env.example file
**When** a developer reviews configuration options
**Then** IRIS_TIMEOUT is documented with its default value and purpose

**Given** the README.md
**When** a developer is configuring for long-running operations (large compiles, full test suites)
**Then** documentation explains the web server gateway timeout (Apache default ~60s, IIS equivalent) as a separate layer that may need adjustment, with specific instructions for both web servers

**Technical scope:**
- Update IrisConnectionConfig in config.ts to include optional timeout field
- Update loadConfig() to read IRIS_TIMEOUT from environment (default 60000)
- Update McpServerBase.start() in server-base.ts to pass config timeout to IrisHttpClient constructor
- Update .env.example with IRIS_TIMEOUT documentation
- Add web server gateway timeout section to README.md
- Update unit tests for config loading and timeout behavior

### Story 3.9: Bulk Document Load from Disk (iris_doc_load)

As a developer,
I want to load multiple ObjectScript files from a local directory into IRIS in a single tool call,
So that I can efficiently deploy entire packages or project directories without making individual iris_doc_put calls.

**Acceptance Criteria:**

**Given** a directory path with a glob pattern (e.g., "c:/projects/myapp/src/**/*.cls")
**When** `iris_doc_load` is called with the path pattern
**Then** all matching files are read from disk and uploaded to IRIS one by one via the Atelier doc/PUT endpoint

**Given** uploaded files and `compile: true` specified
**When** all uploads complete successfully
**Then** all uploaded documents are compiled via the Atelier action/compile endpoint
**And** compilation results including any errors are returned

**Given** `compile: true` and a `flags` parameter (e.g., "ck")
**When** compilation runs
**Then** the specified compilation flags are passed to the compile endpoint

**Given** a file that fails to upload
**When** the error occurs
**Then** the tool continues uploading remaining files and reports all failures at the end (continue-on-error behavior)

**Given** the `ignoreConflict` parameter is set to true (default)
**When** files are uploaded
**Then** server-side versions are overwritten without conflict checking

**Given** uploaded files
**When** document names are derived from file paths
**Then** the tool maps filesystem paths to IRIS document names correctly (e.g., MyPackage/MyClass.cls -> MyPackage.MyClass.cls)

**Given** the tool completes
**When** results are returned
**Then** the response includes: total files found, files uploaded successfully, files failed, and if compilation was requested, compilation results with any errors

**Technical scope:**
- New tool definition in packages/iris-dev-mcp/src/tools/ (new file, e.g., load.ts)
- Extract compile result parsing from compile.ts into a shared helper function
- Register tool in tools/index.ts
- Supported file types: .cls, .mac, .inc, .int
- Tool annotations: readOnlyHint: false, destructiveHint: false, idempotentHint: true
- Unit tests with mocked filesystem and HTTP responses
- iris-dev-mcp tool count increases from 20 to 21

## Epic 4: IRIS Administration (iris-admin-mcp)

An administrator can provision complete IRIS environments — namespaces, databases, users, roles, resources, web applications, SSL configs, and OAuth2 — entirely through AI-directed MCP tool calls, without opening the Management Portal.

### Story 4.1: iris-admin-mcp Package Setup & Server Entry Point

As an administrator,
I want the iris-admin-mcp package initialized and connected to the shared infrastructure,
So that I can start registering and using administration tools.

**Acceptance Criteria:**

**Given** the @iris-mcp/shared package from Epic 1
**When** the iris-admin-mcp package is created
**Then** packages/iris-admin-mcp/ contains package.json with name @iris-mcp/admin and dependency on @iris-mcp/shared
**And** src/index.ts creates an McpServerBase instance and connects the configured transport
**And** src/tools/index.ts exports an empty ToolDefinition array
**And** tsconfig.json extends the base config with project reference to shared
**And** the server starts successfully and responds to `tools/list`
**And** `turbo build` builds without errors

### Story 4.2: Namespace & Database Management Tools

As an administrator,
I want to create, modify, delete, and list namespaces and databases through MCP tools,
So that I can provision IRIS environments without the Management Portal.

**Acceptance Criteria:**

**Given** a namespace name, code database, and data database
**When** `iris_namespace_manage` is called with action "create"
**Then** a new namespace is created on IRIS with the specified database bindings via the custom REST endpoint (FR40)
**And** the tool executes in %SYS scope (no namespace parameter — target namespace is a data parameter)

**Given** an existing namespace
**When** `iris_namespace_manage` is called with action "modify"
**Then** the namespace configuration is updated (FR40)

**Given** an existing namespace
**When** `iris_namespace_manage` is called with action "delete"
**Then** the namespace is removed from IRIS (FR40)

**Given** no parameters
**When** `iris_namespace_list` is called
**Then** all namespaces are returned with their associated code and data databases (FR41)

**Given** database configuration parameters (name, directory, size options)
**When** `iris_database_manage` is called with action "create"
**Then** a new database is created with full configuration options (FR42)

**Given** no parameters or optional filters
**When** `iris_database_list` is called
**Then** all databases are returned with size, free space, and mount status (FR43)

**Given** a failed namespace or database operation
**When** an error occurs
**Then** IRIS is not left in an inconsistent state (e.g., no partially created namespaces) (NFR20)

**And** the ExecuteMCPv2.REST.Config handler class is created and compiles on IRIS
**And** the Dispatch UrlMap is extended with /config/:entity route and Dispatch is recompiled
**And** iris_namespace_manage and iris_database_manage are annotated as destructiveHint: true (can delete)
**And** iris_namespace_list and iris_database_list are annotated as readOnlyHint: true
**And** all inputs are validated at the REST boundary (NFR10)
**And** unit tests with mocked HTTP responses verify parameter validation, response parsing, and error handling

### Story 4.3: Namespace Mapping Tools

As an administrator,
I want to create, delete, and list global, routine, and package mappings between namespaces,
So that I can configure cross-namespace data and code access.

**Acceptance Criteria:**

**Given** a source namespace, mapping type (global, routine, or package), and mapping details
**When** `iris_mapping_manage` is called with action "create"
**Then** the specified mapping is created between namespaces (FR44)
**And** the tool executes in %SYS (target namespace is a data parameter)

**Given** an existing mapping
**When** `iris_mapping_manage` is called with action "delete"
**Then** the mapping is removed (FR44)

**Given** a namespace name
**When** `iris_mapping_list` is called
**Then** all global, routine, and package mappings for that namespace are returned (FR45)

**And** iris_mapping_manage is annotated as destructiveHint: true
**And** iris_mapping_list is annotated as readOnlyHint: true

### Story 4.4: User & Password Management Tools

As an administrator,
I want to manage user accounts, assign roles, and handle passwords through MCP tools,
So that I can provision user access without the Management Portal.

**Acceptance Criteria:**

**Given** user account details (username, password, roles, properties)
**When** `iris_user_manage` is called with action "create"
**Then** a new IRIS user account is created with the specified configuration (FR46)

**Given** an existing username
**When** `iris_user_manage` is called with action "modify"
**Then** the user properties are updated (FR46)

**Given** an existing username
**When** `iris_user_manage` is called with action "delete"
**Then** the user account is removed (FR46)

**Given** a username
**When** `iris_user_get` is called
**Then** user properties are returned (roles, status, last login, etc.) (FR47)

**Given** no parameters
**When** `iris_user_get` is called with action "list"
**Then** all users are returned with their properties (FR47)

**Given** a username and a role name
**When** `iris_user_roles` is called with action "add" or "remove"
**Then** the role is added to or removed from the user (FR48)

**Given** a username and a new password
**When** `iris_user_password` is called with action "change"
**Then** the password is updated (FR49)

**Given** a username and a candidate password
**When** `iris_user_password` is called with action "validate"
**Then** the password is checked against IRIS password policy and the result is returned (FR49)

**And** the ExecuteMCPv2.REST.Security handler class is created and compiles on IRIS
**And** the Dispatch UrlMap is extended with /security/:entity route and Dispatch is recompiled
**And** passwords are never included in log output or error messages (NFR6)
**And** iris_user_manage is annotated as destructiveHint: true
**And** iris_user_get is annotated as readOnlyHint: true
**And** all tools execute in %SYS scope
**And** unit tests with mocked HTTP responses verify parameter validation, response parsing, and error handling

### Story 4.5: Role & Resource Management Tools

As an administrator,
I want to manage security roles, resources, and check permissions through MCP tools,
So that I can configure IRIS security without the Management Portal.

**Acceptance Criteria:**

**Given** role details (name, description, resource grants)
**When** `iris_role_manage` is called with action "create"
**Then** a new security role is created with the specified resource grants (FR50)

**Given** an existing role
**When** `iris_role_manage` is called with action "modify" or "delete"
**Then** the role is updated or removed (FR50)

**Given** no parameters
**When** `iris_role_list` is called
**Then** all security roles are returned (FR51)

**Given** resource details (name, description, public permission)
**When** `iris_resource_manage` is called with action "create"
**Then** a new security resource is created (FR52)

**Given** an existing resource
**When** `iris_resource_manage` is called with action "modify" or "delete"
**Then** the resource is updated or removed (FR52)

**Given** no parameters
**When** `iris_resource_list` is called
**Then** all security resources are returned (FR53)

**Given** a user or role name and a resource name
**When** `iris_permission_check` is called
**Then** the response indicates whether the user/role has the specified permission on the resource (FR54)

**And** iris_role_manage and iris_resource_manage are annotated as destructiveHint: true
**And** iris_role_list, iris_resource_list, and iris_permission_check are annotated as readOnlyHint: true

### Story 4.6: Web Application Management Tools

As an administrator,
I want to create, modify, delete, and list CSP/REST web applications through MCP tools,
So that I can configure web access to IRIS without the Management Portal.

**Acceptance Criteria:**

**Given** web application configuration (name, namespace, dispatch class, authentication methods, CSP path)
**When** `iris_webapp_manage` is called with action "create"
**Then** a new web application is registered on IRIS (FR55)

**Given** an existing web application name
**When** `iris_webapp_manage` is called with action "modify"
**Then** the web application configuration is updated (FR55)

**Given** an existing web application name
**When** `iris_webapp_manage` is called with action "delete"
**Then** the web application is removed (FR55)

**Given** a web application name
**When** `iris_webapp_get` is called
**Then** the full web application properties are returned (FR56)

**Given** an optional namespace filter
**When** `iris_webapp_list` is called
**Then** all web applications are returned, optionally filtered by namespace (FR57)
**And** the tool has scope BOTH (accepts optional namespace for filtering)

**And** iris_webapp_manage is annotated as destructiveHint: true
**And** iris_webapp_get is annotated as readOnlyHint: true
**And** iris_webapp_list is annotated as readOnlyHint: true

### Story 4.7: SSL/TLS Configuration Tools

As an administrator,
I want to manage SSL/TLS configurations through MCP tools,
So that I can set up secure communications without the Management Portal.

**Acceptance Criteria:**

**Given** SSL configuration details (name, certificate file paths, key file, CA file, protocols)
**When** `iris_ssl_manage` is called with action "create"
**Then** a new SSL/TLS configuration is created on IRIS (FR58)

**Given** an existing SSL configuration
**When** `iris_ssl_manage` is called with action "modify" or "delete"
**Then** the SSL configuration is updated or removed (FR58)

**Given** no parameters
**When** `iris_ssl_list` is called
**Then** all SSL/TLS configurations are returned with their details (certificate paths, enabled protocols, verification settings) (FR59)

**And** the ExecuteMCPv2.REST.SSL handler is included in the Security handler or created separately
**And** iris_ssl_manage is annotated as destructiveHint: true
**And** iris_ssl_list is annotated as readOnlyHint: true

### Story 4.8: OAuth2 Management Tools

As an administrator,
I want to manage OAuth2 server definitions and client registrations through MCP tools,
So that I can configure OAuth2 authentication without the Management Portal.

**Acceptance Criteria:**

**Given** OAuth2 server definition parameters (issuer URL, scopes, endpoints)
**When** `iris_oauth_manage` is called with action "create" and entity "server"
**Then** a new OAuth2 server definition is created (FR60)

**Given** client registration parameters (client name, redirect URIs, grant types)
**When** `iris_oauth_manage` is called with action "create" and entity "client"
**Then** a new OAuth2 client application is registered (FR60)

**Given** an issuer URL
**When** `iris_oauth_manage` is called with action "discover"
**Then** OpenID Connect discovery is performed and the discovered configuration is returned (FR61)

**Given** no parameters or optional filters
**When** `iris_oauth_list` is called
**Then** OAuth2 configurations are returned including server definitions and registered client details (FR62)

**And** the ExecuteMCPv2.REST.OAuth handler is created and compiles on IRIS
**And** client secrets are never included in log output (NFR6)
**And** iris_oauth_manage is annotated as destructiveHint: true
**And** iris_oauth_list is annotated as readOnlyHint: true

### Story 4.9: iris-admin-mcp Unit & Integration Tests

As an administrator,
I want unit tests (mocked HTTP) and integration tests (real IRIS) for all administration tools,
So that I can verify parameter validation, response parsing, and end-to-end behavior.

**Acceptance Criteria:**

**Given** a local IRIS development instance with the ExecuteMCPv2 REST service deployed
**When** the integration test suite runs
**Then** iris_namespace_manage creates a test namespace and iris_namespace_list confirms it exists
**And** iris_database_manage creates a test database and iris_database_list confirms it exists
**And** iris_mapping_manage creates a test mapping and iris_mapping_list confirms it exists
**And** iris_user_manage creates a test user and iris_user_get confirms the user properties
**And** iris_user_roles adds a role to the test user and confirms assignment
**And** iris_user_password validates a password against policy
**And** iris_role_manage creates a test role and iris_role_list confirms it exists
**And** iris_resource_manage creates a test resource and iris_resource_list confirms it exists
**And** iris_permission_check verifies permissions for the test user/role
**And** iris_webapp_manage creates a test web application and iris_webapp_get confirms its properties
**And** iris_webapp_list returns the test web application
**And** iris_ssl_manage creates a test SSL configuration and iris_ssl_list confirms it exists
**And** iris_oauth_manage creates a test OAuth2 configuration and iris_oauth_list confirms it exists

**And** unit tests (`__tests__/*.test.ts`) with mocked HTTP responses verify parameter validation, response parsing, and error handling for every admin tool
**And** integration test cleanup follows dependency order: remove web apps before namespaces, remove role assignments before roles, remove users before roles they reference
**And** each test cleans up all created resources (users, roles, resources, namespaces, databases, web apps, SSL configs, OAuth configs) after execution
**And** tests verify that cleanup leaves no orphaned objects
**And** integration tests are in `__tests__/*.integration.test.ts` files using Vitest

## Epic 5: Interoperability Management (iris-interop-mcp)

An integration engineer can create, control, monitor, and debug Interoperability productions — including credentials, lookup tables, rules, transforms, and REST API management — through MCP tools.

### Story 5.1: iris-interop-mcp Package Setup & Server Entry Point

As an integration engineer,
I want the iris-interop-mcp package initialized and connected to the shared infrastructure,
So that I can start registering and using interoperability tools.

**Acceptance Criteria:**

**Given** the @iris-mcp/shared package from Epic 1
**When** the iris-interop-mcp package is created
**Then** packages/iris-interop-mcp/ contains package.json with name @iris-mcp/interop and dependency on @iris-mcp/shared
**And** src/index.ts creates an McpServerBase instance and connects the configured transport
**And** src/tools/index.ts exports an empty ToolDefinition array
**And** tsconfig.json extends the base config with project reference to shared
**And** the server starts successfully and responds to `tools/list`
**And** `turbo build` builds without errors

### Story 5.2: Production Lifecycle Tools

As an integration engineer,
I want to create, delete, start, stop, and monitor Interoperability productions through MCP tools,
So that I can manage production lifecycle without opening the Management Portal.

**Acceptance Criteria:**

**Given** a production class name and namespace
**When** `iris_production_manage` is called with action "create"
**Then** a new Interoperability production is created in the specified namespace (FR63)

**Given** an existing production
**When** `iris_production_manage` is called with action "delete"
**Then** the production is removed (FR63)

**Given** an existing production
**When** `iris_production_control` is called with action "start"
**Then** the production is started (FR64)

**Given** a running production
**When** `iris_production_control` is called with action "stop", "restart", "update", or "recover"
**Then** the corresponding lifecycle action is performed (FR64)

**Given** a namespace with a production
**When** `iris_production_status` is called
**Then** the production status is returned including name, state (Running/Stopped/Suspended/Troubled), and start time (FR65)
**And** when the detail flag is true, item-level status is included (each config item's state, adapter, queue count)

**Given** no parameters
**When** `iris_production_summary` is called
**Then** a summary of productions across all namespaces is returned (FR66)
**And** the tool has scope NONE

**And** the ExecuteMCPv2.REST.Interop handler class is created and compiles on IRIS
**And** the Dispatch UrlMap is extended with /interop/:entity route and Dispatch is recompiled
**And** iris_production_manage is annotated as destructiveHint: true
**And** iris_production_control is annotated as destructiveHint: false (lifecycle management, not data deletion)
**And** iris_production_status and iris_production_summary are annotated as readOnlyHint: true
**And** unit tests with mocked HTTP responses verify parameter validation, response parsing, and error handling
**And** all tools respond within 2 seconds for status queries (NFR1)

### Story 5.3: Production Item & Auto-Start Tools

As an integration engineer,
I want to enable, disable, and configure individual production items and auto-start settings,
So that I can fine-tune production behavior without the Management Portal.

**Acceptance Criteria:**

**Given** a production item name and namespace
**When** `iris_production_item` is called with action "enable"
**Then** the specified config item is enabled (FR67)

**Given** a production item name
**When** `iris_production_item` is called with action "disable"
**Then** the specified config item is disabled (FR67)

**Given** a production item name
**When** `iris_production_item` is called with action "get"
**Then** the config item's host and adapter settings are returned (FR68)

**Given** a production item name and settings to update
**When** `iris_production_item` is called with action "set"
**Then** the config item's host and/or adapter settings are updated (FR68)

**Given** a namespace and production name
**When** `iris_production_autostart` is called with action "get"
**Then** the current auto-start configuration is returned (FR69)

**Given** a namespace, production name, and auto-start flag
**When** `iris_production_autostart` is called with action "set"
**Then** the production auto-start setting is updated (FR69)

**And** iris_production_item with action "get" is annotated as readOnlyHint: true
**And** iris_production_item with action "set"/"enable"/"disable" is annotated as destructiveHint: false
**And** all tools have scope NS

### Story 5.4: Production Monitoring Tools

As an integration engineer,
I want to query production logs, check queue status, trace messages, and list adapters,
So that I can troubleshoot production issues through my AI assistant.

**Acceptance Criteria:**

**Given** a namespace with a production
**When** `iris_production_logs` is called with optional filters (type, item name, count)
**Then** production event log entries are returned matching the filters (FR70)
**And** log entries include timestamp, type (Info/Warning/Error), item name, and message text

**Given** a namespace with a running production
**When** `iris_production_queues` is called
**Then** queue status for all production items is returned including queue count and processing rate (FR71)

**Given** a session ID or header ID
**When** `iris_production_messages` is called
**Then** the message flow trace is returned showing the complete path through the production (FR72)
**And** each step includes source item, target item, message class, timestamp, and status

**Given** an optional category filter (inbound, outbound, process)
**When** `iris_production_adapters` is called
**Then** available adapter types are returned grouped by category (FR73)

**And** all four tools are annotated as readOnlyHint: true
**And** all tools have scope NS
**And** log and message queries respond within 2 seconds (NFR1)

### Story 5.5: Credential & Lookup Table Tools

As an integration engineer,
I want to manage Ensemble credentials and lookup tables through MCP tools,
So that I can configure integration settings without the Management Portal.

**Acceptance Criteria:**

**Given** credential details (ID, username, password)
**When** `iris_credential_manage` is called with action "create"
**Then** a new Ensemble credential is stored (FR74)

**Given** an existing credential ID
**When** `iris_credential_manage` is called with action "update" or "delete"
**Then** the credential is updated or removed (FR74)

**Given** a namespace
**When** `iris_credential_list` is called
**Then** stored credentials are returned (credential IDs and usernames, never passwords) (FR75)

**Given** a lookup table name and key-value pair
**When** `iris_lookup_manage` is called with action "set"
**Then** the lookup table entry is created or updated (FR76)

**Given** a lookup table name and key
**When** `iris_lookup_manage` is called with action "get"
**Then** the value for the specified key is returned (FR76)

**Given** a lookup table name and key
**When** `iris_lookup_manage` is called with action "delete"
**Then** the lookup table entry is removed (FR76)

**Given** a lookup table name and format "xml"
**When** `iris_lookup_transfer` is called with action "export"
**Then** the lookup table is exported in XML format (FR77)

**Given** XML content containing a lookup table
**When** `iris_lookup_transfer` is called with action "import"
**Then** the lookup table is imported from the XML (FR77)

**And** credential passwords are never included in list responses or log output (NFR6)
**And** iris_credential_manage and iris_lookup_manage are annotated as destructiveHint: true
**And** iris_credential_list is annotated as readOnlyHint: true

### Story 5.6: Rules, Transforms & REST API Tools

As an integration engineer,
I want to view business rules, test data transformations, and manage REST APIs through MCP tools,
So that I can inspect and validate integration logic without the Management Portal.

**Acceptance Criteria:**

**Given** a namespace
**When** `iris_rule_list` is called
**Then** all business rule classes in the namespace are returned (FR78)

**Given** a rule class name
**When** `iris_rule_get` is called
**Then** the rule definition is returned including conditions, actions, and routing logic (FR78)

**Given** a namespace
**When** `iris_transform_list` is called
**Then** all data transformation classes in the namespace are returned (FR79)

**Given** a transform class name and sample input data
**When** `iris_transform_test` is called
**Then** the transformation is executed against the sample input and the output is returned (FR79)

**Given** an OpenAPI specification
**When** `iris_interop_rest` is called with action "create"
**Then** a REST application is created from the OpenAPI spec (FR80)

**Given** an existing REST application
**When** `iris_interop_rest` is called with action "delete"
**Then** the REST application is removed (FR80)

**Given** an existing REST application name
**When** `iris_interop_rest` is called with action "get"
**Then** the OpenAPI spec for the REST application is returned (FR80)

**And** iris_rule_list, iris_rule_get, iris_transform_list are annotated as readOnlyHint: true
**And** iris_transform_test is annotated as readOnlyHint: false (executes code)
**And** iris_interop_rest is annotated as destructiveHint: true (can delete)

### Story 5.7: iris-interop-mcp Unit & Integration Tests

As an integration engineer,
I want unit tests (mocked HTTP) and integration tests (real IRIS) for all interoperability tools,
So that I can verify parameter validation, response parsing, and end-to-end behavior.

**Acceptance Criteria:**

**Given** a local IRIS development instance with the ExecuteMCPv2 REST service deployed
**When** the integration test suite runs
**Then** iris_production_manage creates a test production and iris_production_status confirms it exists
**And** iris_production_control starts and stops the test production
**And** iris_production_item retrieves and updates config item settings
**And** iris_production_autostart gets and sets auto-start configuration
**And** iris_production_logs returns event log entries for the test production
**And** iris_production_queues returns queue status
**And** iris_production_adapters returns available adapter types
**And** iris_credential_manage creates a test credential and iris_credential_list confirms it exists
**And** iris_lookup_manage sets and gets a test lookup table entry
**And** iris_lookup_transfer exports and re-imports the test lookup table
**And** iris_rule_list returns business rule classes (if any exist in test namespace)
**And** iris_transform_list returns data transformation classes (if any exist in test namespace)

**And** unit tests (`__tests__/*.test.ts`) with mocked HTTP responses verify parameter validation, response parsing, and error handling for every interop tool
**And** integration test cleanup follows dependency order: stop production before deleting, remove credentials and lookups before production
**And** each test cleans up all created resources (productions, credentials, lookup entries) after execution
**And** integration tests are in `__tests__/*.integration.test.ts` files using Vitest

## Epic 6: Operations & Monitoring (iris-ops-mcp)

An operations engineer can monitor system health, manage scheduled tasks, inspect jobs/locks/journals/mirrors, query audit logs, check license and ECP status, and manage system configuration — all through AI-driven MCP tools.

### Story 6.1: iris-ops-mcp Package Setup & Server Entry Point

As an operations engineer,
I want the iris-ops-mcp package initialized and connected to the shared infrastructure,
So that I can start registering and using operations and monitoring tools.

**Acceptance Criteria:**

**Given** the @iris-mcp/shared package from Epic 1
**When** the iris-ops-mcp package is created
**Then** packages/iris-ops-mcp/ contains package.json with name @iris-mcp/ops and dependency on @iris-mcp/shared
**And** src/index.ts creates an McpServerBase instance and connects the configured transport
**And** src/tools/index.ts exports an empty ToolDefinition array
**And** tsconfig.json extends the base config with project reference to shared
**And** the server starts successfully and responds to `tools/list`
**And** `turbo build` builds without errors

### Story 6.2: System Metrics & Alerts Tools

As an operations engineer,
I want to retrieve system metrics, alerts, and interoperability performance data through MCP tools,
So that I can monitor IRIS health without dashboards or the Management Portal.

**Acceptance Criteria:**

**Given** a connected IRIS instance
**When** `iris_metrics_system` is called
**Then** system metrics are returned in Prometheus text exposition format (FR81)
**And** metrics include cache hit ratio, database size, process count, and other key indicators
**And** the tool has scope NONE

**Given** a connected IRIS instance
**When** `iris_metrics_alerts` is called
**Then** active system alerts are returned (FR82)
**And** each alert includes severity, category, message, and timestamp
**And** the tool has scope NONE

**Given** a connected IRIS instance
**When** `iris_metrics_interop` is called
**Then** interoperability volume and interface metrics are returned (FR83)
**And** metrics include message throughput, queue depths, and error rates by interface
**And** the tool has scope NONE

**And** the ExecuteMCPv2.REST.Monitor handler class is created and compiles on IRIS
**And** the Dispatch UrlMap is extended with /monitor/:entity route and Dispatch is recompiled
**And** all three tools are annotated as readOnlyHint: true
**And** unit tests with mocked HTTP responses verify parameter validation, response parsing, and error handling
**And** all tools respond within 2 seconds (NFR1)

### Story 6.3: Jobs & Locks Tools

As an operations engineer,
I want to list running IRIS jobs and system locks through MCP tools,
So that I can identify resource contention and long-running processes.

**Acceptance Criteria:**

**Given** a connected IRIS instance
**When** `iris_jobs_list` is called
**Then** all running IRIS jobs and processes are returned (FR84)
**And** each job includes process ID, routine, namespace, state, and start time
**And** the tool has scope NONE

**Given** a connected IRIS instance
**When** `iris_locks_list` is called
**Then** all current system locks are returned (FR85)
**And** each lock includes lock name, owner process ID, lock type, and lock count
**And** the tool has scope NONE

**And** both tools are annotated as readOnlyHint: true
**And** both tools respond within 2 seconds (NFR1)

### Story 6.4: Journal, Mirror & Audit Tools

As an operations engineer,
I want to check journal status, mirror health, and audit logs through MCP tools,
So that I can verify data protection and compliance without the Management Portal.

**Acceptance Criteria:**

**Given** a connected IRIS instance
**When** `iris_journal_info` is called
**Then** journal file information is returned including current journal file, directory, size, and available journal files (FR86)
**And** the tool executes in %SYS scope

**Given** a connected IRIS instance
**When** `iris_mirror_status` is called
**Then** mirror configuration, membership, and synchronization status are returned (FR87)
**And** the response includes member roles (primary/backup/async), sync status, and last sync time
**And** the tool executes in %SYS scope

**Given** optional filters (time range, user, event type)
**When** `iris_audit_events` is called
**Then** matching audit log events are returned (FR88)
**And** each event includes timestamp, user, event type, description, and source
**And** the tool executes in %SYS scope

**And** all three tools are annotated as readOnlyHint: true
**And** all tools respond within 2 seconds (NFR1)

### Story 6.5: Database, License & ECP Tools

As an operations engineer,
I want to check database integrity, license usage, and ECP connection status through MCP tools,
So that I can verify system health and capacity.

**Acceptance Criteria:**

**Given** a connected IRIS instance
**When** `iris_database_check` is called
**Then** database integrity status is returned for all databases or a specified database (FR89)
**And** the response includes last integrity check time and any reported issues
**And** the tool executes in %SYS scope

**Given** a connected IRIS instance
**When** `iris_license_info` is called
**Then** license usage and details are returned (FR90)
**And** the response includes license type, total capacity, current usage, and expiration date
**And** the tool has scope NONE

**Given** a connected IRIS instance
**When** `iris_ecp_status` is called
**Then** ECP client and server connection status is returned (FR91)
**And** the response includes connected data servers, application servers, and connection health
**And** the tool executes in %SYS scope

**And** all three tools are annotated as readOnlyHint: true

### Story 6.6: Task Scheduling Tools

As an operations engineer,
I want to create, manage, and execute scheduled tasks through MCP tools,
So that I can automate IRIS maintenance without the Management Portal.

**Acceptance Criteria:**

**Given** task details (name, class/routine to execute, schedule, namespace)
**When** `iris_task_manage` is called with action "create"
**Then** a new scheduled task is created on IRIS (FR92)

**Given** an existing task ID
**When** `iris_task_manage` is called with action "modify"
**Then** the task configuration is updated (FR92)

**Given** an existing task ID
**When** `iris_task_manage` is called with action "delete"
**Then** the scheduled task is removed (FR92)

**Given** no parameters or optional filters
**When** `iris_task_list` is called
**Then** all scheduled tasks are returned with their schedules, last run time, and next run time (FR93)

**Given** a task ID
**When** `iris_task_run` is called
**Then** the task is executed immediately regardless of its schedule (FR94)
**And** the response confirms execution was triggered

**Given** a task ID
**When** `iris_task_history` is called
**Then** the task execution history is returned including past run times, status (success/failure), and duration (FR95)

**And** the ExecuteMCPv2.REST.Task handler class is created and compiles on IRIS
**And** all tools execute in %SYS scope
**And** iris_task_manage is annotated as destructiveHint: true
**And** iris_task_list and iris_task_history are annotated as readOnlyHint: true
**And** iris_task_run is annotated as destructiveHint: false (triggers execution, doesn't delete)

### Story 6.7: System Configuration Tools

As an operations engineer,
I want to view and modify IRIS system configuration through MCP tools,
So that I can manage system settings without the Management Portal.

**Acceptance Criteria:**

**Given** a configuration section or parameter name
**When** `iris_config_manage` is called with action "get"
**Then** the current value of the specified system configuration parameter is returned (FR96)

**Given** a configuration parameter name and new value
**When** `iris_config_manage` is called with action "set"
**Then** the system configuration parameter is updated (FR96)

**Given** a request for startup configuration
**When** `iris_config_manage` is called with action "get" and section "startup"
**Then** the startup configuration is returned (FR97)

**Given** a request for startup configuration changes
**When** `iris_config_manage` is called with action "set" and section "startup"
**Then** the startup configuration is updated (FR97)

**Given** a request for NLS/locale configuration
**When** `iris_config_manage` is called with action "get" and section "locale"
**Then** the NLS/locale configuration is returned (FR98)

**Given** no parameters
**When** `iris_config_manage` is called with action "export"
**Then** the complete system configuration is exported (FR99)

**And** the ExecuteMCPv2.REST.SystemConfig handler class is created and compiles on IRIS
**And** the tool executes in %SYS scope
**And** iris_config_manage with action "get" and "export" is annotated as readOnlyHint: true
**And** iris_config_manage with action "set" is annotated as destructiveHint: true (modifying system config is high-impact)
**And** inputs are validated at the REST boundary (NFR10)

### Story 6.8: iris-ops-mcp Unit & Integration Tests

As an operations engineer,
I want unit tests (mocked HTTP) and integration tests (real IRIS) for all operations and monitoring tools,
So that I can verify parameter validation, response parsing, and end-to-end behavior.

**Acceptance Criteria:**

**Given** a local IRIS development instance with the ExecuteMCPv2 REST service deployed
**When** the integration test suite runs
**Then** iris_metrics_system returns Prometheus-format metrics
**And** iris_metrics_alerts returns alerts (possibly empty if no active alerts)
**And** iris_metrics_interop returns interoperability metrics
**And** iris_jobs_list returns running jobs
**And** iris_locks_list returns current locks (possibly empty)
**And** iris_journal_info returns journal file information
**And** iris_mirror_status returns mirror configuration (or indicates mirroring is not configured)
**And** iris_audit_events returns audit events for a recent time range
**And** iris_database_check returns integrity status
**And** iris_license_info returns license details
**And** iris_ecp_status returns ECP status (or indicates ECP is not configured)
**And** iris_task_manage creates a test task and iris_task_list confirms it exists
**And** iris_task_run triggers the test task and iris_task_history shows the execution
**And** iris_config_manage retrieves a known system configuration parameter

**And** unit tests (`__tests__/*.test.ts`) with mocked HTTP responses verify parameter validation, response parsing, and error handling for every ops tool
**And** each integration test cleans up any created resources (test tasks) after execution
**And** integration tests do not modify system configuration parameters (read-only testing for config)
**And** integration tests are in `__tests__/*.integration.test.ts` files using Vitest

## Epic 7: Data & Analytics (iris-data-mcp)

A data engineer or analyst can create and query document databases, manage documents and indexes, execute MDX queries on DeepSee cubes, and manage REST APIs — through MCP tools.

### Story 7.1: iris-data-mcp Package Setup & Server Entry Point

As a data engineer,
I want the iris-data-mcp package initialized and connected to the shared infrastructure,
So that I can start registering and using data and analytics tools.

**Acceptance Criteria:**

**Given** the @iris-mcp/shared package from Epic 1
**When** the iris-data-mcp package is created
**Then** packages/iris-data-mcp/ contains package.json with name @iris-mcp/data and dependency on @iris-mcp/shared
**And** src/index.ts creates an McpServerBase instance and connects the configured transport
**And** src/tools/index.ts exports an empty ToolDefinition array
**And** tsconfig.json extends the base config with project reference to shared
**And** the server starts successfully and responds to `tools/list`
**And** `turbo build` builds without errors

### Story 7.2: Document Database Tools

As a data engineer,
I want to create document databases, manage documents, and query collections through MCP tools,
So that I can work with IRIS document storage without writing SQL or using the Management Portal.

**Acceptance Criteria:**

**Given** a database name and optional property definitions
**When** `iris_docdb_manage` is called with action "create"
**Then** a new document database is created in the specified namespace (FR100)

**Given** an existing document database name
**When** `iris_docdb_manage` is called with action "drop"
**Then** the document database is dropped (FR100)

**Given** a document database name and document content (JSON)
**When** `iris_docdb_document` is called with action "insert"
**Then** a new document is inserted and its generated ID is returned (FR101)

**Given** a document database name and document ID
**When** `iris_docdb_document` is called with action "get"
**Then** the document content is retrieved by ID (FR101)

**Given** a document database name, document ID, and updated content
**When** `iris_docdb_document` is called with action "update"
**Then** the document is updated (FR101)

**Given** a document database name and document ID
**When** `iris_docdb_document` is called with action "delete"
**Then** the document is deleted (FR101)

**Given** a document database name and filter criteria (JSON query)
**When** `iris_docdb_find` is called
**Then** matching documents are returned based on the filter (FR102)
**And** filter supports comparison operators ($eq, $lt, $gt, $ne, etc.)

**Given** a document database name and property definition (name, type)
**When** `iris_docdb_property` is called with action "create"
**Then** a new property is defined on the document database (FR103)

**Given** a document database name and property name
**When** `iris_docdb_property` is called with action "drop"
**Then** the property is removed (FR103)

**Given** a document database name and property name
**When** `iris_docdb_property` is called with action "index"
**Then** an index is created on the specified property (FR103)

**And** iris_docdb_manage is annotated as destructiveHint: true (can drop databases)
**And** iris_docdb_document with action "delete" is annotated as destructiveHint: true
**And** iris_docdb_find is annotated as readOnlyHint: true
**And** all tools have scope NS
**And** all inputs are validated at the REST boundary (NFR10)

### Story 7.3: Analytics Tools

As an analyst,
I want to execute MDX queries and manage DeepSee cubes through MCP tools,
So that I can run analytics and maintain BI infrastructure without the Management Portal.

**Acceptance Criteria:**

**Given** an MDX query string and a namespace
**When** `iris_analytics_mdx` is called
**Then** the MDX query is executed against the specified DeepSee cube and results are returned as a structured pivot table (FR104)
**And** the response includes axis labels, measure values, and dimension members

**Given** an invalid MDX query
**When** `iris_analytics_mdx` is called
**Then** an MCP tool error is returned with the MDX error message

**Given** a namespace
**When** `iris_analytics_cubes` is called with action "list"
**Then** all available DeepSee cubes in the namespace are returned (FR105)
**And** each cube includes its name, source class, last build time, and record count

**Given** a cube name
**When** `iris_analytics_cubes` is called with action "build"
**Then** a full cube rebuild is triggered (FR105)

**Given** a cube name
**When** `iris_analytics_cubes` is called with action "sync"
**Then** an incremental cube synchronization is triggered (FR105)

**And** the ExecuteMCPv2.REST.Analytics handler class is created and compiles on IRIS
**And** iris_analytics_mdx is annotated as readOnlyHint: true
**And** iris_analytics_cubes with action "list" is annotated as readOnlyHint: true
**And** iris_analytics_cubes with action "build"/"sync" is annotated as destructiveHint: false (rebuilds data, doesn't delete)
**And** all tools have scope NS
**And** MDX queries respond within 5 seconds for typical cube sizes (NFR1)

### Story 7.4: REST API Management & Debug Placeholders

As a data engineer,
I want to view and manage REST API dispatch classes on IRIS and have placeholder tools for future debugging capabilities,
So that I can inspect REST services and know that debug features are planned for a future release.

**Acceptance Criteria:**

**Given** a namespace
**When** `iris_rest_manage` is called with action "list"
**Then** available REST API dispatch classes and their URL maps in the namespace are returned

**Given** a REST application name
**When** `iris_rest_manage` is called with action "get"
**Then** the REST application details (dispatch class, URL map, routes) are returned

**Given** an existing REST application
**When** `iris_rest_manage` is called with action "delete"
**Then** the REST application is removed

**Note:** Creating REST applications from OpenAPI specs is handled by `iris_interop_rest` (FR80) in iris-interop-mcp, not this tool. `iris_rest_manage` provides REST API viewing and management from the data/management perspective via the Management API.

**Given** a client that lists tools
**When** `tools/list` is called on iris-data-mcp
**Then** iris_debug_session and iris_debug_terminal are NOT listed (deferred to post-MVP, FR106-FR107)
**And** the debug.ts tool file exists as a placeholder with a code comment indicating these tools are deferred to post-MVP and will require WebSocket transport

**And** iris_rest_manage is annotated as destructiveHint: true (can delete)
**And** the tool has scope NS

### Story 7.5: iris-data-mcp Unit & Integration Tests

As a data engineer,
I want unit tests (mocked HTTP) and integration tests (real IRIS) for all data and analytics tools,
So that I can verify parameter validation, response parsing, and end-to-end behavior.

**Acceptance Criteria:**

**Given** a local IRIS development instance with the ExecuteMCPv2 REST service deployed
**When** the integration test suite runs
**Then** iris_docdb_manage creates a test document database
**And** iris_docdb_property creates a property and an index on the test database
**And** iris_docdb_document inserts a test document and retrieves it by ID
**And** iris_docdb_document updates the test document and confirms the update
**And** iris_docdb_find queries the test database with a filter and returns matching documents
**And** iris_docdb_document deletes the test document and confirms deletion
**And** iris_docdb_manage drops the test database
**And** iris_analytics_cubes lists available cubes (may be empty if no cubes configured)
**And** iris_analytics_mdx executes a simple MDX query against a cube (if cubes exist, otherwise verifies error handling)
**And** iris_rest_manage lists REST applications in the namespace

**And** unit tests (`__tests__/*.test.ts`) with mocked HTTP responses verify parameter validation, response parsing, and error handling for every data tool
**And** integration test cleanup follows dependency order: delete documents before dropping properties/indexes, drop database last
**And** each test cleans up all created resources (test databases, documents) after execution
**And** integration tests are in `__tests__/*.integration.test.ts` files using Vitest

## Epic 8: Documentation & Release Preparation

Users can find comprehensive documentation — suite-level README, per-package tool references, v1-to-v2 migration guide, and MCP client config examples — enabling self-service installation and adoption.

### Story 8.1: Suite-Level README & Architecture Overview

As a potential user,
I want a clear README that explains what IRIS MCP v2 is, which servers to install, and how to get started,
So that I can quickly understand the project and begin using it.

**Acceptance Criteria:**

**Given** the root of the repository
**When** a user views README.md
**Then** the README includes an overview of the 5-server suite architecture and the problem it solves
**And** a table listing all 5 servers with their domain, tool count, and package name
**And** guidance on which server(s) to install based on user role (developer, admin, integration engineer, ops, data)
**And** a quick-start section showing installation and MCP client configuration for the most common setup (iris-dev-mcp)
**And** a link to each per-package README for detailed tool references
**And** a note about the @iris-mcp/all meta-package for installing everything
**And** prerequisites listed: Node.js 18+, IRIS 2023.1+, web port access

### Story 8.2: Per-Package READMEs & Tool References

As a user of a specific MCP server,
I want detailed documentation for that server including every tool with parameters and examples,
So that I can understand and configure the tools available to me.

**Acceptance Criteria:**

**Given** each of the 5 server packages (dev, admin, interop, ops, data)
**When** a user views the package README.md
**Then** the README includes installation instructions (`npm install -g @iris-mcp/dev`)
**And** environment variable configuration (IRIS_HOST, IRIS_PORT, IRIS_USERNAME, IRIS_PASSWORD, IRIS_NAMESPACE, IRIS_HTTPS)
**And** a complete tool reference table listing every tool with: name, description, key parameters, and annotations
**And** at least one JSON example per tool showing input and expected output
**And** MCP client configuration snippets for Claude Desktop, Claude Code, and Cursor
**And** information about namespace scoping (which tools accept namespace parameter)
**And** error handling guidance (common errors and how to resolve them)

**Given** the @iris-mcp/shared package
**When** a developer views its README.md
**Then** the README documents the public API: IrisHttpClient, config types, error classes, McpServerBase
**And** it is clearly marked as an internal dependency (not installed directly by end users)

### Story 8.3: Migration Guide (v1 to v2)

As an existing v1 user,
I want a migration guide showing how to move from iris-execute-mcp and mcp-server-iris to v2,
So that I can upgrade without losing functionality.

**Acceptance Criteria:**

**Given** the docs/ directory
**When** a v1 user views docs/migration-v1-v2.md
**Then** a complete tool mapping table shows every v1 tool and its v2 equivalent (e.g., execute_command → iris_execute_command in iris-dev-mcp)
**And** breaking changes are clearly listed: connection change (SuperServer port 1972 → web port 52773), Python → Node.js, tool name changes
**And** configuration migration steps show how to update MCP client config from v1 to v2
**And** a note about the namespace parameter behavior being preserved
**And** guidance on uninstalling v1 packages

### Story 8.4: MCP Client Configuration Examples

As a user setting up their AI coding assistant,
I want copy-paste configuration snippets for my specific MCP client,
So that I can connect to IRIS MCP v2 without guessing the configuration format.

**Acceptance Criteria:**

**Given** the docs/client-config/ directory
**When** a Claude Desktop user views docs/client-config/claude-desktop.md
**Then** a complete JSON configuration snippet is provided for adding each server to Claude Desktop's MCP config
**And** the snippet includes all required fields (command, args, env)

**Given** a Claude Code user
**When** they view docs/client-config/claude-code.md
**Then** a complete configuration snippet is provided for Claude Code's MCP settings
**And** instructions cover both CLI and VS Code extension configuration

**Given** a Cursor user
**When** they view docs/client-config/cursor.md
**Then** a complete configuration snippet is provided for Cursor's MCP settings

**And** each config example shows how to configure a single server and how to configure all five
**And** each example documents the environment variables and how to set them

### Story 8.5: Tool Annotation Audit & Cross-Server Validation

As a developer,
I want a systematic validation that all 86 tools have correct and consistent annotations,
So that MCP clients can make accurate safety decisions based on tool metadata (NFR9).

**Acceptance Criteria:**

**Given** all 86 tools across 5 servers
**When** an annotation audit is performed
**Then** every `*.manage` tool with delete action is annotated as destructiveHint: true
**And** every `*.list`, `*.get`, `*.status`, `*.info` tool is annotated as readOnlyHint: true
**And** every tool has all four annotation fields set (readOnlyHint, destructiveHint, idempotentHint, openWorldHint)
**And** no tool has contradictory annotations (e.g., readOnlyHint: true AND destructiveHint: true)
**And** annotation patterns are consistent across servers (same action verbs → same annotations)
**And** the audit results are documented and any discrepancies are corrected

### Story 8.6: Meta-Package (@iris-mcp/all)

As a user who wants all five servers,
I want a single package that installs everything,
So that I don't have to install and configure five packages individually.

**Acceptance Criteria:**

**Given** the iris-mcp-all package
**When** a user runs `npm install -g @iris-mcp/all`
**Then** all five server packages (@iris-mcp/dev, @iris-mcp/admin, @iris-mcp/interop, @iris-mcp/ops, @iris-mcp/data) are installed as dependencies

**Given** the iris-mcp-all package.json
**When** a developer inspects it
**Then** it lists all five servers as dependencies with synchronized version numbers
**And** the package has no source code of its own (pure meta-package)

**Given** the iris-mcp-all README
**When** a user views it
**Then** it explains the meta-package purpose and links to individual server documentation
**And** it shows MCP client configuration for running all five servers

## Epic 9: Tool Name Flattening for Anthropic API / Claude Desktop Compatibility

During beta testing prior to first npm publish, a user attempting to install the IRIS MCP v2 suite in Claude Desktop received *"tool name not valid"* errors. Research confirmed the root cause: the MCP specification permits dots in tool names (`^[a-zA-Z0-9._-]{1,128}$`), but the Anthropic Messages API `tools[].name` field uses a stricter regex (`^[a-zA-Z0-9_-]+$`) that rejects dots. Claude Desktop routes tool registrations through the Anthropic Messages API and rejects them at registration time. Claude Code silently rewrites dots to underscores in its `mcp__{server}__{tool}` prefix, which is why the defect was invisible during the development of Epics 1–8.

The epic flattens all 85 tool names from `iris.<domain>.<verb>` to `iris_<domain>_<verb>`, updates package READMEs and test suites to match, adds a regression-guard unit test that prevents the pattern from ever returning, creates a root CHANGELOG documenting the pre-release breaking change, and performs a live Claude Desktop smoke test to confirm the fix before npm publish.

**Scope:** Mechanical rename across `packages/*/src/tools/` and test files, regeneration of 5 package READMEs, new `tool-naming.test.ts` regression guard, `CHANGELOG.md` creation, clone-install banner update, and a live Claude Desktop compatibility smoke test.

**Out of scope:**
- Historical planning snapshots (product brief, implementation-readiness report, 2026-04-06 sprint-change-proposal, prior epic retrospectives) — frozen as point-in-time records
- Living planning artifacts (`architecture.md`, `prd.md`, `epics.md`) — **already updated by the analyst on 2026-04-09** as part of the Sprint Change Proposal, including a new "Tool Naming Convention" subsection in architecture.md
- Any tool capability or signature change
- Any rename beyond the dot-strip character swap (no server-scoping, no hyphens)

**Driving document:** [`sprint-change-proposal-2026-04-09.md`](sprint-change-proposal-2026-04-09.md)

### Story 9.1: Rename Tool Identifiers in Source and Tests

As a user of Claude Desktop or any MCP client that routes through the Anthropic Messages API,
I want all IRIS MCP v2 tool names to match `^[a-z0-9_]+$`,
So that the suite registers successfully without "tool name not valid" errors.

**Acceptance Criteria:**

**Given** all 36 tool definition files under `packages/*/src/tools/`
**When** a developer searches for the pattern `name:\s*"iris\.`
**Then** zero matches are returned
**And** all 85 tool definitions use the pattern `name: "iris_<domain>_<verb>"` with only lowercase ASCII letters, digits, and underscores

**Given** the iris-dev-mcp, iris-admin-mcp, iris-interop-mcp, iris-ops-mcp, and iris-data-mcp packages
**When** each package is built (`npm run build`)
**Then** TypeScript compilation succeeds with no errors
**And** each server's `tools/list` returns the expected count with the new flat names when connected via an MCP client

**Given** all test files under `packages/**/__tests__/**/*.test.ts`
**When** a developer searches for the pattern `iris\.[a-z]+\.[a-z]+` (excluding ObjectScript class/file references like `MyClass.cls`)
**Then** zero matches are returned
**And** all test assertions, mock fixtures, and `describe`/`it` block descriptions reference the new flat tool names

**Given** the full test suite
**When** `npm test` is run across the monorepo
**Then** all unit tests pass
**And** all integration tests pass
**And** no test was skipped or disabled to achieve this

**Given** the transformation is mechanical
**When** the pattern `iris\.([a-z_]+)\.([a-z_]+)` is replaced by `iris_$1_$2`
**Then** each of the 85 original tool names maps to exactly one new name with no collisions
**And** tool names remain unique across all 5 server packages

### Story 9.2: Documentation, CHANGELOG, and Regression Guard

As a developer maintaining the IRIS MCP v2 suite,
I want the package READMEs, CHANGELOG, and a regression-guard test to reflect the flat tool naming convention,
So that documentation is accurate and the dot-notation defect can never silently return.

**Acceptance Criteria:**

**Given** the 5 package README files (`packages/iris-dev-mcp/README.md`, `packages/iris-admin-mcp/README.md`, `packages/iris-interop-mcp/README.md`, `packages/iris-ops-mcp/README.md`, `packages/iris-data-mcp/README.md`)
**When** a developer searches each README for the pattern `iris\.[a-z]+\.[a-z]+`
**Then** zero matches are returned
**And** all tool tables, usage examples, and inline references use the flat underscore naming
**And** narrative content (installation, env vars, annotations descriptions) is unchanged except for the tool-name strings

**Given** the `packages/shared/src/__tests__/` directory
**When** a developer inspects the test file list
**Then** a new file `tool-naming.test.ts` exists
**And** the test iterates every tool registered across all 5 server packages
**And** the test asserts every `tool.name` matches `/^[a-z0-9_]{1,64}$/`
**And** the test asserts tool names are unique across the suite (no collisions)
**And** the test passes when run via `npm test`

**Given** the repository root
**When** a developer inspects the file list
**Then** a new `CHANGELOG.md` file exists
**And** its first entry documents the pre-release breaking change with the header "[Pre-release breaking change — 2026-04-09]"
**And** the entry explains the rename (`iris.doc.get` → `iris_doc_get`), the reason (Anthropic API / Claude Desktop compatibility), and the audience impact (Claude Desktop beta users affected, Claude Code users unaffected)

**Given** the root `README.md` pre-release banner
**When** a clone-install beta user reads it after pulling the latest
**Then** the banner includes a one-line note pointing at `CHANGELOG.md` for the breaking change

**Given** the bootstrap generator (`npm run gen:bootstrap`)
**When** the developer runs the generator after stories 9.1 and 9.2 are complete
**Then** the generator produces a diff on `packages/shared/src/bootstrap-classes.ts` that is either empty or contains only changes the developer understands and intends
**And** any non-empty diff is committed as part of Story 9.2

### Story 9.3: Pre-Publish Smoke Test and Beta-User Notification

As a release engineer,
I want a live Claude Desktop installation smoke test and a beta-user notification,
So that the first npm publish ships a suite that is verified to work on the platform that surfaced the original defect.

**Acceptance Criteria:**

**Given** a clean Claude Desktop installation with no prior IRIS MCP configuration
**When** a tester configures Claude Desktop with the iris-dev-mcp server using the config snippet from `docs/client-config/claude-desktop.md`
**And** restarts Claude Desktop
**Then** Claude Desktop loads the server without any "tool name not valid" errors
**And** all 20 iris-dev-mcp tools appear in Claude Desktop's tool list
**And** at least 3 tools can be invoked successfully end-to-end against a live IRIS instance (e.g., `iris_server_info`, `iris_doc_list`, `iris_sql_execute`)

**Given** the same Claude Desktop instance
**When** the tester configures it with all 5 servers (dev, admin, interop, ops, data)
**And** restarts Claude Desktop
**Then** all 5 servers load without errors
**And** the full tool count is visible (85 tools total)

**Given** the beta user who reported the original defect
**When** the tester (or the developer) notifies them that Epic 9 is complete
**Then** the notification points at the relevant CHANGELOG entry
**And** the notification explains that cloning the latest main branch and restarting Claude Desktop should resolve the error

**Given** the full monorepo test suite including the new `tool-naming.test.ts` regression guard
**When** the developer runs `npm test` from the repository root
**Then** all tests pass
**And** the new regression guard test is included in the run

**Given** all success criteria from this epic are met
**When** the developer confirms readiness for first npm publish
**Then** no Epic 9 work items remain open in `sprint-status.yaml`
**And** the path to `npm publish` for each package is unblocked

---

## Epic 10: Namespace Browsing and Bulk Export Tools (iris-dev-mcp)

**Goal**: Let AI clients survey a namespace at package granularity and pull code to disk in bulk, without paging through every document or falling back to raw SQL.

**Scope**: Two new tools in `@iris-mcp/dev`, one doc/rollup story. Both tools use only the Atelier REST API — no new `ExecuteMCPv2.*` classes, so the IRIS-side `BOOTSTRAP_VERSION` is unchanged and existing installs upgrade via `pnpm install && pnpm turbo run build` plus an MCP server restart.

**Functional Requirements (new)**:
- **FR-NEW-1** (package listing): Developer can enumerate the packages in a namespace at a configurable depth (1 = top-level, 2 = two-segment, etc.), optionally narrowed to a prefix, with the same filter surface as `iris_doc_list` (category, type, generated, modifiedSince, system inclusion).
- **FR-NEW-2** (bulk export): Developer can download the content of every document matching a filter (prefix, category, type, generated, modifiedSince) to a local directory, with an optional manifest of written files and error-tolerance controls.

**Stories**:
- 10.1 `iris_package_list` — package listing with depth + prefix
- 10.2 `iris_doc_export` — bulk download to disk
- 10.3 Documentation rollup (README suite + per-package + tool_support.md + CHANGELOG)

**Out of scope (deferred)**:
- Round-trip diffing (download → local edit → upload) — handled separately by existing `iris_doc_load` + editor tools.
- Incremental sync / snapshot manifests — deferred to a post-Epic-10 enhancement if demand materializes.

### Story 10.1: `iris_package_list` — Package Listing with Depth + Prefix

**As an** AI client or developer exploring an unfamiliar namespace,
**I want** to list the packages present at a chosen depth with the same filtering surface as `iris_doc_list`,
**so that** I can answer "what's in this namespace?" in one round trip without paginating every document or running raw SQL against `%Dictionary.ClassDefinition`.

**Acceptance Criteria**:

- **AC 10.1.1** — Tool registered as `iris_package_list` in `@iris-mcp/dev`. Flat underscore name per Epic 9 convention. Annotations: `readOnlyHint: true`, `idempotentHint: true`.
- **AC 10.1.2** — Input schema:
  - `depth` (number, optional, default 1) — how many dotted segments to roll up at. `1` = top-level packages, `3` = `Foo.Bar.Baz` rollup.
  - `prefix` (string, optional) — narrow to packages starting with this prefix (e.g., `"EnsLib"`). When combined with `depth`, returns sub-packages at `prefix.*...` up to `depth` segments past the prefix.
  - `category` (enum `CLS | RTN | CSP | OTH | *`, optional, default `*`) — same semantics as `iris_doc_list`.
  - `type` (string, optional) — file extension filter (`cls`, `mac`, `inc`, etc.).
  - `generated` (boolean, optional, default false) — include generated documents.
  - `system` (enum `true | false | only`, optional, default `false`) — controls whether IRIS system packages (`%*`) appear in the rollup:
      - `false` (default) — exclude system packages; only user/project code is counted
      - `true` — include both user/project and system packages
      - `only` — return system packages only (useful for inspecting what's available in `IRISLIB`, `HSLIB`, etc.)
    The filter is applied to the first dotted segment of each document name: a package starts with `%` → system.
  - `modifiedSince` (ISO 8601 string, optional) — when provided, only documents modified since this timestamp contribute to the rollup.
  - `namespace` (string, optional) — per-call namespace override.
- **AC 10.1.3** — Output shape:
  ```json
  {
    "packages": [
      { "name": "EnsLib", "docCount": 1322, "depth": 1 },
      { "name": "Ens",    "docCount":  450, "depth": 1 }
    ],
    "count": 79,
    "namespace": "USER",
    "depth": 1,
    "prefix": null,
    "totalDocs": 6552
  }
  ```
  `docCount` is the number of documents rolled up under that package entry; `totalDocs` is the grand total of documents scanned (before rollup). Rows sorted by `docCount` desc, then `name` asc.
- **AC 10.1.4** — Implementation walks the Atelier `docnames` endpoint using the existing paginated `IrisHttpClient` shape and aggregates client-side. No new IRIS-side endpoint. Pagination follows the same cursor pattern as `iris_doc_list`.
- **AC 10.1.5** — Unit tests in `packages/iris-dev-mcp/src/__tests__/packages.test.ts` cover: default (depth 1, no filters), depth 2 with prefix, system filter `false` / `true` / `only`, modifiedSince propagation, empty namespace, and the category/type combinations already in `list.test.ts`.
- **AC 10.1.6** — Tool description explicitly contrasts with `iris_doc_list` so AI clients pick the right tool: "Use `iris_package_list` when you want a structural overview; `iris_doc_list` when you want individual document names."
- **AC 10.1.7** — When the rollup would return more than 1000 package rows (rare but possible at very high depth), the response is capped and a `truncated: true` flag is returned alongside `limit: 1000`.

**Implementation Notes**:
- Location: new `packages/iris-dev-mcp/src/tools/packages.ts`. Register in `packages/iris-dev-mcp/src/tools/index.ts`.
- Reuses the `IrisHttpClient` in `@iris-mcp/shared` — no new transport code.
- The depth rollup uses `name.split(".").slice(0, depth).join(".")` keyed into a `Map<string, number>` for the count.
- `system: false` is the default because most AI-client questions are about user/project code, not IRIS internals — matches the intent of the `generated: false` default in `iris_doc_list`.

### Story 10.2: `iris_doc_export` — Bulk Download of Documents to Local Files

**As an** AI client or developer who needs a local working copy of IRIS code,
**I want** to download every document matching a filter to a local directory,
**so that** I can read, grep, diff, or version-control IRIS-side code without round-tripping each file through `iris_doc_get`.

**Acceptance Criteria**:

- **AC 10.2.1** — Tool registered as `iris_doc_export` in `@iris-mcp/dev`. Annotations: `readOnlyHint: false` (writes to local disk), `destructiveHint: false` (does not delete local files it didn't create), `idempotentHint: true` (re-running with same args overwrites files with the same content), `openWorldHint: false`.
- **AC 10.2.2** — Input schema (mirrors `iris_doc_list` filtering surface, inverts `iris_doc_load`'s destination):
  - `destinationDir` (string, **required**) — absolute local directory to write files into. Created if it doesn't exist.
  - `prefix` (string, optional) — narrow to documents whose name starts with this value (e.g., `"EnsLib"`, `"MyApp.Services"`). Empty/omitted means all matching documents in the namespace.
  - `category` (enum `CLS | RTN | CSP | OTH | *`, optional, default `*`).
  - `type` (string, optional) — file extension filter (e.g., `cls`, `inc`, `mac`, `int`).
  - `generated` (enum `true | false | both`, optional, default `false`) — `false` = source only, `true` = generated only, `both` = everything.
  - `system` (enum `true | false | only`, optional, default `false`) — same semantics as `iris_package_list`.
  - `modifiedSince` (ISO 8601 string, optional) — only export documents modified since this timestamp.
  - `namespace` (string, optional) — per-call namespace override.
  - `includeManifest` (boolean, optional, default `true`) — when true, write a `manifest.json` in `destinationDir` listing everything downloaded plus any skipped items with reasons.
  - `ignoreErrors` (boolean, optional, default `true`) — when true, per-document failures (long path, disk-full, encoding issues) are logged into the result and the batch continues. When false, the first error aborts the run.
  - `useShortPaths` (boolean, optional, default `false`) — on Windows, map each package segment to its first 8 characters to stay under MAX_PATH. Ignored on non-Windows. When used, the manifest records the mapping so the files can be round-tripped back to their full doc names on upload.
  - `overwrite` (enum `never | ifDifferent | always`, optional, default `ifDifferent`) — skip existing files when the content matches (fast re-sync), always overwrite, or never overwrite (refuse and note in skipped list).
  - `continueDownloadOnTimeout` (boolean, optional, default `true`) — when true, the download loop ignores the MCP request's cancellation/abort signal and runs to completion. Already-written files stay on disk; the manifest is written at the end. When false, cancellation aborts immediately and the tool returns `{ isError: true, partial: true }` with whatever had been exported. Useful when the client times out waiting for the response but you still want the download to finish on disk.
- **AC 10.2.3** — Path mapping: dots-as-directories. `EnsLib.HTTP.GenericService.cls` → `<destinationDir>/EnsLib/HTTP/GenericService.cls`. The helper comes from the shared dev-mcp module alongside `filePathToDocName` / `extractBaseDir` (extract the inverse function during this story so `iris_doc_load` and `iris_doc_export` stay in lockstep).
- **AC 10.2.4** — Output shape:
  ```json
  {
    "destinationDir": "C:/dev/iris-export",
    "namespace": "USER",
    "filtersApplied": { "prefix": "EnsLib", "category": "CLS", "system": false, "generated": "false" },
    "total": 1322,
    "exported": 1319,
    "skipped": 3,
    "skippedItems": [
      {
        "docName": "EnsLib.Some.Deeply.Nested.Package.ReallyLongClassName.cls",
        "reason": "ENAMETOOLONG: local path exceeds 260 characters on Windows",
        "hint": "Rerun with useShortPaths: true, or enable Windows long-path support in the registry (LongPathsEnabled)."
      }
    ],
    "manifest": "C:/dev/iris-export/manifest.json",
    "durationMs": 18432
  }
  ```
  When `ignoreErrors: false` and a failure occurs, the tool returns `isError: true` with the first failure's details and a `partial: true` flag — files already written are left on disk.
- **AC 10.2.5** — `manifest.json` shape (when `includeManifest: true`):
  ```json
  {
    "namespace": "USER",
    "exportedAt": "2026-04-20T14:22:09Z",
    "filtersApplied": { "prefix": "EnsLib", "category": "CLS" },
    "files": [
      { "docName": "EnsLib.HTTP.GenericService.cls", "localPath": "EnsLib/HTTP/GenericService.cls", "bytes": 14582, "modifiedOnServer": "2025-06-04T18:37:28Z" }
    ],
    "skipped": [ /* same shape as in AC 10.2.4 */ ],
    "shortPathMap": null
  }
  ```
  When `useShortPaths: true`, `shortPathMap` is `{ "EnsLib/HTTP/GenericService.cls": "EnsLib/HTTP/GenericSe.cls" }` (original → shortened) so `iris_doc_load` can reconstruct the real doc name on re-upload.
- **AC 10.2.6** — Implementation uses Atelier `GET /docnames` to enumerate (same machinery as `iris_doc_list`) and `GET /doc/{name}` per file for content. Parallelism: fetch up to 4 documents concurrently with a bounded promise queue — streaming per-file writes to disk, no in-memory buffering of the whole batch.
- **AC 10.2.7** — When the resolved filter matches zero documents, the tool returns a successful empty result (`total: 0, exported: 0`) with no manifest written. Not an error.
- **AC 10.2.8** — Unit tests in `packages/iris-dev-mcp/src/__tests__/export.test.ts` cover: small batch success, large batch pagination, `ignoreErrors` true vs false on injected failure, `overwrite: ifDifferent` skip path, `useShortPaths` mapping, manifest structure, and path traversal safety (reject `..` in `destinationDir` or mapped paths).
- **AC 10.2.9** — Progress and cancellation:
  - While the export loop runs, the tool emits MCP `notifications/progress` messages with `progress: exported, total: <total>` at least every **50 files or 2 seconds**, whichever comes first. Clients that honor progress notifications keep the connection alive and show the running count.
  - Cancellation semantics depend on `continueDownloadOnTimeout`:
    - `true` (default) — detach the download from the request's `AbortSignal`. Cancellation does not stop the loop. The tool's eventual return is still sent (best-effort — client may have closed the stream). The manifest at `destinationDir/manifest.json` is the authoritative record of what completed.
    - `false` — honor the `AbortSignal`. Stop the current in-flight `iris_doc_get`, finalize the partial manifest (with `"aborted": true`), return `isError: true, partial: true`.
  - In both modes, a final `manifest.json` is written even on cancellation/error so the caller can recover and resume (`overwrite: ifDifferent` makes re-running cheap).

**Implementation Notes**:
- Location: new `packages/iris-dev-mcp/src/tools/export.ts`. Register in `packages/iris-dev-mcp/src/tools/index.ts`.
- Extracts a shared `docNameToFilePath(docName, basePath, { useShortPaths })` helper — inverse of `filePathToDocName` in `load.ts`. Both helpers live in one spot so the round-trip stays symmetric.
- **Security**: `destinationDir` must be validated — reject if the resolved absolute path contains `..` segments after normalization, or if a mapped doc name (via `useShortPaths`) would write outside `destinationDir`. Mirror the defensive approach in existing `iris_doc_load`.
- **Windows long-path hint**: only emit when `process.platform === "win32"` and the error is `ENAMETOOLONG` or path length exceeds 260.
- **Cancellation detachment**: when `continueDownloadOnTimeout: true`, the handler spawns the download loop with a *new* `AbortController` it owns, rather than passing the request's `ctx.signal` down to `fetch`. This decouples the loop's lifecycle from the request's. The handler still returns a response promise so clients that *are* still listening get the summary; clients that gave up get nothing, but the disk state is correct.
- **Progress emission**: use the MCP SDK's `ctx.sendProgress?.({ progress, total })` helper if available (check `@modelcontextprotocol/sdk` version in `packages/shared`). If the SDK doesn't expose a progress helper, wrap the transport call the same way existing tools batch output. Keep progress calls cheap — don't `JSON.stringify` the full manifest on each tick.
- **Manifest safety on interruption**: write `manifest.json` with a temp name (`.manifest.json.tmp`) during the loop, rename to `manifest.json` on success. If a prior interrupted run left `manifest.json.tmp`, the next `iris_doc_export` invocation can read it to understand what finished and skip via `overwrite: ifDifferent`.

### Story 10.3: Documentation Rollup — README Suite + Per-Package + tool_support.md + CHANGELOG

**As a** user evaluating or upgrading the IRIS MCP Server Suite,
**I want** the new tools documented consistently across the suite and per-package READMEs, the API catalog, and the changelog,
**so that** I can discover, choose, and use them the same way I would any pre-existing tool — and so that existing `@iris-mcp/dev` installs know what the upgrade brings.

**Acceptance Criteria**:

- **AC 10.3.1** — [README.md](../../README.md) (suite-level):
  - Update the `@iris-mcp/dev` row of the Servers table so the tool count reflects the new total (`21` → `23`).
  - Update the bullet description of `@iris-mcp/dev` to mention "package browsing and bulk export" alongside the existing "document CRUD, compilation, …".
  - No other changes — the suite README stays high-level.
- **AC 10.3.2** — [packages/iris-dev-mcp/README.md](../../packages/iris-dev-mcp/README.md):
  - Add `iris_package_list` and `iris_doc_export` to the tool catalog table, in the same column format as the existing rows (Tool / Description / Key Parameters / Annotations).
  - Add two `<details>` example blocks in the "Tool Examples" section, one per tool, showing a realistic input + expected output. For `iris_doc_export`, show both the happy-path result and the skipped-item + manifest shape.
  - Update any "Tools: N" count callouts in the package README to the new number.
- **AC 10.3.3** — [tool_support.md](../../tool_support.md):
  - Add two rows to the `@iris-mcp/dev` table. Both are 🟦 Atelier:
    - `iris_package_list` → `GET /docnames/{cat}/{type}` (aggregated client-side)
    - `iris_doc_export` → `GET /docnames/{cat}/{type}` + `GET /doc/{name}` (bulk)
  - Update the per-table "**Mix:**" line: `15 Atelier · 6 ExecuteMCPv2 · 0 other` → `17 Atelier · 6 ExecuteMCPv2 · 0 other`.
  - Update the "Suite-wide rollup" section totals if it sums Atelier/ExecuteMCPv2 counts.
  - Update the `@iris-mcp/dev` heading count: `(21)` → `(23)`.
- **AC 10.3.4** — [CHANGELOG.md](../../CHANGELOG.md):
  - New `## [Pre-release — 2026-04-20]` entry (or extend the existing 2026-04-20 bug-fix entry with an `### Added` section).
  - Call out that the change is TypeScript-only — no `BOOTSTRAP_VERSION` bump, no ObjectScript redeploy on existing installs.
- **AC 10.3.5** — Discoverability linking in tool descriptions: the `iris_doc_list` and `iris_doc_get` tool descriptions each get a single sentence pointing to the new tool for bulk use cases. E.g., `iris_doc_list`: "For a structural overview at package granularity, see `iris_package_list`." `iris_doc_get`: "To pull many documents at once, see `iris_doc_export`."
- **AC 10.3.6** — Cross-reference check: grep the repo for any document listing tool counts per package (beyond the three files above) and update as found. Known candidates: `_bmad-output/planning-artifacts/prd.md` (FR numbering), `packages/iris-mcp-all/README.md`. Do NOT update `_bmad-output/implementation-artifacts/*` — those are historical sprint logs.

**Implementation Notes**:
- This story lands as the final commit of Epic 10, after 10.1 and 10.2 are merged.
- No code change; pure docs. Lands in one commit.
- PR description should link to Stories 10.1 and 10.2 so the doc delta is reviewable against the tool implementations.
