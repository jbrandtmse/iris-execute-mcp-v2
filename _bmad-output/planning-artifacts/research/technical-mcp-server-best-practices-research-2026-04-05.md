# MCP Server Best Practices for Large Tool Sets — Technical Research Report

**Date:** 2026-04-05  
**Research Type:** Technical  
**Goal:** Determine best practices for implementing an MCP server with 142 tools, leveraging the MCP specification's features for progressive disclosure, pagination, tool annotations, and efficient tool management.

---

## 1. Executive Summary

The MCP specification (v2025-11-25) provides several mechanisms for managing large tool sets, but industry best practice strongly recommends **limiting tools per server to 5-15** for optimal LLM performance. For our 142-tool IRIS MCP v2 server, we need a deliberate architecture that balances comprehensiveness with usability.

### Key Findings

1. **The MCP spec supports pagination** for `tools/list` via cursor-based pagination — but most clients fetch ALL pages at startup
2. **Tool annotations** (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) enable clients to auto-approve safe operations
3. **`listChanged` notifications** allow dynamic tool registration at runtime
4. **GitHub reduced from 40 to 13 tools** and saw 2-5% benchmark improvement + 400ms latency reduction
5. **Performance degrades sharply past ~20 tools** — described as a "cliff, not gradual"
6. **Tool naming with dot notation** (e.g., `admin.tools.list`) is spec-compliant and enables logical grouping
7. **The recommended pattern is: one server per domain, 5-15 tools each** — but our use case may justify a unified server with careful design

---

## 2. MCP Specification Features for Large Tool Sets

### 2.1 Cursor-Based Pagination (`tools/list`)

The spec supports pagination for listing tools:

```json
// Request (first page)
{ "method": "tools/list", "params": {} }

// Response
{
  "result": {
    "tools": [ ... ],
    "nextCursor": "eyJwYWdlIjogMn0="
  }
}

// Request (next page)
{ "method": "tools/list", "params": { "cursor": "eyJwYWdlIjogMn0=" } }
```

**Important caveat:** Pagination helps with transport efficiency but does NOT help with LLM context window consumption. Most clients fetch ALL pages and present ALL tools to the LLM. Pagination is a transport optimization, not a progressive disclosure mechanism.

### 2.2 Tool Annotations

Annotations describe tool behavior for client-side safety decisions:

```typescript
interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;      // Default: false
  destructiveHint?: boolean;   // Default: true  
  idempotentHint?: boolean;    // Default: false
  openWorldHint?: boolean;     // Default: true
}
```

**Client behavior based on annotations:**
- `readOnlyHint: true` → Clients may auto-approve without user confirmation
- `destructiveHint: true` → Clients SHOULD require user confirmation
- `idempotentHint: true` → Clients may batch or retry safely
- `openWorldHint: false` → Tool only affects local/internal state

**For our server:** Properly annotating all 142 tools allows clients like Claude Code to auto-approve read-only tools (list_*, get_*, search_*) while prompting for destructive ones (delete_*, modify_*, create_*).

### 2.3 `listChanged` Notification

Servers can dynamically change their tool list at runtime:

```json
// Server declares capability
{ "capabilities": { "tools": { "listChanged": true } } }

// Server notifies client when tools change
{ "method": "notifications/tools/list_changed" }

// Client re-fetches tool list
{ "method": "tools/list" }
```

**For our server:** This enables a "connect first, configure later" pattern where the server starts with a minimal tool set and expands based on what the user needs.

### 2.4 Tool Naming with Dot Notation

The spec allows dots in tool names: `A-Z, a-z, 0-9, _, -, .`

Example valid names from the spec: `admin.tools.list`

**For our server:** We can use dot-separated namespacing:
- `iris.doc.get`, `iris.doc.put`, `iris.doc.compile`
- `iris.sql.execute`
- `iris.security.user.create`, `iris.security.role.list`
- `iris.interop.production.start`

### 2.5 Structured Content & Output Schema (New in 2025-11-25)

Tools can declare output schemas for typed, validated responses:

```json
{
  "name": "get_server_info",
  "outputSchema": {
    "type": "object",
    "properties": {
      "version": { "type": "string" },
      "namespaces": { "type": "array", "items": { "type": "string" } }
    }
  }
}
```

For backwards compatibility, include both `structuredContent` (typed) and `content` (text fallback).

---

## 3. Industry Best Practices for Many-Tool Servers

### 3.1 The "5-15 Tools Per Server" Guideline

**Source:** Phil Schmid (Hugging Face), GitHub Copilot team, AWS Heroes community

> "Design 10-15 outcome-oriented tools for the common 80% of requests. Performance degrades sharply past 20 tools — the failure is a cliff, not gradual degradation."

**GitHub's evidence:** Reduced Copilot MCP from 40 tools to 13 → **2-5% benchmark improvement + 400ms latency reduction**

**Why this matters:**
- Each tool's name + description + schema consumes context window tokens
- LLMs have to "choose" from the full tool list on every turn
- More tools = more chance of wrong tool selection
- More tools = slower first-token latency

### 3.2 Tool Design Principles

1. **Design for outcomes, not operations** — Don't map each API endpoint to a tool. Group related operations into higher-level tools.
2. **Flatten arguments** — Use top-level primitives and constrained types (Literal/enum), not nested objects.
3. **Enrich descriptions as instructions** — "Use when the user asks about production status. Returns current state and optional item details."
4. **Return helpful error strings** — Not exceptions. "User not found. Try searching by email instead."
5. **Paginate large results with metadata** — Don't return 10,000 rows; return first N with a count.
6. **Orchestrate server-side** — Move complex multi-step logic into the server, not the LLM.

### 3.3 Server Splitting Strategies

**By domain (recommended for most cases):**
- Server 1: Development tools (docs, compile, search)
- Server 2: SQL & data tools
- Server 3: Security administration
- Server 4: Interoperability/production management
- Server 5: System administration

**By persona:**
- Developer server: code, compile, test, debug
- Admin server: users, databases, namespaces, SSL, OAuth
- Ops server: monitoring, tasks, journals, mirrors

**By access level:**
- Read-only server: list, get, search, status tools
- Read-write server: create, modify, delete tools

### 3.4 The Unified Server Alternative

For our use case, a **single unified server** may be appropriate because:
- All tools share the same IRIS connection configuration
- Users need to switch between dev and admin tasks fluidly
- Multiple MCP servers = multiple connection configurations to maintain
- The `listChanged` mechanism allows dynamic tool exposure

---

## 4. Recommended Architecture for IRIS MCP v2

### 4.1 Strategy: Single Server with Dynamic Tool Profiles

Rather than splitting into multiple servers OR exposing all 142 tools at once, implement a **profile-based progressive disclosure** pattern:

```
┌─────────────────────────────────────────┐
│          IRIS MCP v2 Server             │
│                                         │
│  Profile: "dev" (default)               │
│  ├── 18 Core Development tools          │
│  ├── 5 SQL & Data tools                 │
│  ├── 4 ObjectScript Execution tools     │
│  └── = 27 tools (Phase 1 MVP)          │
│                                         │
│  Profile: "admin"                       │
│  ├── 12 Server & Namespace tools        │
│  ├── 18 Security tools                  │
│  ├── 6 Web Application tools            │
│  ├── 5 SSL tools                        │
│  ├── 5 OAuth2 tools                     │
│  └── = 46 tools                         │
│                                         │
│  Profile: "interop"                     │
│  ├── 18 Production Management tools     │
│  ├── 8 Interop Config tools             │
│  ├── 4 Rules & Transforms tools         │
│  └── = 30 tools                         │
│                                         │
│  Profile: "ops"                         │
│  ├── 6 Task Scheduling tools            │
│  ├── 12 Monitoring tools                │
│  ├── 6 System Configuration tools       │
│  └── = 24 tools                         │
│                                         │
│  Profile: "full"                        │
│  └── All 142 tools                      │
│                                         │
│  Profile: "custom"                      │
│  └── User-defined tool selection        │
└─────────────────────────────────────────┘
```

### 4.2 How It Works

1. **Server starts with a configured profile** (env var `IRIS_MCP_PROFILE=dev`)
2. `tools/list` returns only tools in the active profile
3. A meta-tool `iris.switch_profile` allows the LLM/user to switch profiles at runtime
4. Server sends `notifications/tools/list_changed` after profile switch
5. Client re-fetches `tools/list` and sees the new tool set

### 4.3 The Meta-Tool Pattern

Include a small set of "always-on" meta-tools regardless of profile:

```json
{
  "name": "iris.switch_profile",
  "description": "Switch the active tool profile. Available profiles: dev, admin, interop, ops, full, custom. Use this when the user needs tools from a different category.",
  "annotations": { "readOnlyHint": false, "destructiveHint": false },
  "inputSchema": {
    "type": "object",
    "properties": {
      "profile": {
        "type": "string",
        "enum": ["dev", "admin", "interop", "ops", "full", "custom"]
      }
    },
    "required": ["profile"]
  }
}
```

```json
{
  "name": "iris.list_profiles",
  "description": "List available tool profiles with tool counts and descriptions.",
  "annotations": { "readOnlyHint": true }
}
```

### 4.4 Tool Annotation Strategy

Annotate every tool for optimal client behavior:

| Tool Pattern | readOnly | destructive | idempotent | openWorld |
|-------------|----------|-------------|------------|-----------|
| `get_*`, `list_*`, `search_*` | true | false | true | false |
| `create_*` | false | false | false | false |
| `modify_*`, `set_*` | false | false | true | false |
| `delete_*`, `kill_*` | false | **true** | false | false |
| `execute_*` | false | false | false | false |
| `compile_*` | false | false | true | false |
| `production_start/stop` | false | false | false | false |

This allows Claude Code to auto-approve all read-only tools while prompting for destructive operations.

### 4.5 Tool Naming Convention

Use dot-separated namespacing for all tools:

```
iris.{category}.{action}
iris.{category}.{subcategory}.{action}
```

Examples:
- `iris.doc.get` / `iris.doc.put` / `iris.doc.list` / `iris.doc.compile`
- `iris.sql.execute`
- `iris.global.get` / `iris.global.set` / `iris.global.kill`
- `iris.security.user.create` / `iris.security.user.list`
- `iris.interop.production.start` / `iris.interop.production.status`
- `iris.server.info` / `iris.server.namespaces`

Benefits:
- LLMs can pattern-match on prefixes
- Naturally groups related tools
- Spec-compliant (dots are allowed characters)
- Sortable and filterable

### 4.6 Description Writing Strategy

Descriptions serve as LLM instructions. Be specific:

**Bad:** `"Get document"` 
**Good:** `"Retrieve an ObjectScript class, routine, CSP page, or include file by name. Use this when the user asks to read or view source code. Returns the document content with format options (UDL, XML)."`

**Bad:** `"Execute SQL"`
**Good:** `"Execute a SQL query in the specified IRIS namespace. Returns up to max rows (default 100). Use for data queries, table inspection, or any SQL operation. Supports parameterized queries for safety."`

---

## 5. Implementation Recommendations

### 5.1 Transport

Use **Streamable HTTP** (recommended for production) or **stdio** (for local development):
- Streamable HTTP: Works with reverse proxies, supports multiple clients
- stdio: Simpler setup, used by Claude Desktop and Claude Code

### 5.2 SDK Choice

- **TypeScript SDK** (`@modelcontextprotocol/sdk`): Official, Tier 1, most complete
- **Python SDK** (`mcp`): Official, Tier 1, good for Python-based servers
- **FastMCP** (Python): Higher-level abstraction, simpler API

Given the server makes HTTP calls to IRIS, either TypeScript or Python works. TypeScript aligns better with the MCP ecosystem.

### 5.3 Connection Pooling

Since all tools call the IRIS web port via HTTP:
- Maintain a persistent HTTP connection pool to IRIS
- Use cookie-based session management (matching VS Code extension pattern)
- Implement connection health checks via `HEAD /api/atelier/`

### 5.4 Error Handling Strategy

Follow the MCP spec's two-tier error model:
1. **Protocol errors** (JSON-RPC -32602): Unknown tool, malformed request
2. **Tool execution errors** (`isError: true`): IRIS errors, SQL errors, compilation failures

Return actionable messages: `"Class 'MyClass' not found in namespace 'USER'. Available namespaces: USER, HSCUSTOM, %SYS. Try switching namespace."`

### 5.5 Rate Limiting & Security

- Validate all inputs before passing to IRIS
- Rate limit tool invocations (especially `execute_command`)
- Sanitize outputs (strip sensitive data from error messages)
- Log all tool usage for audit trail
- Require `%Admin_Manage:USE` for destructive admin tools

---

## 6. Sources

1. **MCP Specification v2025-11-25** — https://modelcontextprotocol.io/specification/2025-11-25
2. **MCP Tools Spec** — https://modelcontextprotocol.io/specification/2025-11-25/server/tools
3. **MCP Pagination Spec** — https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/pagination
4. **MCP Lifecycle Spec** — https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle
5. **MCP Schema (TypeScript)** — https://github.com/modelcontextprotocol/specification/blob/main/schema/2025-11-25/schema.ts
6. **Phil Schmid - MCP Best Practices** — https://www.philschmid.de/mcp-best-practices
7. **GitHub Copilot Tool Reduction** — https://dev.to/aws-heroes/mcp-tool-design-why-your-ai-agent-is-failing-and-how-to-fix-it-40fc
8. **Tool Annotations as Risk Vocabulary** — https://stacklok.com/blog/tool-annotations-are-becoming-the-risk-vocabulary-for-agentic-systems-that-matters-more-than-it-might-seem/
9. **MCP 2025-11-25 Changelog** — https://modelcontextprotocol.io/specification/2025-11-25/changelog
10. **MCP Security Best Practices** — https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices.md

---

*Research conducted by Mary, Strategic Business Analyst — mapping the protocol landscape for an efficient 142-tool MCP server.*
