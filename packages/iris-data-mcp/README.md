# @iris-mcp/data

**IRIS Data & Analytics MCP Server** -- DocDB document database, DeepSee analytics (MDX queries and cube management), and REST API management via the Model Context Protocol.

Part of the [IRIS MCP Server Suite](../../README.md).

---

## Installation

```bash
npm install -g @iris-mcp/data
```

Or run directly without installing:

```bash
npx @iris-mcp/data
```

---

## Configuration

All servers use the same environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `IRIS_HOST` | `localhost` | IRIS hostname or IP |
| `IRIS_PORT` | `52773` | IRIS web server port |
| `IRIS_USERNAME` | `_SYSTEM` | IRIS username |
| `IRIS_PASSWORD` | *(required)* | IRIS password |
| `IRIS_NAMESPACE` | `USER` | Default IRIS namespace |
| `IRIS_HTTPS` | `false` | Use HTTPS instead of HTTP |

---

## MCP Client Configuration

### Claude Code (`.mcp.json`)

```json
{
  "mcpServers": {
    "iris-data-mcp": {
      "command": "npx",
      "args": ["-y", "@iris-mcp/data"],
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

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "iris-data-mcp": {
      "command": "npx",
      "args": ["-y", "@iris-mcp/data"],
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

### Cursor

```json
{
  "iris-data-mcp": {
    "command": "npx",
    "args": ["-y", "@iris-mcp/data"],
    "env": {
      "IRIS_HOST": "localhost",
      "IRIS_PORT": "52773",
      "IRIS_USERNAME": "_SYSTEM",
      "IRIS_PASSWORD": "SYS",
      "IRIS_NAMESPACE": "USER"
    }
  }
}
```

> **Note:** Replace `"SYS"` with your actual IRIS password. Avoid committing real credentials to version control.

---

## Prerequisites

In addition to the standard prerequisites, the DocDB tools require the `%Service_DocDB` service to be enabled on the IRIS instance. This can be enabled through the System Management Portal under *System Administration > Security > Services*.

---

## Tool Reference

### Document Database (DocDB) Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_docdb_manage` | Create, drop, or list document databases | `action`, `database?`, `namespace?` | destructive |
| `iris_docdb_document` | Insert, get, update, or delete documents | `action`, `database`, `id?`, `document?`, `namespace?` | destructive |
| `iris_docdb_find` | Query documents with filter criteria | `database`, `filter`, `namespace?` | readOnly, idempotent |
| `iris_docdb_property` | Create, drop, or index properties | `action`, `database`, `property`, `type?`, `namespace?` | destructive |

### Analytics Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_analytics_mdx` | Execute MDX queries against DeepSee | `query`, `namespace?` | readOnly, idempotent |
| `iris_analytics_cubes` | List, build, or synchronize DeepSee cubes | `action`, `cube?`, `namespace?` | -- |

### REST API Management Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_rest_manage` | List, get details, or delete REST applications | `action`, `scope?`, `application?`, `namespace?` | destructive |

---

## Tool Examples

<details>
<summary><strong>iris_docdb_manage</strong> -- List document databases</summary>

**Input:**
```json
{
  "action": "list"
}
```

**Output:**
```json
{
  "items": [
    { "name": "People", "count": 150 },
    { "name": "Products", "count": 42 }
  ],
  "count": 2
}
```
</details>

<details>
<summary><strong>iris_docdb_manage</strong> -- Create a document database</summary>

**Input:**
```json
{
  "action": "create",
  "database": "Customers"
}
```

**Output:**
```json
{
  "database": "Customers",
  "status": "created"
}
```
</details>

<details>
<summary><strong>iris_docdb_document</strong> -- Insert a document</summary>

**Input:**
```json
{
  "action": "insert",
  "database": "Customers",
  "document": {
    "name": "John Smith",
    "email": "john@example.com",
    "age": 35
  }
}
```

**Output:**
```json
{
  "id": "1",
  "status": "inserted"
}
```
</details>

<details>
<summary><strong>iris_docdb_document</strong> -- Get a document by ID</summary>

**Input:**
```json
{
  "action": "get",
  "database": "Customers",
  "id": "1"
}
```

**Output:**
```json
{
  "%DocumentId": "1",
  "name": "John Smith",
  "email": "john@example.com",
  "age": 35
}
```
</details>

<details>
<summary><strong>iris_docdb_find</strong> -- Query documents</summary>

**Input:**
```json
{
  "database": "Customers",
  "filter": {
    "age": { "$gt": 30 }
  }
}
```

**Output:**
```json
{
  "items": [
    { "%DocumentId": "1", "name": "John Smith", "email": "john@example.com", "age": 35 }
  ],
  "count": 1
}
```
</details>

<details>
<summary><strong>iris_docdb_property</strong> -- Create a property</summary>

**Input:**
```json
{
  "action": "create",
  "database": "Customers",
  "property": "email",
  "type": "%String"
}
```

**Output:**
```json
{
  "property": "email",
  "type": "%String",
  "status": "created"
}
```
</details>

<details>
<summary><strong>iris_docdb_property</strong> -- Index a property</summary>

**Input:**
```json
{
  "action": "index",
  "database": "Customers",
  "property": "email"
}
```

**Output:**
```json
{
  "property": "email",
  "indexed": true
}
```
</details>

<details>
<summary><strong>iris_analytics_mdx</strong> -- Execute MDX query</summary>

**Input:**
```json
{
  "query": "SELECT [Measures].[Count] ON 0, [Product].[Product Category].Members ON 1 FROM [Sales]"
}
```

**Output:**
```json
{
  "columns": ["Count"],
  "rows": [
    { "label": "Electronics", "values": [1200] },
    { "label": "Clothing", "values": [850] },
    { "label": "Books", "values": [2100] }
  ],
  "rowCount": 3,
  "columnCount": 1
}
```
</details>

<details>
<summary><strong>iris_analytics_cubes</strong> -- List cubes</summary>

**Input:**
```json
{
  "action": "list"
}
```

**Output:**
```json
{
  "cubes": [
    {
      "name": "Sales",
      "sourceClass": "MyApp.Fact.Sales",
      "factCount": 50000,
      "lastBuildTime": "2026-04-06T22:00:00.000Z",
      "lastBuildTimeRaw": "67300,79200.000"
    }
  ],
  "count": 1
}
```

Each cube entry carries both a human-readable ISO 8601 `lastBuildTime` and
the original `$HOROLOG` string under `lastBuildTimeRaw`, so clients can
cross-check against `$ZDATETIME` or round-trip the raw value when needed.
Malformed or missing horolog values yield `lastBuildTime: ""` without
throwing; the raw value is still preserved when it is a string.
</details>

<details>
<summary><strong>iris_analytics_cubes</strong> -- Build a cube</summary>

**Input:**
```json
{
  "action": "build",
  "cube": "Sales"
}
```

**Output:**
```json
{
  "cube": "Sales",
  "action": "build",
  "status": "completed",
  "recordCount": 50000
}
```
</details>

<details>
<summary><strong>iris_rest_manage</strong> -- List REST applications (spec-first by default)</summary>

**Input (default — spec-first apps only):**
```json
{
  "action": "list"
}
```

**Output (spec-first):**
```json
{
  "items": [
    {
      "name": "HS.FHIRServer.Management.REST.v1",
      "dispatchClass": "HS.FHIRServer.Management.REST.v1.disp",
      "swaggerSpec": "/api/mgmnt/v2/HSCUSTOM/HS.FHIRServer.Management.REST.v1"
    }
  ],
  "count": 1
}
```

The default `scope: "spec-first"` matches the SMP REST listing and routes
to IRIS's built-in Management API (`/api/mgmnt/v2/{ns}/`), which returns only
OpenAPI-spec-first dispatch classes (the ones with a `.spec` companion).
Hand-written `%CSP.REST` subclasses (for example, `ExecuteMCPv2.REST.Dispatch`)
are excluded by design of the IRIS Management API.

**Input (include hand-written `%CSP.REST` subclasses):**
```json
{
  "action": "list",
  "scope": "all",
  "namespace": "HSCUSTOM"
}
```

**Output (`scope: "all"`):**
```json
{
  "items": [
    {
      "name": "/api/executemcp/v2",
      "dispatchClass": "ExecuteMCPv2.REST.Dispatch",
      "namespace": "HSCUSTOM",
      "swaggerSpec": null
    }
  ],
  "count": 1
}
```

`scope: "all"` uses the ExecuteMCPv2 webapp endpoint and filters entries
with a non-empty `dispatchClass`. Hand-written dispatch classes have no
companion spec class, so `swaggerSpec` is `null` for them.
</details>

<details>
<summary><strong>iris_rest_manage</strong> -- Get REST application details</summary>

**Input:**
```json
{
  "action": "get",
  "application": "/api/myapp"
}
```

**Output:**
```json
{
  "name": "/api/myapp",
  "dispatchClass": "MyApp.REST.Dispatch",
  "routes": [
    { "method": "GET", "url": "/items", "call": "GetItems" },
    { "method": "POST", "url": "/items", "call": "CreateItem" }
  ]
}
```
</details>

---

## Namespace Scoping

All 7 tools in this package accept the optional `namespace` parameter to target a specific IRIS namespace. If omitted, the configured default namespace (`IRIS_NAMESPACE` environment variable) is used.

DocDB tools use the IRIS built-in DocDB REST API at `/api/docdb/v1/{namespace}/...`. The namespace is included directly in the API URL path.

Analytics tools use the custom REST endpoint and pass namespace as a request parameter.

REST management tools use the IRIS built-in Management API at `/api/mgmnt/v2/{namespace}/...`.

**Important:** DocDB tools require the `%Service_DocDB` service to be enabled in the target IRIS instance. Without this service, DocDB operations will fail with a service-not-available error.

---

## Error Handling

### Common Errors

| Error | Cause | Resolution |
|-------|-------|------------|
| `IRIS connection refused` | IRIS web server not running or wrong host/port | Verify `IRIS_HOST` and `IRIS_PORT` settings |
| `401 Unauthorized` | Invalid credentials | Check `IRIS_USERNAME` and `IRIS_PASSWORD` |
| `DocDB service not available` | `%Service_DocDB` not enabled | Enable the service via SMP: *System Administration > Security > Services* |
| `Database not found` | DocDB database does not exist | Use `iris_docdb_manage` with action `list` to check available databases |
| `Document not found` | Invalid document ID | Verify the document ID with `iris_docdb_find` |
| `Cube not found` | DeepSee cube does not exist | Use `iris_analytics_cubes` with action `list` to see available cubes |
| `MDX syntax error` | Invalid MDX query | Check MDX syntax; ensure the cube and dimension names are correct |
| `REST application not found` | Invalid application path | Use `iris_rest_manage` with action `list` to see available applications |

### Error Response Format

```json
{
  "content": [{ "type": "text", "text": "Error querying documents: <details>" }],
  "isError": true
}
```

---

[Back to IRIS MCP Server Suite](../../README.md)
