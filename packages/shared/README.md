# @iris-mcp/shared

**Internal shared library for the IRIS MCP Server Suite.** This package provides the common HTTP client, configuration, error handling, and MCP server base class used by all five IRIS MCP server packages.

> **This is an internal dependency.** It is not intended for direct installation or standalone use. Install one of the server packages instead:
> [`@iris-mcp/dev`](../iris-dev-mcp/README.md),
> [`@iris-mcp/admin`](../iris-admin-mcp/README.md),
> [`@iris-mcp/interop`](../iris-interop-mcp/README.md),
> [`@iris-mcp/ops`](../iris-ops-mcp/README.md),
> [`@iris-mcp/data`](../iris-data-mcp/README.md)

Part of the [IRIS MCP Server Suite](../../README.md).

---

## Public API

### HTTP Client

- **`IrisHttpClient`** -- HTTP client for communicating with IRIS. Handles Basic Auth, session cookie reuse, CSRF token management, and Atelier REST API envelope parsing. Supports GET, POST, PUT, DELETE, and HEAD methods.
- **`IrisConnectionConfig`** (type) -- Configuration interface for IRIS connection: host, port, username, password, namespace, https flag.
- **`RequestOptions`** (type) -- Options for HTTP requests: method, path, body, headers, query parameters.
- **`AtelierEnvelope`** (type) -- Parsed Atelier REST API response envelope with status, result, and console output.
- **`HeadResponse`** (type) -- Response type for HEAD requests: status code and headers.
- **`loadConfig()`** -- Loads connection configuration from environment variables (`IRIS_HOST`, `IRIS_PORT`, etc.).

### MCP Server Base

- **`McpServerBase`** -- Abstract base class for all IRIS MCP servers. Handles tool registration, input validation (Zod), transport setup (stdio/Streamable HTTP), health checking, and auto-bootstrap of custom REST classes.
- **`McpServerBaseOptions`** (type) -- Options for constructing an MCP server (name, version, tool definitions).
- **`ToolDefinition`** (type) -- Tool definition interface including name, title, description, inputSchema (Zod), annotations, scope, and handler function.
- **`ToolContext`** (type) -- Context passed to tool handlers: HTTP client, Atelier version, namespace resolver, paginator.
- **`ToolResult`** (type) -- Standard tool return type with content array, optional structuredContent, and isError flag.
- **`ToolAnnotations`** (type) -- MCP tool annotations: readOnlyHint, destructiveHint, idempotentHint, openWorldHint.
- **`ToolScope`** (type) -- Tool scope enum: `"NS"` (namespace-scoped), `"SYS"` (system-scoped), `"NONE"` (no namespace), `"BOTH"`.
- **`PaginateResult<T>`** (type) -- Generic result type for paginated tool responses: items array, nextCursor, and hasMore flag.
- **`buildToolContext()`** -- Factory function to create a ToolContext from an HTTP client and Atelier version.
- **`encodeCursor()` / `decodeCursor()`** -- Cursor encoding utilities for paginated tool responses.
- **`resolveTransport()`** -- Determines MCP transport type (stdio vs Streamable HTTP) from environment.

### Atelier API Utilities

- **`negotiateVersion()`** -- Negotiates the best Atelier API version supported by the connected IRIS instance.
- **`requireMinVersion()`** -- Validates that the Atelier version meets a minimum requirement for a given tool.
- **`atelierPath()`** -- Constructs Atelier REST API URL paths with version and namespace.

### Health Check

- **`checkHealth()`** -- Performs a full health check (connection, authentication, Atelier API).
- **`ping()`** -- Lightweight connectivity check.

### Error Classes

- **`IrisConnectionError`** -- Thrown when the IRIS server cannot be reached (network errors, DNS failures).
- **`IrisApiError`** -- Thrown when the IRIS server returns an HTTP error (4xx/5xx). Includes statusCode and response body.
- **`McpProtocolError`** -- Thrown for MCP protocol-level issues (invalid tool calls, schema validation failures).

### Bootstrap

- **`bootstrap()`** -- Auto-deploys the custom REST service (`ExecuteMCPv2.REST.Dispatch`) to IRIS on first connection. Checks if the endpoint exists, deploys ObjectScript handler classes if missing, and configures the web application.
- **`probeCustomRest()`** -- Checks if the custom REST endpoint is already available.
- **`deployClasses()`** -- Deploys ObjectScript classes to IRIS via the Atelier PUT /doc API.
- **`compileClasses()`** -- Compiles deployed classes via the Atelier compile API.
- **`configureWebApp()`** -- Creates or updates the web application for the custom REST endpoint.
- **`MANUAL_INSTRUCTIONS`** -- Instructions for manual bootstrap when auto-bootstrap fails.
- **`getBootstrapClasses()`** -- Returns the list of ObjectScript classes to deploy.
- **`BOOTSTRAP_CLASSES`** -- Array of bootstrap class definitions (name + content).
- **`BootstrapClass`** / **`BootstrapResult`** (types) -- Type definitions for bootstrap operations.

### Logging

- **`logger`** -- Shared logger instance for consistent log output across all servers.
- **`Logger`** (type) -- Logger interface type.
- **`LogLevel`** / **`parseLogLevel()`** -- Log level enum and parser.

### Zod Helpers

- **`booleanParam`** -- Zod schema for boolean parameters that also accepts string/number values ("true"/"false", 1/0).

### Tool Visibility (advertise-time preset filter)

`tool-visibility.ts` implements the config-driven, advertise-time tool-visibility engine (the `IRIS_TOOLS_PRESET` / `IRIS_TOOLS_DISABLE` / `IRIS_TOOLS_ENABLE` family) applied by `McpServerBase` at construction, in FRONT of call-time governance — described in the suite's [Tool Visibility Presets](../../README.md#tool-visibility-presets) section. A hidden tool is never registered with the SDK (absent from `tools/list`, uncallable), so it is orthogonal to governance (which controls whether an already-visible action is *allowed*).

- **`parseToolVisibilityConfig()`** -- Parses the visibility env family into a `ToolVisibilityConfig`. Fails fast on an unknown preset value (naming the valid `full`/`core`/`developer`), a bare `*`, or a literal `iris_server_profiles` in `IRIS_TOOLS_DISABLE`; WARNs (never fails) on unknown tool names and on the same literal in both lists (ENABLE wins).
- **`resolveVisibleTools()`** -- Applies resolution `ENABLE > DISABLE > preset > default-visible` (trailing-`*` wildcards) over a package's tool set, returning the visible set plus visible/hidden counts. Reserved `iris_server_profiles` is always visible.
- **`assertPresetCoverage()`** -- Registration-time guard (sibling of `assertGovernanceClassification`): throws, naming the offending tool + preset, if any preset's `include ∪ exclude` ≠ the package tool-set or `include ∩ exclude ≠ ∅`. `full` is reserved (all tools).
- **`TOOL_PAIRS`** -- Co-visibility pairs (`iris_env_diff`/`iris_env_promote`) that every preset must keep together-in or together-out.
- **`ToolPresetName`** / **`ToolPresetRoster`** / **`ToolPresetRosters`** / **`ToolVisibilityConfig`** (types) -- Preset name union and the per-package `include`/`exclude` roster shapes wired via `McpServerBaseOptions.toolPresets`.

---

## Audit Logging (framework surface, not part of the public barrel)

`audit.ts` implements the opt-in, structured, secrets-free session audit log described in the suite's [Compliance & Auditability](../../README.md#compliance--auditability) section (`IRIS_AUDIT_LOG` / `IRIS_AUDIT_LOG_MAX_MB` / `IRIS_AUDIT_LOG_PARAMS`). Unlike everything in [Public API](#public-api) above, its exports (`AuditLogger`, `parseAuditConfig()`, `redactValue()`, `AuditConfig`/`AuditEntryInput`/`AuditOutcome`) are **not** re-exported from this package's barrel (`index.ts`) — the module is consumed internally, exclusively by `server-base.ts`.

- **`AuditLogger`** -- Owns the per-process session UUID, a monotonic per-session `seq` counter, a serialized append queue (`fs.appendFile`, one JSONL line per call), size-based rotation (`<path>` → `<path>.1`), and degrade-never-throw semantics (a post-startup sink failure is swallowed, logged once, and counted rather than propagated into the tool path). `shutdown()` flushes the queue and writes a final line recording `droppedEntries`.
- **`parseAuditConfig()`** -- Parses `IRIS_AUDIT_LOG` / `IRIS_AUDIT_LOG_MAX_MB` / `IRIS_AUDIT_LOG_PARAMS` from an injectable `env`. Returns `undefined` (auditing OFF) when `IRIS_AUDIT_LOG` is unset; throws naming the offending variable on a malformed `IRIS_AUDIT_LOG_MAX_MB`.
- **`redactValue()`** -- Pure, non-mutating recursive redaction: replaces the value of any key matching the credential-name family (`password`, `secret`, `token`, `credential`, `apikey`, `authorization`, etc. — case-insensitive) with `"[REDACTED]"`, and truncates any other string over 2 KB.

**Framework surface, not a tool (Rule #31).** `McpServerBase.handleToolCall` — the single choke point every tool call passes through, on every server — wraps each call with a thin audit interceptor when `IRIS_AUDIT_LOG` is set. It is wired centrally in `server-base.ts`, so it automatically covers all five server packages and every present and future tool with zero per-tool code, and it appears in **no package's tool array**: it adds nothing to any `packages/<pkg>/src/tools/index.ts` array and changes no package's advertised tool count. It also carries no `mutates` classification and no `IRIS_GOVERNANCE` key — deliberately: audit logging is server *configuration*, not a governed tool action an AI client could switch off via governance.

---

## Architecture

All five IRIS MCP server packages depend on `@iris-mcp/shared`:

```
@iris-mcp/dev ─────┐
@iris-mcp/admin ───┤
@iris-mcp/interop ─┼──> @iris-mcp/shared ──> InterSystems IRIS
@iris-mcp/ops ─────┤
@iris-mcp/data ────┘
```

The shared package provides the HTTP communication layer, MCP protocol handling, and tool registration framework. Each server package defines its own tools (name, schema, handler) and passes them to `McpServerBase` for registration.

The connection flow is:
1. Server starts and loads configuration from environment variables
2. `McpServerBase` initializes the MCP transport (stdio or Streamable HTTP)
3. On first tool call, the HTTP client connects to IRIS and negotiates the Atelier API version
4. Bootstrap checks for the custom REST endpoint and deploys it if missing
5. Tools execute via the Atelier REST API or custom REST endpoint as appropriate

---

[Back to IRIS MCP Server Suite](../../README.md)
