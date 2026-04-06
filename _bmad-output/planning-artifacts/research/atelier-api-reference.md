# Atelier REST API Reference

Consolidated reference of all Atelier REST API endpoints used by the iris-execute-mcp-v2 project. Built from source code analysis of iris-dev-mcp tools, shared package HTTP client, and IRIS library inspection.

## Base URL Pattern

All versioned endpoints follow the pattern:

```
/api/atelier/v{version}/{namespace}/{action}
```

- **version**: Negotiated API version (1-8; project targets v7+).
- **namespace**: IRIS namespace (e.g., `USER`, `%SYS`, `HSCUSTOM`).
- **action**: Endpoint-specific path segment.

The root endpoint (`/api/atelier/`) is unversioned and namespace-independent.

## Parameter Conventions

- **Boolean query parameters**: Must be sent as numeric `1` or `0`, not `"true"` / `"false"`. IRIS returns HTTP 400 for non-numeric boolean flags.
- **Document names with `%`**: Must be URL-encoded via `encodeURIComponent()`. A bare `%` is interpreted as a percent-encoding prefix.
- **Namespace endpoint**: Must NOT have a trailing slash (e.g., `/api/atelier/v7/USER`, not `/api/atelier/v7/USER/`).

## Response Envelope

All Atelier responses follow this envelope structure:

```json
{
  "status": { "errors": [] },
  "console": [],
  "result": { ... }
}
```

- `status.errors`: Array of error objects (empty on success).
- `console`: Array of server console output strings.
- `result`: Endpoint-specific payload.

---

## Endpoint Catalog

### 1. Server Info (Root)

| Property | Value |
|----------|-------|
| **Tool** | `iris.server.info` |
| **Method** | `GET` |
| **URL** | `/api/atelier/` |
| **Min API Version** | v1 |
| **Scope** | NONE |
| **Request Body** | None |

**Response** (`result`):
```json
{
  "content": {
    "api": 8,
    "version": "8.0.0"
  },
  "version": "8.0.0",
  "id": "IRIS for UNIX ... 2024.1",
  "platform": "UNIX (Ubuntu Server LTS for x86-64)",
  "instanceName": "IRIS",
  "features": [],
  "namespaces": ["USER", "%SYS", "HSLIB"]
}
```

**Source**: `irislib/%Atelier/REST.cls` (dispatch class), `irislib/%Api/Atelier/v7.cls` (ServerInfo method)

---

### 2. Health Check (HEAD)

| Property | Value |
|----------|-------|
| **Tool** | Internal (checkHealth, ping) |
| **Method** | `HEAD` |
| **URL** | `/api/atelier/` |
| **Min API Version** | v1 |
| **Scope** | NONE |

**Purpose**: Verify IRIS is reachable. Returns HTTP 200 on success.

---

### 3. Namespace Info

| Property | Value |
|----------|-------|
| **Tool** | `iris.server.namespace` |
| **Method** | `GET` |
| **URL** | `/api/atelier/v{n}/{namespace}` |
| **Min API Version** | v1 |
| **Scope** | NS |
| **Request Body** | None |

**Response** (`result`):
```json
{
  "name": "USER",
  "databases": { "default": "USER", "routine": "IRISSYS" },
  "features": ["SQL", "Objects", "WebServices"],
  "enabled": true
}
```

**Note**: No trailing slash on the namespace path.

**Source**: `irislib/%Atelier/v7.cls` (GetNamespace)

---

### 4. Get Document

| Property | Value |
|----------|-------|
| **Tool** | `iris.doc.get` |
| **Method** | `GET` |
| **URL** | `/api/atelier/v{n}/{ns}/doc/{docName}` |
| **Min API Version** | v1 |
| **Scope** | NS |

**Query Parameters**:
| Param | Type | Description |
|-------|------|-------------|
| `format` | `udl` \| `xml` | Output format (default: udl) |

**Response** (`result`):
```json
{
  "name": "MyApp.Service.cls",
  "content": ["Class MyApp.Service {", "}"]
}
```

**Source**: `irislib/%Atelier/v7.cls` (GetDoc), `irislib/%Api/Atelier/v7.cls`

---

### 5. Get Document Metadata (HEAD)

| Property | Value |
|----------|-------|
| **Tool** | `iris.doc.get` (metadataOnly mode) |
| **Method** | `HEAD` |
| **URL** | `/api/atelier/v{n}/{ns}/doc/{docName}` |
| **Min API Version** | v1 |
| **Scope** | NS |

**Response Headers**:
- `Last-Modified`: RFC 7231 date string
- `ETag`: Opaque version tag

Returns HTTP 404 if document does not exist.

---

### 6. Put Document

| Property | Value |
|----------|-------|
| **Tool** | `iris.doc.put` |
| **Method** | `PUT` |
| **URL** | `/api/atelier/v{n}/{ns}/doc/{docName}` |
| **Min API Version** | v1 |
| **Scope** | NS |

**Query Parameters**:
| Param | Type | Description |
|-------|------|-------------|
| `ignoreConflict` | `1` | Overwrite even when server copy is newer |

**Request Body**:
```json
{
  "enc": false,
  "content": ["Class MyApp.Service {", "  Property Name As %String;", "}"]
}
```

**Response** (`result`):
```json
{ "name": "MyApp.Service.cls" }
```

**Source**: `irislib/%Atelier/v7.cls` (PutDoc)

---

### 7. Delete Document

| Property | Value |
|----------|-------|
| **Tool** | `iris.doc.delete` |
| **Method** | `DELETE` |
| **URL** | `/api/atelier/v{n}/{ns}/doc/{docName}` |
| **Min API Version** | v1 |
| **Scope** | NS |
| **Request Body** | None |

**Note**: For batch deletes, individual DELETE requests are sent per document.

**Source**: `irislib/%Atelier/v7.cls` (DeleteDoc)

---

### 8. List Documents (docnames)

| Property | Value |
|----------|-------|
| **Tool** | `iris.doc.list` |
| **Method** | `GET` |
| **URL** | `/api/atelier/v{n}/{ns}/docnames/{category}/{type}` |
| **Min API Version** | v1 |
| **Scope** | NS |

**Path Segments**:
| Segment | Values | Description |
|---------|--------|-------------|
| `category` | `CLS`, `RTN`, `CSP`, `OTH`, `*` | Document category |
| `type` | `cls`, `mac`, `int`, `inc`, `*` | Document type within category |

**Query Parameters**:
| Param | Type | Description |
|-------|------|-------------|
| `filter` | string | Substring filter on names (e.g., `MyApp.*`) |
| `generated` | `1` \| `0` | Include generated documents |

**Response** (`result`): Array of document objects:
```json
[
  { "name": "MyApp.Service.cls", "cat": "CLS" },
  { "name": "MyApp.Utils.cls", "cat": "CLS" }
]
```

**Source**: `irislib/%Atelier/v7.cls` (GetDocNames)

---

### 9. List Modified Documents

| Property | Value |
|----------|-------|
| **Tool** | `iris.doc.list` (modifiedSince mode) |
| **Method** | `GET` |
| **URL** | `/api/atelier/v{n}/{ns}/modified/{timestamp}` |
| **Min API Version** | v1 |
| **Scope** | NS |

**Path Parameters**:
| Param | Format | Description |
|-------|--------|-------------|
| `timestamp` | ISO 8601 (URL-encoded) | Only return docs modified after this time |

**Response** (`result`): Array of modified document objects:
```json
[
  { "name": "MyApp.Updated.cls", "ts": "2026-04-05T12:00:00Z" }
]
```

---

### 10. Compile Documents

| Property | Value |
|----------|-------|
| **Tool** | `iris.doc.compile` |
| **Method** | `POST` |
| **URL** | `/api/atelier/v{n}/{ns}/action/compile` |
| **Min API Version** | v1 |
| **Scope** | NS |

**Query Parameters**:
| Param | Type | Description |
|-------|------|-------------|
| `flags` | string | Compilation flags (e.g., `ck`, `cku`) |
| `async` | `1` | Queue async compilation, return job ID |

**Request Body**: Array of document names:
```json
["MyApp.Service.cls", "MyApp.Utils.cls"]
```

**Response (sync)** (`result`):
```json
{
  "content": [
    { "name": "MyApp.Service.cls", "status": "OK", "errors": [] },
    { "name": "Bad.cls", "status": "ERROR", "errors": [
      { "error": "ERROR #5540: Expected '}' but found EOF", "line": 15, "char": 1 }
    ]}
  ]
}
```

**Response (async)** (`result`): Tracking object with job ID.

**Source**: `irislib/%Atelier/v7.cls` (Compile)

---

### 11. Document Index (Class Structure)

| Property | Value |
|----------|-------|
| **Tool** | `iris.doc.index` |
| **Method** | `POST` |
| **URL** | `/api/atelier/v{n}/{ns}/action/index` |
| **Min API Version** | v1 |
| **Scope** | NS |

**Request Body**: Array of document names:
```json
["MyApp.Service.cls"]
```

**Response** (`result`):
```json
{
  "content": [
    {
      "name": "MyApp.Service.cls",
      "content": [
        { "name": "Name", "member": "Property", "type": "%String" },
        { "name": "DoWork", "member": "Method", "args": "(pInput:%String)" },
        { "name": "TIMEOUT", "member": "Parameter", "default": "30" }
      ],
      "super": ["%RegisteredObject"]
    }
  ]
}
```

**Source**: `irislib/%Atelier/v7.cls` (Index)

---

### 12. Search Documents

| Property | Value |
|----------|-------|
| **Tool** | `iris.doc.search` |
| **Method** | `GET` |
| **URL** | `/api/atelier/v{n}/{ns}/action/search` |
| **Min API Version** | v2 |
| **Scope** | NS |

**Query Parameters**:
| Param | Type | Description |
|-------|------|-------------|
| `query` | string (required) | Search text or regex |
| `regex` | `1` \| `0` | Treat query as regex |
| `word` | `1` \| `0` | Whole-word matching |
| `case` | `1` \| `0` | Case-sensitive search |
| `wild` | `1` \| `0` | Enable wildcard matching |
| `files` | string | File pattern filter (e.g., `*.cls,*.mac`) |
| `sys` | `1` \| `0` | Include system items |
| `gen` | `1` \| `0` | Include generated items |
| `max` | number | Max results |

**Response** (`result`): Array of match objects:
```json
[
  { "doc": "MyApp.Service.cls", "line": 10, "text": "Set tResult = $$$OK" }
]
```

**Source**: `irislib/%Atelier/v7.cls` (Search)

---

### 13. Get Macro Definition

| Property | Value |
|----------|-------|
| **Tool** | `iris.macro.info` |
| **Method** | `POST` |
| **URL** | `/api/atelier/v{n}/{ns}/action/getmacrodefinition` |
| **Min API Version** | v2 |
| **Scope** | NS |

**Request Body**:
```json
{
  "docname": "MyApp.Service.cls",
  "macroname": "ISERR",
  "includes": ["%occStatus"]
}
```

**Response** (`result`):
```json
{
  "definition": "$select($get(sc)=1:1,1:0)"
}
```

**Source**: `irislib/%Atelier/v7.cls` (GetMacroDefinition)

---

### 14. Get Macro Location

| Property | Value |
|----------|-------|
| **Tool** | `iris.macro.info` |
| **Method** | `POST` |
| **URL** | `/api/atelier/v{n}/{ns}/action/getmacrolocation` |
| **Min API Version** | v2 |
| **Scope** | NS |

**Request Body**: Same as Get Macro Definition.

**Response** (`result`):
```json
{
  "document": "%occStatus.inc",
  "line": 42
}
```

**Source**: `irislib/%Atelier/v7.cls` (GetMacroLocation)

---

### 15. Execute SQL Query

| Property | Value |
|----------|-------|
| **Tool** | `iris.sql.execute` |
| **Method** | `POST` |
| **URL** | `/api/atelier/v{n}/{ns}/action/query` |
| **Min API Version** | v1 |
| **Scope** | NS |

**Request Body**:
```json
{
  "query": "SELECT ID, Name FROM Sample.Person WHERE ID = ?",
  "parameters": [1]
}
```

**Response** (`result`):
```json
{
  "content": [
    { "ID": 1, "Name": "Smith", "DOB": "1990-01-01" },
    { "ID": 2, "Name": "Jones", "DOB": "1985-06-15" }
  ]
}
```

**Note**: Rows are returned as key-value objects (column names as keys), not as `{ columns, rows }` arrays.

**Source**: `irislib/%Atelier/v7.cls` (Query)

---

### 16. Convert Document Format

| Property | Value |
|----------|-------|
| **Tool** | `iris.doc.convert` |
| **Method** | `GET` |
| **URL** | `/api/atelier/v{n}/{ns}/doc/{docName}?format={udl|xml}` |
| **Min API Version** | v1 |
| **Scope** | NS |

Uses the same endpoint as Get Document (endpoint #4) with the `format` query parameter. Included here because it is exposed as a separate tool.

---

### 17. XML Export

| Property | Value |
|----------|-------|
| **Tool** | `iris.doc.xml_export` (action=export) |
| **Method** | `POST` |
| **URL** | `/api/atelier/v{n}/{ns}/action/xml/export` |
| **Min API Version** | v7 |
| **Scope** | NS |

**Request Body**: Array of document names:
```json
["MyApp.Service.cls", "MyApp.Utils.cls"]
```

**Response** (`result`):
```json
{
  "content": ["<?xml version=\"1.0\"?>", "<Export>", "</Export>"]
}
```

**Source**: `irislib/%Atelier/v7.cls` (XmlExport)

---

### 18. XML Import (Load)

| Property | Value |
|----------|-------|
| **Tool** | `iris.doc.xml_export` (action=import) |
| **Method** | `POST` |
| **URL** | `/api/atelier/v{n}/{ns}/action/xml/load` |
| **Min API Version** | v7 |
| **Scope** | NS |

**Request Body**: Array of file objects:
```json
[
  {
    "file": "import.xml",
    "content": ["<?xml version=\"1.0\"?>", "<Export>", "<Class name=\"MyApp.Service\"></Class>", "</Export>"]
  }
]
```

**Response** (`result`):
```json
{
  "content": [
    { "file": "import.xml", "imported": ["MyApp.Service.cls"], "status": "OK" }
  ]
}
```

**Source**: `irislib/%Atelier/v7.cls` (XmlLoad)

---

### 19. XML List

| Property | Value |
|----------|-------|
| **Tool** | `iris.doc.xml_export` (action=list) |
| **Method** | `POST` |
| **URL** | `/api/atelier/v{n}/{ns}/action/xml/list` |
| **Min API Version** | v7 |
| **Scope** | NS |

**Request Body**: Same format as XML Import.

**Response** (`result`):
```json
{
  "content": [
    {
      "file": "import.xml",
      "documents": [
        { "name": "MyApp.Service.cls", "ts": "2026-04-05T12:00:00Z" }
      ],
      "status": "OK"
    }
  ]
}
```

**Source**: `irislib/%Atelier/v7.cls` (XmlList)

---

## Version Requirements Summary

| Min Version | Endpoints |
|-------------|-----------|
| v1 | Server info, health, namespace, doc CRUD, docnames, modified, compile, index, query |
| v2 | Search, macro definition, macro location |
| v7 | XML export, XML import/load, XML list |

## IRIS Library Source References

| Source Class | Role |
|-------------|------|
| `irislib/%Atelier/REST.cls` | CSP dispatch class mapping URLs to handler methods |
| `irislib/%Atelier/v7.cls` | Version 7 handler implementing all endpoint actions |
| `irislib/%Atelier/v1.cls` - `v6.cls` | Earlier version handlers (incremental feature additions) |
| `irislib/%Api/Atelier/v7.cls` | Internal API implementation backing the REST handlers |
| `irislib/%Api/Atelier.cls` | Base API utilities shared across versions |

## References

- [InterSystems Atelier REST API Documentation](https://docs.intersystems.com/iris20241/csp/docbook/DocBook.UI.Page.cls?KEY=ATELIERWEB)
- Source: `packages/iris-dev-mcp/src/tools/` (doc.ts, compile.ts, format.ts, intelligence.ts, sql.ts, server.ts)
- Source: `packages/shared/src/atelier.ts` (version negotiation, path builder)
- Source: `packages/shared/src/health.ts` (health check / ping)
