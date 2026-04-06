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
NFR14: HTTP client must handle IRIS session cookies, CSRF tokens, and connection timeouts (configurable, default 30s)
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
FR20: Epic 2 — Check document existence and timestamps (via iris.doc.get metadata mode)
FR21: Epic 2 — Retrieve documents modified since timestamp (via iris.doc.list modifiedSince filter)
FR22: Epic 2 — Compile documents with configurable flags
FR23: Epic 2 — Queue async compilation and poll status
FR24: Epic 2 — Detailed compilation errors with source locations
FR25: Epic 2 — Class structure (methods, properties, parameters)
FR26: Epic 2 — Full-text search across documents
FR27: Epic 2 — Macro definitions and expansion
FR28: Epic 2 — Convert documents between UDL and XML
FR29: Epic 2 — Export documents to XML format (via iris.doc.xml_export action "export")
FR30: Epic 2 — Import documents from XML (via iris.doc.xml_export action "import")
FR31: Epic 2 — List XML file contents before import (via iris.doc.xml_export action "list")
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
**When** `iris.doc.get` is called with the document name (e.g., "MyApp.Service.cls")
**Then** the document content is returned in UDL format by default (FR16)
**And** an optional `format` parameter allows requesting XML format
**And** an optional `namespace` parameter overrides the default namespace

**Given** new or modified ObjectScript source code
**When** `iris.doc.put` is called with the document name and content
**Then** the document is created or updated on IRIS via the Atelier API (FR17)
**And** the response confirms the save was successful

**Given** one or more existing documents
**When** `iris.doc.delete` is called with the document name(s)
**Then** the specified documents are deleted from IRIS (FR18)
**And** the response confirms deletion

**Given** a namespace with ObjectScript documents
**When** `iris.doc.list` is called with optional category filter (CLS, RTN, CSP, OTH)
**Then** a filtered list of documents in the namespace is returned (FR19)
**And** results support pagination via the server base

**Given** a document that does not exist
**When** `iris.doc.get` is called
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
**When** `iris.doc.get` is called with a metadata-only option (e.g., HEAD verb on the Atelier /doc/ endpoint)
**Then** the response includes the document's existence status and last modification timestamp without transferring content (FR20)

**Given** a timestamp
**When** `iris.doc.list` is called with a `modifiedSince` filter parameter
**Then** only documents modified since that timestamp are returned (FR21)
**And** an optional namespace parameter scopes the query

**Given** a document that does not exist
**When** `iris.doc.get` is called with metadata-only option
**Then** the response indicates the document does not exist without raising an error

**And** these capabilities are modes of existing tools (iris.doc.get and iris.doc.list), not separate tools — keeping iris-dev-mcp at exactly 20 tools per the PRD specification
**And** responses complete within 2 seconds (NFR1)

### Story 2.4: Compilation Tools

As a developer,
I want to compile ObjectScript documents with detailed error feedback,
So that I can fix compilation issues directly through my AI assistant without switching to the Management Portal.

**Acceptance Criteria:**

**Given** one or more valid document names
**When** `iris.doc.compile` is called with default flags
**Then** synchronous compilation is performed via the Atelier API (FR22)
**And** the response includes success/failure status and compilation time

**Given** compilation flags (e.g., "ck", "cku")
**When** `iris.doc.compile` is called with the flags parameter
**Then** the specified flags are passed to the Atelier compilation endpoint

**Given** a large package or multiple documents
**When** `iris.doc.compile` is called with an async option
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
**When** `iris.doc.index` is called
**Then** the class structure is returned including methods, properties, parameters, and superclasses (FR25)
**And** each member includes its type, signature, and relevant metadata

**Given** a search query (text or regex pattern)
**When** `iris.doc.search` is called with the pattern
**Then** matching documents and locations are returned (FR26)
**And** options for regex, wildcard, and case-sensitivity are supported
**And** an optional namespace parameter scopes the search

**Given** a macro name
**When** `iris.macro.info` is called
**Then** the macro definition, source location, and expanded value are returned (FR27)

**Given** a search with no results
**When** `iris.doc.search` returns empty
**Then** an empty result set is returned (not an error)

**And** all three tools are annotated as readOnlyHint: true
**And** responses complete within 2 seconds (NFR1)

### Story 2.6: Document Format & XML Tools

As a developer,
I want to convert documents between formats and import/export XML,
So that I can work with legacy XML-based workflows and convert between UDL and XML representations.

**Acceptance Criteria:**

**Given** a document in UDL format
**When** `iris.doc.convert` is called with target format XML
**Then** the document is converted and returned in XML format (FR28)

**Given** a document in XML format
**When** `iris.doc.convert` is called with target format UDL
**Then** the document is converted and returned in UDL format (FR28)

**Given** one or more document names
**When** `iris.doc.xml_export` is called with action "export"
**Then** the documents are exported to legacy XML format and the XML content is returned (FR29)

**Given** XML content containing ObjectScript documents
**When** `iris.doc.xml_export` is called with action "import"
**Then** the documents are imported into IRIS from the provided XML content (FR30)

**Given** XML content
**When** `iris.doc.xml_export` is called with action "list"
**Then** a list of documents contained in the XML is returned without importing them (FR31)

**And** FR29-FR31 are handled as action parameters on `iris.doc.xml_export` — no separate tools are created, keeping iris-dev-mcp at exactly 20 tools per the PRD specification
**And** iris.doc.xml_export with action "export"/"list" is annotated as readOnlyHint: true
**And** iris.doc.xml_export with action "import" is annotated as destructiveHint: true
**And** iris.doc.convert is annotated as readOnlyHint: true

### Story 2.7: SQL Execution & Server Info

As a developer,
I want to execute SQL queries and retrieve IRIS server information through MCP tools,
So that I can query data and understand my IRIS environment without leaving the AI conversation.

**Acceptance Criteria:**

**Given** a valid SQL query
**When** `iris.sql.execute` is called with the query string
**Then** the query is executed via the Atelier API and results are returned with column names and row data (FR32)
**And** parameterized inputs are supported to prevent SQL injection
**And** a configurable row limit parameter prevents unbounded result sets (default reasonable limit)

**Given** a SQL query
**When** execution begins
**Then** first results are returned within 5 seconds (NFR3)

**Given** an invalid SQL query
**When** `iris.sql.execute` is called
**Then** an MCP tool error is returned with the SQL error message

**Given** a connected IRIS instance
**When** `iris.server.info` is called
**Then** server information is returned including IRIS version, platform, and instance name
**And** the tool has scope NONE (no namespace context)

**Given** a namespace name
**When** `iris.server.namespace` is called
**Then** namespace details are returned including associated databases and enabled features
**And** the tool has scope NS (accepts namespace parameter)

**And** iris.sql.execute is annotated as readOnlyHint: false (can execute INSERT/UPDATE/DELETE)
**And** iris.server.info and iris.server.namespace are annotated as readOnlyHint: true

### Story 2.8: iris-dev-mcp Unit & Integration Tests

As a developer,
I want unit tests (mocked HTTP) and integration tests (real IRIS) for all Atelier API-based tools,
So that I can verify parameter validation, response parsing, and end-to-end behavior.

**Acceptance Criteria:**

**Given** a local IRIS development instance
**When** the integration test suite runs
**Then** iris.doc.get retrieves an existing class document successfully
**And** iris.doc.put creates a new test document and iris.doc.get confirms it exists
**And** iris.doc.delete removes the test document and iris.doc.head confirms it is gone
**And** iris.doc.list returns documents filtered by category (CLS)
**And** iris.doc.head returns metadata for an existing document
**And** iris.doc.modified returns documents modified in the last hour
**And** iris.doc.compile compiles a valid class successfully and returns compilation errors for an invalid class
**And** iris.doc.index returns class structure for a known class
**And** iris.doc.search finds a known string in a document
**And** iris.macro.info returns definition for a known macro
**And** iris.doc.convert converts between UDL and XML
**And** iris.doc.xml_export exports a document to XML
**And** iris.sql.execute runs a SELECT query and returns results
**And** iris.server.info returns valid server information
**And** iris.server.namespace returns details for the configured namespace

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
**When** `iris.global.get` is called
**Then** the value at the specified global node is returned via the custom REST endpoint GET /api/executemcp/v2/global (FR33)
**And** complex subscript expressions are supported (multi-level, string subscripts)

**Given** a global name, subscripts, and a value
**When** `iris.global.set` is called
**Then** the global value is set via PUT /api/executemcp/v2/global (FR34)
**And** the response includes automatic verification that the value was set correctly

**Given** a global name and optional subscripts
**When** `iris.global.kill` is called
**Then** the specified global node or subtree is deleted via DELETE /api/executemcp/v2/global (FR35)

**Given** a namespace
**When** `iris.global.list` is called with an optional filter pattern
**Then** a list of globals in the namespace is returned (FR36)

**Given** a global operation that would leave IRIS in an inconsistent state
**When** an error occurs mid-operation
**Then** the operation fails cleanly without partial state changes (NFR20)
**And** the namespace is always restored to its original value (NFR21)

**And** the ExecuteMCPv2.REST.Global handler class is created and compiles on IRIS
**And** the four iris.global.* tools are registered in iris-dev-mcp's tool registry (src/tools/global.ts exported via src/tools/index.ts)
**And** iris.global.get and iris.global.list are annotated as readOnlyHint: true
**And** iris.global.set is annotated as destructiveHint: false (creates/updates data)
**And** iris.global.kill is annotated as destructiveHint: true
**And** unit tests with mocked HTTP responses verify parameter validation, response parsing, and error handling
**And** all tools respond within 2 seconds for read operations (NFR1)

### Story 3.3: ObjectScript Execution REST Handler & Tools

As a developer,
I want to execute ObjectScript commands and call class methods through my AI assistant,
So that I can run code on IRIS directly from the AI conversation.

**Acceptance Criteria:**

**Given** a valid ObjectScript command string
**When** `iris.execute.command` is called
**Then** the command is executed on IRIS via POST /api/executemcp/v2/command (FR37)
**And** captured I/O output (Write statements, error messages) is returned in the response

**Given** a class name, method name, and optional positional parameters
**When** `iris.execute.classmethod` is called
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
**When** `iris.execute.tests` is called with level "package"
**Then** all test classes in the package are executed via POST /api/executemcp/v2/tests (FR39)
**And** structured results are returned including: total tests, passed, failed, skipped, and per-test details (class, method, status, message)

**Given** a test class name
**When** `iris.execute.tests` is called with level "class"
**Then** only the specified test class is executed

**Given** a test class name and method name
**When** `iris.execute.tests` is called with level "method"
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
**Then** iris.global.get retrieves a known global value
**And** iris.global.set writes a test global and iris.global.get confirms the value
**And** iris.global.kill removes the test global and iris.global.get confirms it is gone
**And** iris.global.list returns globals in the test namespace
**And** iris.execute.command runs a simple SET command and returns captured output
**And** iris.execute.classmethod calls a known class method and returns the result
**And** iris.execute.tests runs a simple test class and returns structured pass/fail results

**Given** the bootstrap flow
**When** tested against the local IRIS instance
**Then** the bootstrap detects the existing REST service and skips deployment (idempotent behavior)

**And** unit tests (`__tests__/*.test.ts`) with mocked HTTP responses verify parameter validation, response parsing, and error handling for every custom REST tool
**And** each integration test cleans up any test globals or artifacts it creates
**And** integration tests verify namespace restoration after each tool call
**And** integration tests are in `__tests__/*.integration.test.ts` files using Vitest

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
**When** `iris.namespace.manage` is called with action "create"
**Then** a new namespace is created on IRIS with the specified database bindings via the custom REST endpoint (FR40)
**And** the tool executes in %SYS scope (no namespace parameter — target namespace is a data parameter)

**Given** an existing namespace
**When** `iris.namespace.manage` is called with action "modify"
**Then** the namespace configuration is updated (FR40)

**Given** an existing namespace
**When** `iris.namespace.manage` is called with action "delete"
**Then** the namespace is removed from IRIS (FR40)

**Given** no parameters
**When** `iris.namespace.list` is called
**Then** all namespaces are returned with their associated code and data databases (FR41)

**Given** database configuration parameters (name, directory, size options)
**When** `iris.database.manage` is called with action "create"
**Then** a new database is created with full configuration options (FR42)

**Given** no parameters or optional filters
**When** `iris.database.list` is called
**Then** all databases are returned with size, free space, and mount status (FR43)

**Given** a failed namespace or database operation
**When** an error occurs
**Then** IRIS is not left in an inconsistent state (e.g., no partially created namespaces) (NFR20)

**And** the ExecuteMCPv2.REST.Config handler class is created and compiles on IRIS
**And** the Dispatch UrlMap is extended with /config/:entity route and Dispatch is recompiled
**And** iris.namespace.manage and iris.database.manage are annotated as destructiveHint: true (can delete)
**And** iris.namespace.list and iris.database.list are annotated as readOnlyHint: true
**And** all inputs are validated at the REST boundary (NFR10)
**And** unit tests with mocked HTTP responses verify parameter validation, response parsing, and error handling

### Story 4.3: Namespace Mapping Tools

As an administrator,
I want to create, delete, and list global, routine, and package mappings between namespaces,
So that I can configure cross-namespace data and code access.

**Acceptance Criteria:**

**Given** a source namespace, mapping type (global, routine, or package), and mapping details
**When** `iris.mapping.manage` is called with action "create"
**Then** the specified mapping is created between namespaces (FR44)
**And** the tool executes in %SYS (target namespace is a data parameter)

**Given** an existing mapping
**When** `iris.mapping.manage` is called with action "delete"
**Then** the mapping is removed (FR44)

**Given** a namespace name
**When** `iris.mapping.list` is called
**Then** all global, routine, and package mappings for that namespace are returned (FR45)

**And** iris.mapping.manage is annotated as destructiveHint: true
**And** iris.mapping.list is annotated as readOnlyHint: true

### Story 4.4: User & Password Management Tools

As an administrator,
I want to manage user accounts, assign roles, and handle passwords through MCP tools,
So that I can provision user access without the Management Portal.

**Acceptance Criteria:**

**Given** user account details (username, password, roles, properties)
**When** `iris.user.manage` is called with action "create"
**Then** a new IRIS user account is created with the specified configuration (FR46)

**Given** an existing username
**When** `iris.user.manage` is called with action "modify"
**Then** the user properties are updated (FR46)

**Given** an existing username
**When** `iris.user.manage` is called with action "delete"
**Then** the user account is removed (FR46)

**Given** a username
**When** `iris.user.get` is called
**Then** user properties are returned (roles, status, last login, etc.) (FR47)

**Given** no parameters
**When** `iris.user.get` is called with action "list"
**Then** all users are returned with their properties (FR47)

**Given** a username and a role name
**When** `iris.user.roles` is called with action "add" or "remove"
**Then** the role is added to or removed from the user (FR48)

**Given** a username and a new password
**When** `iris.user.password` is called with action "change"
**Then** the password is updated (FR49)

**Given** a username and a candidate password
**When** `iris.user.password` is called with action "validate"
**Then** the password is checked against IRIS password policy and the result is returned (FR49)

**And** the ExecuteMCPv2.REST.Security handler class is created and compiles on IRIS
**And** the Dispatch UrlMap is extended with /security/:entity route and Dispatch is recompiled
**And** passwords are never included in log output or error messages (NFR6)
**And** iris.user.manage is annotated as destructiveHint: true
**And** iris.user.get is annotated as readOnlyHint: true
**And** all tools execute in %SYS scope
**And** unit tests with mocked HTTP responses verify parameter validation, response parsing, and error handling

### Story 4.5: Role & Resource Management Tools

As an administrator,
I want to manage security roles, resources, and check permissions through MCP tools,
So that I can configure IRIS security without the Management Portal.

**Acceptance Criteria:**

**Given** role details (name, description, resource grants)
**When** `iris.role.manage` is called with action "create"
**Then** a new security role is created with the specified resource grants (FR50)

**Given** an existing role
**When** `iris.role.manage` is called with action "modify" or "delete"
**Then** the role is updated or removed (FR50)

**Given** no parameters
**When** `iris.role.list` is called
**Then** all security roles are returned (FR51)

**Given** resource details (name, description, public permission)
**When** `iris.resource.manage` is called with action "create"
**Then** a new security resource is created (FR52)

**Given** an existing resource
**When** `iris.resource.manage` is called with action "modify" or "delete"
**Then** the resource is updated or removed (FR52)

**Given** no parameters
**When** `iris.resource.list` is called
**Then** all security resources are returned (FR53)

**Given** a user or role name and a resource name
**When** `iris.permission.check` is called
**Then** the response indicates whether the user/role has the specified permission on the resource (FR54)

**And** iris.role.manage and iris.resource.manage are annotated as destructiveHint: true
**And** iris.role.list, iris.resource.list, and iris.permission.check are annotated as readOnlyHint: true

### Story 4.6: Web Application Management Tools

As an administrator,
I want to create, modify, delete, and list CSP/REST web applications through MCP tools,
So that I can configure web access to IRIS without the Management Portal.

**Acceptance Criteria:**

**Given** web application configuration (name, namespace, dispatch class, authentication methods, CSP path)
**When** `iris.webapp.manage` is called with action "create"
**Then** a new web application is registered on IRIS (FR55)

**Given** an existing web application name
**When** `iris.webapp.manage` is called with action "modify"
**Then** the web application configuration is updated (FR55)

**Given** an existing web application name
**When** `iris.webapp.manage` is called with action "delete"
**Then** the web application is removed (FR55)

**Given** a web application name
**When** `iris.webapp.get` is called
**Then** the full web application properties are returned (FR56)

**Given** an optional namespace filter
**When** `iris.webapp.list` is called
**Then** all web applications are returned, optionally filtered by namespace (FR57)
**And** the tool has scope BOTH (accepts optional namespace for filtering)

**And** iris.webapp.manage is annotated as destructiveHint: true
**And** iris.webapp.get is annotated as readOnlyHint: true
**And** iris.webapp.list is annotated as readOnlyHint: true

### Story 4.7: SSL/TLS Configuration Tools

As an administrator,
I want to manage SSL/TLS configurations through MCP tools,
So that I can set up secure communications without the Management Portal.

**Acceptance Criteria:**

**Given** SSL configuration details (name, certificate file paths, key file, CA file, protocols)
**When** `iris.ssl.manage` is called with action "create"
**Then** a new SSL/TLS configuration is created on IRIS (FR58)

**Given** an existing SSL configuration
**When** `iris.ssl.manage` is called with action "modify" or "delete"
**Then** the SSL configuration is updated or removed (FR58)

**Given** no parameters
**When** `iris.ssl.list` is called
**Then** all SSL/TLS configurations are returned with their details (certificate paths, enabled protocols, verification settings) (FR59)

**And** the ExecuteMCPv2.REST.SSL handler is included in the Security handler or created separately
**And** iris.ssl.manage is annotated as destructiveHint: true
**And** iris.ssl.list is annotated as readOnlyHint: true

### Story 4.8: OAuth2 Management Tools

As an administrator,
I want to manage OAuth2 server definitions and client registrations through MCP tools,
So that I can configure OAuth2 authentication without the Management Portal.

**Acceptance Criteria:**

**Given** OAuth2 server definition parameters (issuer URL, scopes, endpoints)
**When** `iris.oauth.manage` is called with action "create" and entity "server"
**Then** a new OAuth2 server definition is created (FR60)

**Given** client registration parameters (client name, redirect URIs, grant types)
**When** `iris.oauth.manage` is called with action "create" and entity "client"
**Then** a new OAuth2 client application is registered (FR60)

**Given** an issuer URL
**When** `iris.oauth.manage` is called with action "discover"
**Then** OpenID Connect discovery is performed and the discovered configuration is returned (FR61)

**Given** no parameters or optional filters
**When** `iris.oauth.list` is called
**Then** OAuth2 configurations are returned including server definitions and registered client details (FR62)

**And** the ExecuteMCPv2.REST.OAuth handler is created and compiles on IRIS
**And** client secrets are never included in log output (NFR6)
**And** iris.oauth.manage is annotated as destructiveHint: true
**And** iris.oauth.list is annotated as readOnlyHint: true

### Story 4.9: iris-admin-mcp Unit & Integration Tests

As an administrator,
I want unit tests (mocked HTTP) and integration tests (real IRIS) for all administration tools,
So that I can verify parameter validation, response parsing, and end-to-end behavior.

**Acceptance Criteria:**

**Given** a local IRIS development instance with the ExecuteMCPv2 REST service deployed
**When** the integration test suite runs
**Then** iris.namespace.manage creates a test namespace and iris.namespace.list confirms it exists
**And** iris.database.manage creates a test database and iris.database.list confirms it exists
**And** iris.mapping.manage creates a test mapping and iris.mapping.list confirms it exists
**And** iris.user.manage creates a test user and iris.user.get confirms the user properties
**And** iris.user.roles adds a role to the test user and confirms assignment
**And** iris.user.password validates a password against policy
**And** iris.role.manage creates a test role and iris.role.list confirms it exists
**And** iris.resource.manage creates a test resource and iris.resource.list confirms it exists
**And** iris.permission.check verifies permissions for the test user/role
**And** iris.webapp.manage creates a test web application and iris.webapp.get confirms its properties
**And** iris.webapp.list returns the test web application
**And** iris.ssl.manage creates a test SSL configuration and iris.ssl.list confirms it exists
**And** iris.oauth.manage creates a test OAuth2 configuration and iris.oauth.list confirms it exists

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
**When** `iris.production.manage` is called with action "create"
**Then** a new Interoperability production is created in the specified namespace (FR63)

**Given** an existing production
**When** `iris.production.manage` is called with action "delete"
**Then** the production is removed (FR63)

**Given** an existing production
**When** `iris.production.control` is called with action "start"
**Then** the production is started (FR64)

**Given** a running production
**When** `iris.production.control` is called with action "stop", "restart", "update", or "recover"
**Then** the corresponding lifecycle action is performed (FR64)

**Given** a namespace with a production
**When** `iris.production.status` is called
**Then** the production status is returned including name, state (Running/Stopped/Suspended/Troubled), and start time (FR65)
**And** when the detail flag is true, item-level status is included (each config item's state, adapter, queue count)

**Given** no parameters
**When** `iris.production.summary` is called
**Then** a summary of productions across all namespaces is returned (FR66)
**And** the tool has scope NONE

**And** the ExecuteMCPv2.REST.Interop handler class is created and compiles on IRIS
**And** the Dispatch UrlMap is extended with /interop/:entity route and Dispatch is recompiled
**And** iris.production.manage is annotated as destructiveHint: true
**And** iris.production.control is annotated as destructiveHint: false (lifecycle management, not data deletion)
**And** iris.production.status and iris.production.summary are annotated as readOnlyHint: true
**And** unit tests with mocked HTTP responses verify parameter validation, response parsing, and error handling
**And** all tools respond within 2 seconds for status queries (NFR1)

### Story 5.3: Production Item & Auto-Start Tools

As an integration engineer,
I want to enable, disable, and configure individual production items and auto-start settings,
So that I can fine-tune production behavior without the Management Portal.

**Acceptance Criteria:**

**Given** a production item name and namespace
**When** `iris.production.item` is called with action "enable"
**Then** the specified config item is enabled (FR67)

**Given** a production item name
**When** `iris.production.item` is called with action "disable"
**Then** the specified config item is disabled (FR67)

**Given** a production item name
**When** `iris.production.item` is called with action "get"
**Then** the config item's host and adapter settings are returned (FR68)

**Given** a production item name and settings to update
**When** `iris.production.item` is called with action "set"
**Then** the config item's host and/or adapter settings are updated (FR68)

**Given** a namespace and production name
**When** `iris.production.autostart` is called with action "get"
**Then** the current auto-start configuration is returned (FR69)

**Given** a namespace, production name, and auto-start flag
**When** `iris.production.autostart` is called with action "set"
**Then** the production auto-start setting is updated (FR69)

**And** iris.production.item with action "get" is annotated as readOnlyHint: true
**And** iris.production.item with action "set"/"enable"/"disable" is annotated as destructiveHint: false
**And** all tools have scope NS

### Story 5.4: Production Monitoring Tools

As an integration engineer,
I want to query production logs, check queue status, trace messages, and list adapters,
So that I can troubleshoot production issues through my AI assistant.

**Acceptance Criteria:**

**Given** a namespace with a production
**When** `iris.production.logs` is called with optional filters (type, item name, count)
**Then** production event log entries are returned matching the filters (FR70)
**And** log entries include timestamp, type (Info/Warning/Error), item name, and message text

**Given** a namespace with a running production
**When** `iris.production.queues` is called
**Then** queue status for all production items is returned including queue count and processing rate (FR71)

**Given** a session ID or header ID
**When** `iris.production.messages` is called
**Then** the message flow trace is returned showing the complete path through the production (FR72)
**And** each step includes source item, target item, message class, timestamp, and status

**Given** an optional category filter (inbound, outbound, process)
**When** `iris.production.adapters` is called
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
**When** `iris.credential.manage` is called with action "create"
**Then** a new Ensemble credential is stored (FR74)

**Given** an existing credential ID
**When** `iris.credential.manage` is called with action "update" or "delete"
**Then** the credential is updated or removed (FR74)

**Given** a namespace
**When** `iris.credential.list` is called
**Then** stored credentials are returned (credential IDs and usernames, never passwords) (FR75)

**Given** a lookup table name and key-value pair
**When** `iris.lookup.manage` is called with action "set"
**Then** the lookup table entry is created or updated (FR76)

**Given** a lookup table name and key
**When** `iris.lookup.manage` is called with action "get"
**Then** the value for the specified key is returned (FR76)

**Given** a lookup table name and key
**When** `iris.lookup.manage` is called with action "delete"
**Then** the lookup table entry is removed (FR76)

**Given** a lookup table name and format "xml"
**When** `iris.lookup.transfer` is called with action "export"
**Then** the lookup table is exported in XML format (FR77)

**Given** XML content containing a lookup table
**When** `iris.lookup.transfer` is called with action "import"
**Then** the lookup table is imported from the XML (FR77)

**And** credential passwords are never included in list responses or log output (NFR6)
**And** iris.credential.manage and iris.lookup.manage are annotated as destructiveHint: true
**And** iris.credential.list is annotated as readOnlyHint: true

### Story 5.6: Rules, Transforms & REST API Tools

As an integration engineer,
I want to view business rules, test data transformations, and manage REST APIs through MCP tools,
So that I can inspect and validate integration logic without the Management Portal.

**Acceptance Criteria:**

**Given** a namespace
**When** `iris.rule.list` is called
**Then** all business rule classes in the namespace are returned (FR78)

**Given** a rule class name
**When** `iris.rule.get` is called
**Then** the rule definition is returned including conditions, actions, and routing logic (FR78)

**Given** a namespace
**When** `iris.transform.list` is called
**Then** all data transformation classes in the namespace are returned (FR79)

**Given** a transform class name and sample input data
**When** `iris.transform.test` is called
**Then** the transformation is executed against the sample input and the output is returned (FR79)

**Given** an OpenAPI specification
**When** `iris.interop.rest` is called with action "create"
**Then** a REST application is created from the OpenAPI spec (FR80)

**Given** an existing REST application
**When** `iris.interop.rest` is called with action "delete"
**Then** the REST application is removed (FR80)

**Given** an existing REST application name
**When** `iris.interop.rest` is called with action "get"
**Then** the OpenAPI spec for the REST application is returned (FR80)

**And** iris.rule.list, iris.rule.get, iris.transform.list are annotated as readOnlyHint: true
**And** iris.transform.test is annotated as readOnlyHint: false (executes code)
**And** iris.interop.rest is annotated as destructiveHint: true (can delete)

### Story 5.7: iris-interop-mcp Unit & Integration Tests

As an integration engineer,
I want unit tests (mocked HTTP) and integration tests (real IRIS) for all interoperability tools,
So that I can verify parameter validation, response parsing, and end-to-end behavior.

**Acceptance Criteria:**

**Given** a local IRIS development instance with the ExecuteMCPv2 REST service deployed
**When** the integration test suite runs
**Then** iris.production.manage creates a test production and iris.production.status confirms it exists
**And** iris.production.control starts and stops the test production
**And** iris.production.item retrieves and updates config item settings
**And** iris.production.autostart gets and sets auto-start configuration
**And** iris.production.logs returns event log entries for the test production
**And** iris.production.queues returns queue status
**And** iris.production.adapters returns available adapter types
**And** iris.credential.manage creates a test credential and iris.credential.list confirms it exists
**And** iris.lookup.manage sets and gets a test lookup table entry
**And** iris.lookup.transfer exports and re-imports the test lookup table
**And** iris.rule.list returns business rule classes (if any exist in test namespace)
**And** iris.transform.list returns data transformation classes (if any exist in test namespace)

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
**When** `iris.metrics.system` is called
**Then** system metrics are returned in Prometheus text exposition format (FR81)
**And** metrics include cache hit ratio, database size, process count, and other key indicators
**And** the tool has scope NONE

**Given** a connected IRIS instance
**When** `iris.metrics.alerts` is called
**Then** active system alerts are returned (FR82)
**And** each alert includes severity, category, message, and timestamp
**And** the tool has scope NONE

**Given** a connected IRIS instance
**When** `iris.metrics.interop` is called
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
**When** `iris.jobs.list` is called
**Then** all running IRIS jobs and processes are returned (FR84)
**And** each job includes process ID, routine, namespace, state, and start time
**And** the tool has scope NONE

**Given** a connected IRIS instance
**When** `iris.locks.list` is called
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
**When** `iris.journal.info` is called
**Then** journal file information is returned including current journal file, directory, size, and available journal files (FR86)
**And** the tool executes in %SYS scope

**Given** a connected IRIS instance
**When** `iris.mirror.status` is called
**Then** mirror configuration, membership, and synchronization status are returned (FR87)
**And** the response includes member roles (primary/backup/async), sync status, and last sync time
**And** the tool executes in %SYS scope

**Given** optional filters (time range, user, event type)
**When** `iris.audit.events` is called
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
**When** `iris.database.check` is called
**Then** database integrity status is returned for all databases or a specified database (FR89)
**And** the response includes last integrity check time and any reported issues
**And** the tool executes in %SYS scope

**Given** a connected IRIS instance
**When** `iris.license.info` is called
**Then** license usage and details are returned (FR90)
**And** the response includes license type, total capacity, current usage, and expiration date
**And** the tool has scope NONE

**Given** a connected IRIS instance
**When** `iris.ecp.status` is called
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
**When** `iris.task.manage` is called with action "create"
**Then** a new scheduled task is created on IRIS (FR92)

**Given** an existing task ID
**When** `iris.task.manage` is called with action "modify"
**Then** the task configuration is updated (FR92)

**Given** an existing task ID
**When** `iris.task.manage` is called with action "delete"
**Then** the scheduled task is removed (FR92)

**Given** no parameters or optional filters
**When** `iris.task.list` is called
**Then** all scheduled tasks are returned with their schedules, last run time, and next run time (FR93)

**Given** a task ID
**When** `iris.task.run` is called
**Then** the task is executed immediately regardless of its schedule (FR94)
**And** the response confirms execution was triggered

**Given** a task ID
**When** `iris.task.history` is called
**Then** the task execution history is returned including past run times, status (success/failure), and duration (FR95)

**And** the ExecuteMCPv2.REST.Task handler class is created and compiles on IRIS
**And** all tools execute in %SYS scope
**And** iris.task.manage is annotated as destructiveHint: true
**And** iris.task.list and iris.task.history are annotated as readOnlyHint: true
**And** iris.task.run is annotated as destructiveHint: false (triggers execution, doesn't delete)

### Story 6.7: System Configuration Tools

As an operations engineer,
I want to view and modify IRIS system configuration through MCP tools,
So that I can manage system settings without the Management Portal.

**Acceptance Criteria:**

**Given** a configuration section or parameter name
**When** `iris.config.manage` is called with action "get"
**Then** the current value of the specified system configuration parameter is returned (FR96)

**Given** a configuration parameter name and new value
**When** `iris.config.manage` is called with action "set"
**Then** the system configuration parameter is updated (FR96)

**Given** a request for startup configuration
**When** `iris.config.manage` is called with action "get" and section "startup"
**Then** the startup configuration is returned (FR97)

**Given** a request for startup configuration changes
**When** `iris.config.manage` is called with action "set" and section "startup"
**Then** the startup configuration is updated (FR97)

**Given** a request for NLS/locale configuration
**When** `iris.config.manage` is called with action "get" and section "locale"
**Then** the NLS/locale configuration is returned (FR98)

**Given** no parameters
**When** `iris.config.manage` is called with action "export"
**Then** the complete system configuration is exported (FR99)

**And** the ExecuteMCPv2.REST.SystemConfig handler class is created and compiles on IRIS
**And** the tool executes in %SYS scope
**And** iris.config.manage with action "get" and "export" is annotated as readOnlyHint: true
**And** iris.config.manage with action "set" is annotated as destructiveHint: true (modifying system config is high-impact)
**And** inputs are validated at the REST boundary (NFR10)

### Story 6.8: iris-ops-mcp Unit & Integration Tests

As an operations engineer,
I want unit tests (mocked HTTP) and integration tests (real IRIS) for all operations and monitoring tools,
So that I can verify parameter validation, response parsing, and end-to-end behavior.

**Acceptance Criteria:**

**Given** a local IRIS development instance with the ExecuteMCPv2 REST service deployed
**When** the integration test suite runs
**Then** iris.metrics.system returns Prometheus-format metrics
**And** iris.metrics.alerts returns alerts (possibly empty if no active alerts)
**And** iris.metrics.interop returns interoperability metrics
**And** iris.jobs.list returns running jobs
**And** iris.locks.list returns current locks (possibly empty)
**And** iris.journal.info returns journal file information
**And** iris.mirror.status returns mirror configuration (or indicates mirroring is not configured)
**And** iris.audit.events returns audit events for a recent time range
**And** iris.database.check returns integrity status
**And** iris.license.info returns license details
**And** iris.ecp.status returns ECP status (or indicates ECP is not configured)
**And** iris.task.manage creates a test task and iris.task.list confirms it exists
**And** iris.task.run triggers the test task and iris.task.history shows the execution
**And** iris.config.manage retrieves a known system configuration parameter

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
**When** `iris.docdb.manage` is called with action "create"
**Then** a new document database is created in the specified namespace (FR100)

**Given** an existing document database name
**When** `iris.docdb.manage` is called with action "drop"
**Then** the document database is dropped (FR100)

**Given** a document database name and document content (JSON)
**When** `iris.docdb.document` is called with action "insert"
**Then** a new document is inserted and its generated ID is returned (FR101)

**Given** a document database name and document ID
**When** `iris.docdb.document` is called with action "get"
**Then** the document content is retrieved by ID (FR101)

**Given** a document database name, document ID, and updated content
**When** `iris.docdb.document` is called with action "update"
**Then** the document is updated (FR101)

**Given** a document database name and document ID
**When** `iris.docdb.document` is called with action "delete"
**Then** the document is deleted (FR101)

**Given** a document database name and filter criteria (JSON query)
**When** `iris.docdb.find` is called
**Then** matching documents are returned based on the filter (FR102)
**And** filter supports comparison operators ($eq, $lt, $gt, $ne, etc.)

**Given** a document database name and property definition (name, type)
**When** `iris.docdb.property` is called with action "create"
**Then** a new property is defined on the document database (FR103)

**Given** a document database name and property name
**When** `iris.docdb.property` is called with action "drop"
**Then** the property is removed (FR103)

**Given** a document database name and property name
**When** `iris.docdb.property` is called with action "index"
**Then** an index is created on the specified property (FR103)

**And** iris.docdb.manage is annotated as destructiveHint: true (can drop databases)
**And** iris.docdb.document with action "delete" is annotated as destructiveHint: true
**And** iris.docdb.find is annotated as readOnlyHint: true
**And** all tools have scope NS
**And** all inputs are validated at the REST boundary (NFR10)

### Story 7.3: Analytics Tools

As an analyst,
I want to execute MDX queries and manage DeepSee cubes through MCP tools,
So that I can run analytics and maintain BI infrastructure without the Management Portal.

**Acceptance Criteria:**

**Given** an MDX query string and a namespace
**When** `iris.analytics.mdx` is called
**Then** the MDX query is executed against the specified DeepSee cube and results are returned as a structured pivot table (FR104)
**And** the response includes axis labels, measure values, and dimension members

**Given** an invalid MDX query
**When** `iris.analytics.mdx` is called
**Then** an MCP tool error is returned with the MDX error message

**Given** a namespace
**When** `iris.analytics.cubes` is called with action "list"
**Then** all available DeepSee cubes in the namespace are returned (FR105)
**And** each cube includes its name, source class, last build time, and record count

**Given** a cube name
**When** `iris.analytics.cubes` is called with action "build"
**Then** a full cube rebuild is triggered (FR105)

**Given** a cube name
**When** `iris.analytics.cubes` is called with action "sync"
**Then** an incremental cube synchronization is triggered (FR105)

**And** the ExecuteMCPv2.REST.Analytics handler class is created and compiles on IRIS
**And** iris.analytics.mdx is annotated as readOnlyHint: true
**And** iris.analytics.cubes with action "list" is annotated as readOnlyHint: true
**And** iris.analytics.cubes with action "build"/"sync" is annotated as destructiveHint: false (rebuilds data, doesn't delete)
**And** all tools have scope NS
**And** MDX queries respond within 5 seconds for typical cube sizes (NFR1)

### Story 7.4: REST API Management & Debug Placeholders

As a data engineer,
I want to view and manage REST API dispatch classes on IRIS and have placeholder tools for future debugging capabilities,
So that I can inspect REST services and know that debug features are planned for a future release.

**Acceptance Criteria:**

**Given** a namespace
**When** `iris.rest.manage` is called with action "list"
**Then** available REST API dispatch classes and their URL maps in the namespace are returned

**Given** a REST application name
**When** `iris.rest.manage` is called with action "get"
**Then** the REST application details (dispatch class, URL map, routes) are returned

**Given** an existing REST application
**When** `iris.rest.manage` is called with action "delete"
**Then** the REST application is removed

**Note:** Creating REST applications from OpenAPI specs is handled by `iris.interop.rest` (FR80) in iris-interop-mcp, not this tool. `iris.rest.manage` provides REST API viewing and management from the data/management perspective via the Management API.

**Given** a client that lists tools
**When** `tools/list` is called on iris-data-mcp
**Then** iris.debug.session and iris.debug.terminal are NOT listed (deferred to post-MVP, FR106-FR107)
**And** the debug.ts tool file exists as a placeholder with a code comment indicating these tools are deferred to post-MVP and will require WebSocket transport

**And** iris.rest.manage is annotated as destructiveHint: true (can delete)
**And** the tool has scope NS

### Story 7.5: iris-data-mcp Unit & Integration Tests

As a data engineer,
I want unit tests (mocked HTTP) and integration tests (real IRIS) for all data and analytics tools,
So that I can verify parameter validation, response parsing, and end-to-end behavior.

**Acceptance Criteria:**

**Given** a local IRIS development instance with the ExecuteMCPv2 REST service deployed
**When** the integration test suite runs
**Then** iris.docdb.manage creates a test document database
**And** iris.docdb.property creates a property and an index on the test database
**And** iris.docdb.document inserts a test document and retrieves it by ID
**And** iris.docdb.document updates the test document and confirms the update
**And** iris.docdb.find queries the test database with a filter and returns matching documents
**And** iris.docdb.document deletes the test document and confirms deletion
**And** iris.docdb.manage drops the test database
**And** iris.analytics.cubes lists available cubes (may be empty if no cubes configured)
**And** iris.analytics.mdx executes a simple MDX query against a cube (if cubes exist, otherwise verifies error handling)
**And** iris.rest.manage lists REST applications in the namespace

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
**Then** a complete tool mapping table shows every v1 tool and its v2 equivalent (e.g., execute_command → iris.execute.command in iris-dev-mcp)
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
