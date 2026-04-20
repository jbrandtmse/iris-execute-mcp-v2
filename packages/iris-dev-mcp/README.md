# @iris-mcp/dev

**IRIS Development Tools MCP Server** -- ObjectScript document CRUD, compilation, SQL execution, globals management, code execution, unit testing, package browsing, and bulk export via the Model Context Protocol.

Part of the [IRIS MCP Server Suite](../../README.md).

---

## Installation

```bash
npm install -g @iris-mcp/dev
```

Or run directly without installing:

```bash
npx @iris-mcp/dev
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
    "iris-dev-mcp": {
      "command": "npx",
      "args": ["-y", "@iris-mcp/dev"],
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
    "iris-dev-mcp": {
      "command": "npx",
      "args": ["-y", "@iris-mcp/dev"],
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

Add to your Cursor MCP settings:

```json
{
  "iris-dev-mcp": {
    "command": "npx",
    "args": ["-y", "@iris-mcp/dev"],
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

## Tool Reference

### Document Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_doc_get` | Retrieve a document by name (UDL or XML format) | `name`, `namespace?`, `format?`, `metadataOnly?` | readOnly, idempotent |
| `iris_doc_put` | Create or update a document on IRIS | `name`, `content`, `namespace?`, `ignoreConflict?` | idempotent |
| `iris_doc_delete` | Delete one or more documents | `name` (string or array), `namespace?` | destructive, idempotent |
| `iris_doc_list` | List documents with optional filters | `category?`, `type?`, `filter?`, `generated?`, `namespace?`, `modifiedSince?`, `cursor?` | readOnly, idempotent |
| `iris_doc_load` | Bulk upload files from disk into IRIS | `path` (glob), `compile?`, `flags?`, `namespace?`, `ignoreConflict?` | idempotent |
| `iris_doc_export` | Bulk-download documents to a local directory (inverse of `iris_doc_load`) | `destinationDir`, `prefix?`, `category?`, `type?`, `generated?`, `system?`, `modifiedSince?`, `namespace?`, `includeManifest?`, `ignoreErrors?`, `useShortPaths?`, `overwrite?`, `continueDownloadOnTimeout?` | idempotent |

### Package Browsing Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_package_list` | Roll up namespace documents into packages at a chosen depth | `depth?`, `prefix?`, `category?`, `type?`, `generated?`, `system?`, `modifiedSince?`, `namespace?` | readOnly, idempotent |

### Compilation Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_doc_compile` | Compile one or more documents | `doc` (string or array), `flags?`, `async?`, `namespace?` | idempotent |

### Code Intelligence Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_doc_index` | Get class structure (methods, properties, superclasses) | `name`, `namespace?` | readOnly, idempotent |
| `iris_doc_search` | Search across code with regex/wildcard options | `query`, `regex?`, `word?`, `case?`, `wild?`, `files?`, `sys?`, `gen?`, `max?`, `namespace?` | readOnly, idempotent |
| `iris_macro_info` | Look up macro definitions and source locations | `name`, `document?`, `includes?`, `namespace?` | readOnly, idempotent |

### Format and Export Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_doc_convert` | Convert document between UDL and XML | `name`, `targetFormat`, `namespace?` | readOnly, idempotent |
| `iris_doc_xml_export` | Export, import, or list documents in XML format | `action`, `docs?`, `content?`, `namespace?` | destructive (import) |

### SQL Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_sql_execute` | Execute a SQL query with parameterized values | `query`, `parameters?`, `maxRows?`, `namespace?` | -- |

### Server Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_server_info` | Get IRIS version, platform, instance name | *(none)* | readOnly, idempotent |
| `iris_server_namespace` | Get namespace details and features | `namespace?` | readOnly, idempotent |

### Global Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_global_get` | Read a global node value | `global`, `subscripts?`, `namespace?` | readOnly, idempotent |
| `iris_global_set` | Set a global node value (verified) | `global`, `value`, `subscripts?`, `namespace?` | idempotent |
| `iris_global_kill` | Delete a global node or subtree | `global`, `subscripts?`, `namespace?` | destructive, idempotent |
| `iris_global_list` | List globals with optional filter | `filter?`, `cursor?`, `namespace?` | readOnly, idempotent |

### Execution Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_execute_command` | Execute an ObjectScript command | `command`, `namespace?` | -- |
| `iris_execute_classmethod` | Invoke a class method with arguments | `className`, `methodName`, `args?`, `namespace?` | -- |
| `iris_execute_tests` | Run unit tests (package, class, or method level) | `target`, `level`, `namespace?` | readOnly, idempotent |

---

## Tool Examples

<details>
<summary><strong>iris_doc_get</strong> -- Retrieve a document</summary>

**Input:**
```json
{
  "name": "MyApp.Service.cls",
  "namespace": "USER"
}
```

**Output:**
```json
{
  "name": "MyApp.Service.cls",
  "content": ["Class MyApp.Service {", "", "ClassMethod Hello() As %String", "{", "  Quit \"Hello World\"", "}", "", "}"],
  "ts": "2026-04-07T10:30:00.000Z"
}
```
</details>

<details>
<summary><strong>iris_doc_put</strong> -- Create or update a document</summary>

**Input:**
```json
{
  "name": "MyApp.Utils.cls",
  "content": "Class MyApp.Utils {\n\nClassMethod Add(a As %Integer, b As %Integer) As %Integer\n{\n  Quit a + b\n}\n\n}"
}
```

**Output:**
```json
"Document 'MyApp.Utils.cls' saved successfully in namespace 'USER'."
```
</details>

<details>
<summary><strong>iris_doc_delete</strong> -- Delete documents</summary>

**Input:**
```json
{
  "name": ["MyApp.Temp1.cls", "MyApp.Temp2.cls"]
}
```

**Output:**
```json
"2 document(s) deleted from namespace 'USER': MyApp.Temp1.cls, MyApp.Temp2.cls"
```
</details>

<details>
<summary><strong>iris_doc_list</strong> -- List documents</summary>

**Input:**
```json
{
  "category": "CLS",
  "filter": "MyApp"
}
```

**Output:**
```json
{
  "items": [
    { "name": "MyApp.Service.cls", "ts": "2026-04-07T10:30:00Z" },
    { "name": "MyApp.Utils.cls", "ts": "2026-04-07T10:25:00Z" }
  ]
}
```
</details>

<details>
<summary><strong>iris_doc_load</strong> -- Bulk load from disk</summary>

**Input:**
```json
{
  "path": "c:/projects/myapp/src/**/*.cls",
  "compile": true
}
```

**Output:**
```json
{
  "total": 5,
  "uploaded": 5,
  "failed": 0,
  "compilationResult": {
    "success": true,
    "documents": ["MyApp.Service.cls", "MyApp.Utils.cls", "MyApp.Model.cls", "MyApp.REST.cls", "MyApp.Tests.cls"]
  }
}
```
</details>

<details>
<summary><strong>iris_doc_export</strong> -- Bulk download documents to a local directory</summary>

**Input (happy path — export a namespace subtree):**
```json
{
  "destinationDir": "C:/dev/iris-export",
  "prefix": "MyApp",
  "category": "CLS",
  "namespace": "USER"
}
```

**Output:**
```json
{
  "destinationDir": "C:/dev/iris-export",
  "namespace": "USER",
  "filtersApplied": {
    "prefix": "MyApp",
    "category": "CLS",
    "type": "*",
    "generated": "false",
    "system": "false"
  },
  "total": 5,
  "exported": 5,
  "skipped": 0,
  "skippedItems": [],
  "manifest": "C:/dev/iris-export/manifest.json",
  "durationMs": 412
}
```

Files are written to `C:/dev/iris-export/MyApp/Service.cls`, `C:/dev/iris-export/MyApp/Utils.cls`, etc. Dots in dotted class names become subdirectories; CSP paths keep their forward slashes.

**Input (Windows long-path — needs `useShortPaths`):**
```json
{
  "destinationDir": "C:/dev/iris-export",
  "prefix": "EnsLib.HL7",
  "namespace": "USER"
}
```

**Output with skippedItems:**
```json
{
  "destinationDir": "C:/dev/iris-export",
  "namespace": "USER",
  "filtersApplied": { "prefix": "EnsLib.HL7", "category": "*", "type": "*", "generated": "false", "system": "false" },
  "total": 42,
  "exported": 40,
  "skipped": 2,
  "skippedItems": [
    {
      "docName": "EnsLib.HL7.MessageRouter.VeryLongClassNameThatExceedsMaxPath.cls",
      "reason": "ENAMETOOLONG: local path exceeds 260 characters on Windows",
      "hint": "Rerun with useShortPaths: true, or enable Windows long-path support in the registry (LongPathsEnabled)."
    },
    {
      "docName": "EnsLib.HL7.MessageRouter.AnotherVeryLongClassName.cls",
      "reason": "ENAMETOOLONG: local path exceeds 260 characters on Windows",
      "hint": "Rerun with useShortPaths: true, or enable Windows long-path support in the registry (LongPathsEnabled)."
    }
  ],
  "manifest": "C:/dev/iris-export/manifest.json",
  "durationMs": 3821
}
```

**Excerpt of `manifest.json`:**
```json
{
  "namespace": "USER",
  "exportedAt": "2026-04-20T15:30:00.000Z",
  "filtersApplied": { "prefix": "EnsLib.HL7", "category": "*", "type": "*", "generated": "false", "system": "false" },
  "files": [
    { "docName": "EnsLib.HL7.Adapter.TCPInboundAdapter.cls", "localPath": "EnsLib/HL7/Adapter/TCPInboundAdapter.cls", "bytes": 2847 },
    { "docName": "EnsLib.HL7.Service.Standard.cls", "localPath": "EnsLib/HL7/Service/Standard.cls", "bytes": 5219 }
  ],
  "skipped": [
    {
      "docName": "EnsLib.HL7.MessageRouter.VeryLongClassNameThatExceedsMaxPath.cls",
      "reason": "ENAMETOOLONG: local path exceeds 260 characters on Windows",
      "hint": "Rerun with useShortPaths: true, or enable Windows long-path support in the registry (LongPathsEnabled)."
    }
  ],
  "shortPathMap": null
}
```

> **Note on CSP static assets in system namespaces.** The Atelier API lists static web files (CSS, JS, images under `/csp/…/*.css`, `*.js`, etc.) in `docnames` but returns HTTP 404 for those paths on `GET /doc/{name}` — they're served by the CSP Gateway, not stored in an Atelier-accessible store. A full export of a namespace like `%SYS` (or any namespace mapping IRIS system CSP routes) will therefore produce a large `skippedItems` list — on a stock IRIS 2025.1 `%SYS` namespace, ~2,174 of 6,131 docnames fall into this bucket. This is an **IRIS-side asymmetry, not a tool defect**. To avoid the noise when you only want code, pass **`category: "CLS"`** (classes) or **`category: "RTN"`** (routines + include files) — these restrict `docnames` to categories whose documents are reliably retrievable.
</details>

<details>
<summary><strong>iris_package_list</strong> -- Roll up documents into packages</summary>

**Input:**
```json
{
  "prefix": "MyApp",
  "depth": 2,
  "namespace": "USER"
}
```

**Output:**
```json
{
  "packages": [
    { "name": "MyApp.Services", "count": 12 },
    { "name": "MyApp.Utils", "count": 4 },
    { "name": "MyApp.Tests", "count": 8 }
  ],
  "count": 3,
  "totalDocs": 24
}
```

For a structural overview at package granularity, use `iris_package_list`. For individual document names, use `iris_doc_list`. To pull many documents at once, see `iris_doc_export`.
</details>

<details>
<summary><strong>iris_doc_compile</strong> -- Compile documents</summary>

**Input:**
```json
{
  "doc": "MyApp.Service.cls"
}
```

**Output:**
```json
{
  "success": true,
  "documents": ["MyApp.Service.cls"],
  "compilationTime": "245ms"
}
```
</details>

<details>
<summary><strong>iris_doc_index</strong> -- Get class structure</summary>

**Input:**
```json
{
  "name": "MyApp.Service.cls"
}
```

**Output:**
```json
{
  "content": [
    {
      "name": "MyApp.Service.cls",
      "content": [
        { "name": "Hello", "cat": "method", "type": "classmethod", "returnType": "%String" }
      ]
    }
  ]
}
```
</details>

<details>
<summary><strong>iris_doc_search</strong> -- Search across code</summary>

**Input:**
```json
{
  "query": "Quit \"Hello",
  "files": "*.cls"
}
```

**Output:**
```json
{
  "matches": [
    { "doc": "MyApp.Service.cls", "line": 5, "text": "  Quit \"Hello World\"" }
  ]
}
```
</details>

<details>
<summary><strong>iris_macro_info</strong> -- Look up macro definition</summary>

**Input:**
```json
{
  "name": "OK",
  "document": "MyApp.Service.cls",
  "includes": ["%occStatus"]
}
```

**Output:**
```json
{
  "name": "OK",
  "definition": { "value": "1" },
  "location": { "file": "%occStatus.inc", "line": 3 }
}
```
</details>

<details>
<summary><strong>iris_doc_convert</strong> -- Convert document format</summary>

**Input:**
```json
{
  "name": "MyApp.Service.cls",
  "targetFormat": "xml"
}
```

**Output:**
```json
{
  "name": "MyApp.Service.cls",
  "content": ["<?xml version=\"1.0\"?>", "<Export ...>", "..."]
}
```
</details>

<details>
<summary><strong>iris_doc_xml_export</strong> -- Export to XML</summary>

**Input:**
```json
{
  "action": "export",
  "docs": ["MyApp.Service.cls"]
}
```

**Output:**
```json
{
  "content": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>..."
}
```
</details>

<details>
<summary><strong>iris_sql_execute</strong> -- Execute SQL</summary>

**Input:**
```json
{
  "query": "SELECT Name, Super FROM %Dictionary.ClassDefinition WHERE Name %STARTSWITH ?",
  "parameters": ["MyApp."],
  "maxRows": 10
}
```

**Output:**
```json
{
  "columns": ["Name", "Super"],
  "rows": [
    ["MyApp.Service", "%RegisteredObject"],
    ["MyApp.Utils", ""]
  ],
  "rowCount": 2
}
```
</details>

<details>
<summary><strong>iris_server_info</strong> -- Get server info</summary>

**Input:**
```json
{}
```

**Output:**
```json
{
  "version": "IRIS for Windows (x86-64) 2024.1",
  "platform": "Windows",
  "instanceName": "IRIS"
}
```
</details>

<details>
<summary><strong>iris_server_namespace</strong> -- Get namespace details</summary>

**Input:**
```json
{
  "namespace": "USER"
}
```

**Output:**
```json
{
  "name": "USER",
  "routineDB": "USER",
  "globalsDB": "USER"
}
```
</details>

<details>
<summary><strong>iris_global_get</strong> -- Read a global</summary>

**Input:**
```json
{
  "global": "MyData",
  "subscripts": "\"key1\""
}
```

**Output:**
```json
{
  "value": "Hello World",
  "defined": true
}
```
</details>

<details>
<summary><strong>iris_global_set</strong> -- Set a global</summary>

**Input:**
```json
{
  "global": "MyData",
  "subscripts": "\"key1\"",
  "value": "New Value"
}
```

**Output:**
```json
{
  "value": "New Value",
  "verified": true
}
```
</details>

<details>
<summary><strong>iris_global_kill</strong> -- Delete a global</summary>

**Input:**
```json
{
  "global": "TempData"
}
```

**Output:**
```json
{
  "killed": true,
  "global": "TempData"
}
```
</details>

<details>
<summary><strong>iris_global_list</strong> -- List globals</summary>

**Input:**
```json
{
  "filter": "My"
}
```

**Output:**
```json
{
  "globals": ["MyData", "MyConfig", "MyTemp"],
  "count": 3
}
```
</details>

<details>
<summary><strong>iris_execute_command</strong> -- Execute ObjectScript</summary>

**Input:**
```json
{
  "command": "Write \"Hello from IRIS\""
}
```

**Output:**
```json
{
  "output": "Hello from IRIS"
}
```
</details>

<details>
<summary><strong>iris_execute_classmethod</strong> -- Call a class method</summary>

**Input:**
```json
{
  "className": "MyApp.Utils",
  "methodName": "Add",
  "args": [3, 4]
}
```

**Output:**
```json
{
  "returnValue": "7"
}
```
</details>

<details>
<summary><strong>iris_execute_tests</strong> -- Run unit tests</summary>

**Input:**
```json
{
  "target": "MyApp.Tests",
  "level": "package"
}
```

**Output:**
```json
{
  "total": 5,
  "passed": 4,
  "failed": 1,
  "skipped": 0,
  "details": [
    { "class": "MyApp.Tests.UtilsTest", "method": "TestAdd", "status": "passed", "duration": 12, "message": "" },
    { "class": "MyApp.Tests.UtilsTest", "method": "TestBadInput", "status": "failed", "duration": 8, "message": "Expected 0, got 1" }
  ]
}
```
</details>

---

## Namespace Scoping

Most tools accept an optional `namespace` parameter to target a specific IRIS namespace. If omitted, the configured default namespace (`IRIS_NAMESPACE` environment variable) is used.

**All 23 tools in this package accept the `namespace` parameter** except:
- `iris_server_info` -- Server-level info, no namespace needed

Tools that use the Atelier REST API (doc, compile, intelligence, sql, server tools) resolve namespace via the Atelier URL path. Tools that use the custom REST endpoint (global, execute tools) pass namespace as a request parameter.

---

## Error Handling

### Common Errors

| Error | Cause | Resolution |
|-------|-------|------------|
| `IRIS connection refused` | IRIS web server not running or wrong host/port | Verify `IRIS_HOST` and `IRIS_PORT` settings; ensure the IRIS web server is running |
| `401 Unauthorized` | Invalid credentials | Check `IRIS_USERNAME` and `IRIS_PASSWORD` |
| `404 Not Found` on document operations | Document does not exist in the target namespace | Verify the document name and namespace |
| `Compilation errors` | ObjectScript syntax errors in source code | Review the error details (line/character positions) returned in the compilation result |
| `SQL error` | Invalid SQL syntax or missing table | Check the query syntax and that referenced tables exist |
| `Custom REST endpoint not found` | Bootstrap has not completed | The server auto-bootstraps on first connection; save the web app via SMP if 404 persists |
| `<NAMESPACE> error` | Target namespace does not exist | Use `iris_namespace_list` (admin server) to verify available namespaces |

### Error Response Format

All tool errors return a standard MCP error response:

```json
{
  "content": [{ "type": "text", "text": "Error description" }],
  "isError": true
}
```

Compilation errors are returned as successful tool results (not `isError: true`) with structured error details including line and character positions.

---

[Back to IRIS MCP Server Suite](../../README.md)
