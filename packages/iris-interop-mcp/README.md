# @iris-mcp/interop

**IRIS Interoperability MCP Server** -- Ensemble/Health Connect production lifecycle, credentials, lookup tables, business rules, data transformations, and REST API management via the Model Context Protocol.

Part of the [IRIS MCP Server Suite](../../README.md).

---

## Installation

```bash
npm install -g @iris-mcp/interop
```

Or run directly without installing:

```bash
npx @iris-mcp/interop
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
    "iris-interop-mcp": {
      "command": "npx",
      "args": ["-y", "@iris-mcp/interop"],
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
    "iris-interop-mcp": {
      "command": "npx",
      "args": ["-y", "@iris-mcp/interop"],
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
  "iris-interop-mcp": {
    "command": "npx",
    "args": ["-y", "@iris-mcp/interop"],
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

### Production Lifecycle Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_production_manage` | Create or delete a production | `action`, `name`, `namespace?` | destructive |
| `iris_production_control` | Start, stop, restart, update, or recover | `action`, `name?`, `timeout?`, `force?`, `namespace?` | -- |
| `iris_production_status` | Get production status with optional detail | `detail?`, `namespace?` | readOnly, idempotent |
| `iris_production_summary` | Cross-namespace production summary | `cursor?` | readOnly, idempotent |

### Production Item & Config Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_production_item` | Enable, disable, get, or set config item settings | `action`, `itemName`, `settings?`, `namespace?` | -- |
| `iris_production_autostart` | Get or set auto-start configuration | `action`, `productionName?`, `namespace?` | -- |

### Production Monitoring Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_production_logs` | Query event log entries | `type?`, `itemName?`, `count?`, `namespace?` | readOnly, idempotent |
| `iris_production_queues` | Queue status for all production items | `namespace?` | readOnly, idempotent |
| `iris_production_messages` | Trace message flow by session or header ID | `sessionId?`, `headerId?`, `count?`, `namespace?` | readOnly, idempotent |
| `iris_production_adapters` | List available adapter types | `category?`, `namespace?` | readOnly, idempotent |

### Credential Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_credential_manage` | Create, update, or delete credentials | `action`, `id`, `username?`, `password?`, `namespace?` | destructive |
| `iris_credential_list` | List all credentials (passwords never returned) | `namespace?` | readOnly, idempotent |

### Lookup Table Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_lookup_manage` | Get, set, or delete lookup table entries | `action`, `tableName`, `key`, `value?`, `namespace?` | destructive |
| `iris_lookup_transfer` | Export or import lookup tables as XML | `action`, `tableName`, `xml?`, `namespace?` | destructive |

### Business Rule Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_rule_list` | List all business rule classes | `namespace?` | readOnly, idempotent |
| `iris_rule_get` | Get full rule definition with conditions and actions | `name`, `namespace?` | readOnly, idempotent |

### Data Transformation Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_transform_list` | List all DTL transform classes | `namespace?` | readOnly, idempotent |
| `iris_transform_test` | Execute a transformation against sample input | `className`, `sourceClass`, `sourceData?`, `namespace?` | idempotent |

### REST API Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_interop_rest` | Create, delete, or get a REST application | `action`, `name`, `spec?`, `namespace?` | destructive |

---

## Tool Examples

<details>
<summary><strong>iris_production_manage</strong> -- Create a production</summary>

**Input:**
```json
{
  "action": "create",
  "name": "MyApp.Production",
  "namespace": "USER"
}
```

**Output:**
```json
{
  "action": "create",
  "name": "MyApp.Production",
  "status": "created"
}
```
</details>

<details>
<summary><strong>iris_production_control</strong> -- Start a production</summary>

All five actions (`start`, `stop`, `restart`, `update`, `recover`) are verified to work. `start` and `restart` require `name`; `stop`, `update`, and `recover` do not.

**Input:**
```json
{
  "action": "start",
  "name": "MyApp.Production"
}
```

**Output:**
```json
{
  "action": "start",
  "name": "MyApp.Production",
  "status": "Running"
}
```
</details>

<details>
<summary><strong>iris_production_status</strong> -- Get production status</summary>

**Input:**
```json
{
  "detail": true,
  "namespace": "USER"
}
```

**Output:**
```json
{
  "name": "MyApp.Production",
  "state": "Running",
  "stateCode": 1,
  "items": [
    { "name": "MyApp.Service.FileIn", "className": "MyApp.Service.FileIn", "enabled": true, "adapter": "EnsLib.File.InboundAdapter" }
  ]
}
```
</details>

<details>
<summary><strong>iris_production_summary</strong> -- Cross-namespace summary</summary>

**Input:**
```json
{}
```

**Output:**
```json
{
  "productions": [
    { "namespace": "USER", "name": "MyApp.Production", "state": "Running", "stateCode": 1 },
    { "namespace": "HSLIB", "name": "HS.Production", "state": "Stopped", "stateCode": 2 }
  ],
  "count": 2
}
```
</details>

<details>
<summary><strong>iris_production_item</strong> -- Get config item settings</summary>

**Input:**
```json
{
  "action": "get",
  "itemName": "MyApp.Service.FileIn"
}
```

**Output:**
```json
{
  "itemName": "MyApp.Service.FileIn",
  "className": "MyApp.Service.FileIn",
  "enabled": true,
  "settings": {
    "FilePath": "/data/incoming",
    "FileSpec": "*.txt"
  }
}
```
</details>

<details>
<summary><strong>iris_production_autostart</strong> -- Get auto-start config</summary>

**Input:**
```json
{
  "action": "get"
}
```

**Output:**
```json
{
  "productionName": "MyApp.Production",
  "enabled": true
}
```
</details>

<details>
<summary><strong>iris_production_logs</strong> -- Query event logs</summary>

**Input:**
```json
{
  "type": "Error",
  "count": 10
}
```

**Output:**
```json
{
  "entries": [
    { "timestamp": "2026-04-07 10:30:00", "type": "Error", "itemName": "MyApp.Operation.SendEmail", "message": "SMTP connection timeout" }
  ],
  "count": 1
}
```
</details>

<details>
<summary><strong>iris_production_queues</strong> -- Queue status</summary>

**Input:**
```json
{}
```

**Output:**
```json
{
  "queues": [
    { "itemName": "MyApp.Service.FileIn", "count": 0 },
    { "itemName": "MyApp.Process.Router", "count": 3 }
  ]
}
```
</details>

<details>
<summary><strong>iris_production_messages</strong> -- Trace messages</summary>

**Input:**
```json
{
  "sessionId": 12345
}
```

**Output:**
```json
{
  "messages": [
    { "headerId": 12345, "source": "MyApp.Service.FileIn", "target": "MyApp.Process.Router", "messageClass": "Ens.StringRequest", "timestamp": "2026-04-07 10:30:00", "status": "Completed" }
  ]
}
```
</details>

<details>
<summary><strong>iris_production_adapters</strong> -- List adapters</summary>

**Input:**
```json
{
  "category": "inbound"
}
```

**Output:**
```json
{
  "adapters": [
    { "name": "EnsLib.File.InboundAdapter", "category": "inbound" },
    { "name": "EnsLib.HTTP.InboundAdapter", "category": "inbound" },
    { "name": "EnsLib.SQL.InboundAdapter", "category": "inbound" }
  ]
}
```
</details>

<details>
<summary><strong>iris_credential_manage</strong> -- Create a credential</summary>

**Input:**
```json
{
  "action": "create",
  "id": "SMTP-Relay",
  "username": "notifications@myapp.com",
  "password": "smtp-secret-123"
}
```

**Output:**
```json
{
  "action": "create",
  "id": "SMTP-Relay",
  "status": "created"
}
```
</details>

<details>
<summary><strong>iris_credential_list</strong> -- List credentials</summary>

**Input:**
```json
{}
```

**Output:**
```json
{
  "credentials": [
    { "id": "SMTP-Relay", "username": "notifications@myapp.com" }
  ],
  "count": 1
}
```
</details>

<details>
<summary><strong>iris_lookup_manage</strong> -- Set a lookup entry</summary>

**Input:**
```json
{
  "action": "set",
  "tableName": "EmailRouting",
  "key": "support",
  "value": "support@myapp.com"
}
```

**Output:**
```json
{
  "action": "set",
  "tableName": "EmailRouting",
  "key": "support",
  "value": "support@myapp.com"
}
```
</details>

<details>
<summary><strong>iris_lookup_transfer</strong> -- Export lookup table</summary>

**Input:**
```json
{
  "action": "export",
  "tableName": "EmailRouting"
}
```

**Output:**
```json
{
  "xml": "<lookupTable name=\"EmailRouting\"><entry key=\"support\" value=\"support@myapp.com\"/></lookupTable>"
}
```
</details>

<details>
<summary><strong>iris_rule_list</strong> -- List business rules</summary>

**Input:**
```json
{}
```

**Output:**
```json
{
  "rules": ["MyApp.Rules.MessageRouting", "MyApp.Rules.ErrorHandling"],
  "count": 2
}
```
</details>

<details>
<summary><strong>iris_rule_get</strong> -- Get rule definition</summary>

**Input:**
```json
{
  "name": "MyApp.Rules.MessageRouting"
}
```

**Output:**
```json
{
  "name": "MyApp.Rules.MessageRouting",
  "content": "Class MyApp.Rules.MessageRouting Extends Ens.Rule.Definition\n{\nXData RuleDefinition [ XMLNamespace = \"http://www.intersystems.com/rule\" ]\n{\n<ruleDefinition>...</ruleDefinition>\n}\n}"
}
```
</details>

<details>
<summary><strong>iris_transform_list</strong> -- List DTL transforms</summary>

**Input:**
```json
{}
```

**Output:**
```json
{
  "transforms": ["MyApp.Transforms.InputToCanonical", "MyApp.Transforms.CanonicalToHL7"],
  "count": 2
}
```
</details>

<details>
<summary><strong>iris_transform_test</strong> -- Test a transformation</summary>

**Input:**
```json
{
  "className": "MyApp.Transforms.InputToCanonical",
  "sourceClass": "MyApp.Messages.InputMessage",
  "sourceData": { "PatientName": "Smith,John", "DOB": "1990-01-15" }
}
```

**Output (target extends `%JSON.Adaptor`):**
```json
{
  "className": "MyApp.Transforms.InputToCanonical",
  "sourceClass": "MyApp.Messages.InputMessage",
  "output": {
    "className": "MyApp.Messages.CanonicalMessage",
    "serialization": "json-adaptor",
    "data": {
      "Name": "John Smith",
      "DateOfBirth": "1990-01-15"
    }
  }
}
```

**Output (target does not extend `%JSON.Adaptor` — e.g., most `Ens.*` internal classes):**

The response falls back to a best-effort reflection over the target's public non-calculated non-relationship properties. `data` is a real object of property values (object-valued properties are rendered as `[object <ClassName>]` placeholders), and a `note` explains the caveat. Use the `serialization` field to branch on which mode was used.

```json
{
  "className": "Ens.SSH.InteractiveAuth.DTL",
  "sourceClass": "Ens.SSH.InteractiveAuth.Challenge",
  "output": {
    "className": "Ens.SSH.InteractiveAuth.Response",
    "serialization": "property-reflection",
    "data": {
      "Responses": "[object %Collection.ArrayOfDT]",
      "UseCredentialsPasswordAt": 1,
      "UseSFTPPassphraseCredentialsPasswordAt": 0
    },
    "propertyCount": 3,
    "note": "Target class does not extend %JSON.Adaptor; values shown are a best-effort property dump (objects and streams are represented as placeholders)."
  }
}
```
</details>

<details>
<summary><strong>iris_interop_rest</strong> -- Create REST application</summary>

**Input:**
```json
{
  "action": "create",
  "name": "/myapi",
  "spec": { "openapi": "3.0.0", "info": { "title": "My API", "version": "1.0" }, "paths": {} }
}
```

**Output:**
```json
{
  "action": "create",
  "name": "/myapi",
  "status": "created"
}
```
</details>

---

## Namespace Scoping

All 19 interoperability tools operate in the context of a specific IRIS namespace. Productions, credentials, lookup tables, rules, and transforms are all namespace-scoped resources.

**Tools that accept the `namespace` parameter** (all except `iris_production_summary`):
- All production lifecycle, item, and monitoring tools
- All credential, lookup, rule, transform, and REST tools

`iris_production_summary` does **not** accept a namespace parameter -- it iterates all namespaces automatically and returns a cross-namespace view.

**Important:** The target namespace must have Ensemble/Interoperability enabled. Namespaces without the Ensemble mappings will return errors when querying production status or items.

---

## Error Handling

### Common Errors

| Error | Cause | Resolution |
|-------|-------|------------|
| `IRIS connection refused` | IRIS web server not running or wrong host/port | Verify `IRIS_HOST` and `IRIS_PORT` settings |
| `401 Unauthorized` | Invalid credentials or insufficient privileges | Check credentials; interop operations may require `%Ens_*` resources |
| `Production not found` | No production configured in the namespace | Use `iris_production_manage` to create one, or check the namespace |
| `Production must be stopped` | Attempting to delete a running production | Stop the production first with `iris_production_control` |
| `Config item not found` | Invalid item name | Check item names with `iris_production_status` (detail=true) |
| `at least one of sessionId or headerId is required` | Missing filter for message trace | Provide either `sessionId` or `headerId` |
| `Custom REST endpoint not found` | Bootstrap has not completed | The server auto-bootstraps on first connection; save the web app via SMP if 404 persists |

### Error Response Format

```json
{
  "content": [{ "type": "text", "text": "Error controlling production: <details>" }],
  "isError": true
}
```

Credential passwords are **never** included in responses (NFR6 security requirement).

---

[Back to IRIS MCP Server Suite](../../README.md)
