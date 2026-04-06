# MCP Specification Reference (v2025-11-25)

**Source:** https://modelcontextprotocol.io/specification/2025-11-25  
**Schema:** https://github.com/modelcontextprotocol/specification/blob/main/schema/2025-11-25/schema.ts  
**Saved:** 2026-04-05  

---

## Official Documentation Index

Source: https://modelcontextprotocol.io/llms.txt

### Core Specification Pages
- [Specification Overview](https://modelcontextprotocol.io/specification/2025-11-25/index.md)
- [Architecture](https://modelcontextprotocol.io/specification/2025-11-25/architecture/index.md)
- [Base Protocol](https://modelcontextprotocol.io/specification/2025-11-25/basic/index.md)
- [Lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle.md)
- [Transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports.md)
- [Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization.md)
- [Schema Reference](https://modelcontextprotocol.io/specification/2025-11-25/schema.md)
- [Key Changes (Changelog)](https://modelcontextprotocol.io/specification/2025-11-25/changelog.md)

### Server Features
- [Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools.md)
- [Resources](https://modelcontextprotocol.io/specification/2025-11-25/server/resources.md)
- [Prompts](https://modelcontextprotocol.io/specification/2025-11-25/server/prompts.md)
- [Pagination](https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/pagination.md)
- [Logging](https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/logging.md)
- [Completion](https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/completion.md)

### Client Features
- [Sampling](https://modelcontextprotocol.io/specification/2025-11-25/client/sampling.md)
- [Roots](https://modelcontextprotocol.io/specification/2025-11-25/client/roots.md)
- [Elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation.md)

### Utilities
- [Tasks](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks.md)
- [Cancellation](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation.md)
- [Progress](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress.md)
- [Ping](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/ping.md)

### Extensions
- [Extensions Overview](https://modelcontextprotocol.io/extensions/overview.md)
- [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview.md)
- [Authorization Extensions](https://modelcontextprotocol.io/extensions/auth/overview.md)
- [OAuth Client Credentials](https://modelcontextprotocol.io/extensions/auth/oauth-client-credentials.md)
- [Enterprise-Managed Authorization](https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization.md)

### Development Guides
- [Build an MCP server](https://modelcontextprotocol.io/docs/develop/build-server.md)
- [Build an MCP client](https://modelcontextprotocol.io/docs/develop/build-client.md)
- [Build with Agent Skills](https://modelcontextprotocol.io/docs/develop/build-with-agent-skills.md)
- [Security Best Practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices.md)
- [Understanding Authorization](https://modelcontextprotocol.io/docs/tutorials/security/authorization.md)
- [Debugging](https://modelcontextprotocol.io/docs/tools/debugging.md)
- [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector.md)
- [SDKs](https://modelcontextprotocol.io/docs/sdk.md)

---

## Tools Specification (Complete)

### Capability Declaration

Servers that support tools MUST declare the `tools` capability:

```json
{
  "capabilities": {
    "tools": {
      "listChanged": true
    }
  }
}
```

`listChanged` indicates whether the server will emit notifications when the list of available tools changes.

### tools/list — Listing Tools

Supports cursor-based pagination.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {
    "cursor": "optional-cursor-value"
  }
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {
        "name": "get_weather",
        "title": "Weather Information Provider",
        "description": "Get current weather information for a location",
        "inputSchema": {
          "type": "object",
          "properties": {
            "location": {
              "type": "string",
              "description": "City name or zip code"
            }
          },
          "required": ["location"]
        },
        "outputSchema": { ... },
        "annotations": {
          "readOnlyHint": true,
          "destructiveHint": false,
          "idempotentHint": true,
          "openWorldHint": true
        },
        "execution": {
          "taskSupport": "optional"
        }
      }
    ],
    "nextCursor": "next-page-cursor"
  }
}
```

### tools/call — Calling Tools

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "get_weather",
    "arguments": {
      "location": "New York"
    }
  }
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Current weather in New York:\nTemperature: 72°F\nConditions: Partly cloudy"
      }
    ],
    "structuredContent": { ... },
    "isError": false
  }
}
```

### notifications/tools/list_changed

When the list of available tools changes:

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/tools/list_changed"
}
```

---

## Tool Data Types (from schema.ts)

### Tool Interface
```typescript
export interface Tool extends BaseMetadata, Icons {
  description?: string;
  inputSchema: {
    $schema?: string;
    type: "object";
    properties?: { [key: string]: object };
    required?: string[];
  };
  execution?: ToolExecution;
  outputSchema?: {
    $schema?: string;
    type: "object";
    properties?: { [key: string]: object };
    required?: string[];
  };
  annotations?: ToolAnnotations;
  _meta?: { [key: string]: unknown };
}
```

### ToolAnnotations Interface
```typescript
export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;      // Default: false — if true, tool does not modify state
  destructiveHint?: boolean;   // Default: true — if true, tool may perform destructive/irreversible operations
  idempotentHint?: boolean;    // Default: false — if true, repeated calls with same args have no additional effect
  openWorldHint?: boolean;     // Default: true — if true, tool interacts with external entities
}
```

### ToolExecution Interface
```typescript
export interface ToolExecution {
  taskSupport?: "forbidden" | "optional" | "required";
}
```

### Pagination Types
```typescript
export interface PaginatedRequestParams extends RequestParams {
  cursor?: Cursor;
}

export interface PaginatedResult extends Result {
  nextCursor?: Cursor;
}

export type Cursor = string;
```

### ListToolsRequest / ListToolsResult
```typescript
export interface ListToolsRequest extends PaginatedRequest {
  method: "tools/list";
}

export interface ListToolsResult extends PaginatedResult {
  tools: Tool[];
}
```

### CallToolRequest / CallToolResult
```typescript
export interface CallToolRequest extends JSONRPCRequest {
  method: "tools/call";
  params: CallToolRequestParams;
}

export interface CallToolRequestParams extends TaskAugmentedRequestParams {
  name: string;
  arguments?: { [key: string]: unknown };
}

export interface CallToolResult extends Result {
  content: ContentBlock[];
  structuredContent?: { [key: string]: unknown };
  isError?: boolean;
}
```

---

## Tool Naming Rules

- Tool names SHOULD be between 1 and 128 characters
- Tool names SHOULD be considered case-sensitive
- Allowed characters: A-Z, a-z, 0-9, underscore (_), hyphen (-), dot (.)
- Tool names SHOULD NOT contain spaces, commas, or special characters
- Tool names SHOULD be unique within a server
- Example valid names: `getUser`, `DATA_EXPORT_v2`, `admin.tools.list`

---

## Pagination Specification

### Model
- Uses opaque cursor-based approach (not numbered pages)
- Cursor is an opaque string token representing position in result set
- Page size is determined by the server; clients MUST NOT assume fixed page size

### Flow
1. Client sends request without cursor (first page)
2. Server returns page of results + optional `nextCursor`
3. Client sends next request with cursor from previous response
4. Missing `nextCursor` signals end of results

### Operations Supporting Pagination
- `tools/list`
- `resources/list`
- `resources/templates/list`
- `prompts/list`

### Rules
- Clients MUST treat cursors as opaque tokens
- Servers SHOULD provide stable cursors
- Invalid cursors SHOULD result in error code -32602

---

## Capability Negotiation (Lifecycle)

### Initialization Flow
1. Client sends `initialize` request with protocol version and client capabilities
2. Server responds with its capabilities (including `tools: { listChanged: true }`)
3. Client sends `initialized` notification
4. Normal operation begins

### Server Capabilities
| Capability | Description |
|-----------|-------------|
| `tools` | Exposes callable tools (with optional `listChanged`) |
| `resources` | Provides readable resources (with optional `subscribe`, `listChanged`) |
| `prompts` | Offers prompt templates (with optional `listChanged`) |
| `logging` | Emits structured log messages |
| `completions` | Supports argument autocompletion |
| `tasks` | Support for task-augmented server requests |

---

## Error Handling

### Protocol Errors (JSON-RPC)
- Unknown tools: code -32602
- Malformed requests
- Server errors

### Tool Execution Errors
- Returned in result with `isError: true`
- Contain actionable feedback for LLM self-correction
- API failures, input validation errors, business logic errors

---

## Security Requirements

### Servers MUST:
- Validate all tool inputs
- Implement proper access controls
- Rate limit tool invocations
- Sanitize tool outputs

### Clients SHOULD:
- Prompt for user confirmation on sensitive operations
- Show tool inputs to user before calling server
- Validate tool results before passing to LLM
- Implement timeouts for tool calls
- Log tool usage for audit purposes

### Tool Annotations Trust:
- Annotations are hints, not contracts
- Clients MUST consider annotations untrusted unless from trusted servers
- Default posture for unannotated tools: potentially destructive, non-idempotent, open-world
