# @iris-mcp/admin

**IRIS Administration MCP Server** -- Namespace, database, user, role, resource, web application, SSL/TLS, and OAuth2 management via the Model Context Protocol.

Part of the [IRIS MCP Server Suite](../../README.md).

---

## Installation

```bash
npm install -g @iris-mcp/admin
```

Or run directly without installing:

```bash
npx @iris-mcp/admin
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
    "iris-admin-mcp": {
      "command": "npx",
      "args": ["-y", "@iris-mcp/admin"],
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
    "iris-admin-mcp": {
      "command": "npx",
      "args": ["-y", "@iris-mcp/admin"],
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
  "iris-admin-mcp": {
    "command": "npx",
    "args": ["-y", "@iris-mcp/admin"],
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

### Namespace & Database Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_namespace_manage` | Create, modify, or delete a namespace | `action`, `name`, `codeDatabase?`, `dataDatabase?`, `library?`, `tempGlobals?` | destructive |
| `iris_namespace_list` | List all namespaces with DB associations | `cursor?` | readOnly, idempotent |
| `iris_database_manage` | Create, modify, or delete a database | `action`, `name`, `directory?`, `size?`, `maxSize?`, `expansionSize?`, `readOnly?`, `resource?` | destructive |
| `iris_database_list` | List all databases with size and mount status | `cursor?` | readOnly, idempotent |

### Namespace Mapping Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_mapping_manage` | Create or delete global/routine/package mappings | `action`, `type`, `namespace`, `name`, `database?`, `collation?`, `lockDatabase?`, `subscript?` | destructive |
| `iris_mapping_list` | List mappings for a namespace by type | `namespace`, `type`, `cursor?` | readOnly, idempotent |

### User & Security Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_user_manage` | Create, modify, or delete a user account | `action`, `name`, `password?`, `fullName?`, `roles?`, `enabled?`, `namespace?` | destructive |
| `iris_user_get` | Get a user or list all users | `name?`, `cursor?` | readOnly, idempotent |
| `iris_user_roles` | Add or remove a role from a user | `action`, `username`, `role` | destructive |
| `iris_user_password` | Change or validate a password | `action`, `username?`, `password` | destructive |
| `iris_permission_check` | Check user/role permissions on a resource | `target`, `resource`, `permission` | readOnly, idempotent |

### Role & Resource Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_role_manage` | Create, modify, or delete a security role | `action`, `name`, `description?`, `resources?`, `grantedRoles?` | destructive |
| `iris_role_list` | List all security roles | `cursor?` | readOnly, idempotent |
| `iris_resource_manage` | Create, modify, or delete a security resource | `action`, `name`, `description?`, `publicPermission?` | destructive |
| `iris_resource_list` | List all security resources | `cursor?` | readOnly, idempotent |

### Web Application Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_webapp_manage` | Create, modify, or delete a web application | `action`, `name`, `namespace?`, `dispatchClass?`, `enabled?`, `authEnabled?` | destructive |
| `iris_webapp_get` | Get a web application by path | `name` | readOnly, idempotent |
| `iris_webapp_list` | List all web applications | `namespace?`, `cursor?` | readOnly, idempotent |

### SSL/TLS Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_ssl_manage` | Create, modify, or delete SSL/TLS config | `action`, `name`, `certFile?`, `keyFile?`, `caFile?`, `tlsMinVersion?`, `tlsMaxVersion?`, `verifyPeer?`, `type?` | destructive |
| `iris_ssl_list` | List all SSL/TLS configurations | `cursor?` | readOnly, idempotent |

### OAuth2 Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_oauth_manage` | Create/delete OAuth2 servers/clients, OIDC discovery | `action`, `entity?`, `issuerURL?`, `name?`, `serverName?`, `clientName?` | destructive |
| `iris_oauth_list` | List all OAuth2 server definitions and clients | `cursor?` | readOnly, idempotent |

---

## Tool Examples

<details>
<summary><strong>iris_namespace_manage</strong> -- Create a namespace</summary>

**Input:**
```json
{
  "action": "create",
  "name": "MYAPP",
  "codeDatabase": "MYAPP-CODE",
  "dataDatabase": "MYAPP-DATA"
}
```

**Output:**
```json
{
  "action": "create",
  "name": "MYAPP",
  "status": "created"
}
```
</details>

<details>
<summary><strong>iris_namespace_list</strong> -- List namespaces</summary>

**Input:**
```json
{}
```

**Output:**
```json
{
  "namespaces": [
    { "name": "USER", "globals": "USER", "routines": "USER", "library": "IRISLIB", "tempGlobals": "IRISTEMP" },
    { "name": "%SYS", "globals": "IRISSYS", "routines": "IRISSYS", "library": "IRISLIB", "tempGlobals": "IRISTEMP" }
  ],
  "count": 2
}
```
</details>

<details>
<summary><strong>iris_database_manage</strong> -- Create a database</summary>

**Input:**
```json
{
  "action": "create",
  "name": "MYAPP-DATA",
  "directory": "C:\\InterSystems\\IRIS\\mgr\\myapp-data",
  "size": 100
}
```

**Output:**
```json
{
  "action": "create",
  "name": "MYAPP-DATA",
  "status": "created"
}
```
</details>

<details>
<summary><strong>iris_database_list</strong> -- List databases</summary>

**Input:**
```json
{}
```

**Output:**
```json
{
  "databases": [
    { "name": "USER", "directory": "C:\\InterSystems\\IRIS\\mgr\\user", "size": 100, "maxSize": 0, "mountAtStartup": true }
  ],
  "count": 1
}
```
</details>

<details>
<summary><strong>iris_mapping_manage</strong> -- Create a global mapping</summary>

**Input:**
```json
{
  "action": "create",
  "type": "global",
  "namespace": "USER",
  "name": "MyGlobal",
  "database": "MYAPP-DATA"
}
```

**Output:**
```json
{
  "action": "create",
  "type": "global",
  "name": "MyGlobal",
  "status": "created"
}
```
</details>

<details>
<summary><strong>iris_mapping_list</strong> -- List mappings</summary>

**Input:**
```json
{
  "namespace": "USER",
  "type": "global"
}
```

**Output:**
```json
{
  "mappings": [
    { "name": "MyGlobal", "type": "global", "namespace": "USER", "database": "MYAPP-DATA" }
  ],
  "count": 1
}
```
</details>

<details>
<summary><strong>iris_user_manage</strong> -- Create a user</summary>

**Input:**
```json
{
  "action": "create",
  "name": "AppUser",
  "password": "SecureP@ss123",
  "fullName": "Application User",
  "roles": "%Developer"
}
```

**Output:**
```json
{
  "action": "create",
  "name": "AppUser",
  "status": "created"
}
```
</details>

<details>
<summary><strong>iris_user_get</strong> -- Get user details</summary>

**Input (single user):**
```json
{
  "name": "_SYSTEM"
}
```

**Output (single user):**
```json
{
  "name": "_SYSTEM",
  "fullName": "SQL System Manager",
  "enabled": true,
  "namespace": "",
  "roles": "%All",
  "comment": "",
  "expirationDate": "",
  "changePasswordOnNextLogin": false
}
```

> **Note:** Single-user lookups echo the `name` argument back in the
> response (`Security.Users.Get` in IRIS uses `name` as a lookup key
> and does not populate it in the returned property array).

**Input (list mode):** omit `name`:
```json
{}
```

**Output (list mode):**
```json
{
  "users": [
    {
      "name": "Admin",
      "enabled": true,
      "fullName": "Administrator",
      "namespace": "",
      "roles": "%Developer,%Manager",
      "comment": "Built-in admin",
      "expirationDate": "",
      "changePasswordOnNextLogin": false
    }
  ],
  "count": 1
}
```

> **Note:** The IRIS `Security.Users:List` ROWSPEC only exposes
> `Name, Enabled, Roles, LastLoginTime, Flags`. List mode backfills
> `fullName`, `namespace`, `comment`, `expirationDate`, and
> `changePasswordOnNextLogin` via per-row `Security.Users.Get()` so
> responses carry the full set the schema advertises.
</details>

<details>
<summary><strong>iris_user_roles</strong> -- Add role to user</summary>

**Input:**
```json
{
  "action": "add",
  "username": "AppUser",
  "role": "%Operator"
}
```

**Output:**
```json
{
  "username": "AppUser",
  "roles": "%Developer,%Operator"
}
```
</details>

<details>
<summary><strong>iris_user_password</strong> -- Change password</summary>

**Input:**
```json
{
  "action": "change",
  "username": "AppUser",
  "password": "NewSecureP@ss456"
}
```

**Output:**
```json
{
  "action": "changed",
  "username": "AppUser",
  "success": true
}
```

> **Note:** When `Security.Users.Modify()` fails (policy violation,
> missing user, permission error, etc.), the underlying IRIS error
> text is propagated via the `Details:` suffix of the tool's error
> response. Examples: `User NonExistent does not exist`,
> `Password does not meet complexity requirements`. The password
> value itself is never embedded in IRIS error text for this path.
</details>

<details>
<summary><strong>iris_permission_check</strong> -- Check permission</summary>

**Input:**
```json
{
  "target": "_SYSTEM",
  "resource": "%DB_USER",
  "permission": "RW"
}
```

**Output (target holds %All super-role — short-circuit path):**
```json
{
  "target": "_SYSTEM",
  "targetType": "user",
  "resource": "%DB_USER",
  "permission": "RW",
  "granted": true,
  "grantedPermission": "RWU",
  "reason": "target holds %All super-role"
}
```

**Output (regular path — explicit resource:permission pair match):**
```json
{
  "target": "Admin",
  "targetType": "user",
  "resource": "%DB_USER",
  "permission": "RW",
  "granted": true,
  "grantedPermission": "RW"
}
```

> **Note:** The `%All` role is special-cased by the IRIS security
> subsystem — `Security.Roles.Get("%All", .tProps)` returns empty
> `Resources` even though the role grants everything. The handler
> short-circuits to `granted: true` with `grantedPermission: "RWU"`
> and emits an extra `reason` field when the target IS the `%All`
> role OR when a user target's role list contains `%All`. The
> `reason` field is omitted on the regular path.
</details>

<details>
<summary><strong>iris_role_manage</strong> -- Create a role</summary>

**Input:**
```json
{
  "action": "create",
  "name": "MyAppRole",
  "description": "Custom role for MyApp",
  "resources": "%DB_USER:RW,%Development:U"
}
```

**Output:**
```json
{
  "action": "create",
  "name": "MyAppRole",
  "status": "created"
}
```
</details>

<details>
<summary><strong>iris_role_list</strong> -- List roles</summary>

**Input:**
```json
{}
```

**Output:**
```json
{
  "roles": [
    { "name": "%All", "description": "The Super-User Role", "resources": "", "grantedRoles": "" },
    { "name": "%Developer", "description": "A Role owned by all Developers", "resources": "%DB_USER:RW,%Development:U,%Service_SQL:U", "grantedRoles": "" },
    { "name": "%EnsRole_Administrator", "description": "Interoperability Administrator", "resources": "%Ens_Code:R,%Ens_Jobs:W,%Ens_ProductionConfig:W", "grantedRoles": "%DB_ENSLIB,%EnsRole_Operator" }
  ],
  "count": 3
}
```

> **Note:** `resources` is a comma-separated list of
> `resource:permission` pairs (e.g., `%DB_USER:RW,%Ens_Code:R`).
> The `%All` super-role always returns `resources: ""` because
> IRIS special-cases it — its grant coverage is not stored as
> explicit pairs. Use `iris_permission_check` to test effective
> permissions for a `%All`-holder.
</details>

<details>
<summary><strong>iris_resource_manage</strong> -- Create a resource</summary>

**Input:**
```json
{
  "action": "create",
  "name": "MyAppResource",
  "description": "Access control for MyApp",
  "publicPermission": ""
}
```

**Output:**
```json
{
  "action": "create",
  "name": "MyAppResource",
  "status": "created"
}
```
</details>

<details>
<summary><strong>iris_resource_list</strong> -- List resources</summary>

**Input:**
```json
{}
```

**Output:**
```json
{
  "resources": [
    { "name": "%DB_USER", "description": "USER database resource", "publicPermission": "RW", "type": "database" }
  ],
  "count": 1
}
```
</details>

<details>
<summary><strong>iris_webapp_manage</strong> -- Create a web application</summary>

**Input:**
```json
{
  "action": "create",
  "name": "/api/myapp",
  "namespace": "USER",
  "dispatchClass": "MyApp.REST.Dispatch",
  "enabled": true
}
```

**Output:**
```json
{
  "action": "create",
  "name": "/api/myapp",
  "status": "created"
}
```
</details>

<details>
<summary><strong>iris_webapp_get</strong> -- Get web application</summary>

**Input:**
```json
{
  "name": "/csp/user"
}
```

**Output:**
```json
{
  "name": "/csp/user",
  "namespace": "USER",
  "enabled": 1,
  "dispatchClass": "",
  "authEnabled": 32
}
```
</details>

<details>
<summary><strong>iris_webapp_list</strong> -- List web applications</summary>

**Input:**
```json
{
  "namespace": "USER"
}
```

**Output:**
```json
{
  "webapps": [
    { "name": "/csp/user", "namespace": "USER", "enabled": 1 },
    { "name": "/api/executemcp/v2", "namespace": "USER", "enabled": 1 }
  ],
  "count": 2
}
```
</details>

<details>
<summary><strong>iris_ssl_manage</strong> -- Create SSL config</summary>

> **⚠️ Breaking (pre-release):** the `protocols` bitmask was removed
> in favor of separate `tlsMinVersion` and `tlsMaxVersion` integer
> fields, which reflect the real IRIS properties
> (`Security.SSLConfigs.TLSMinVersion` / `TLSMaxVersion`). The
> deprecated `Protocols` property it replaced was never actually
> wired up through the handler, so removing it is a clean break
> with no data-loss risk. Clients that wrote `protocols: 24` now
> write `tlsMinVersion: 8, tlsMaxVersion: 16` (or
> `tlsMinVersion: 16, tlsMaxVersion: 32` for TLS 1.2 through TLS 1.3
> explicitly). See Story 11.2 in `_bmad-output`. Zod-schema changes
> ship in Story 11.4.
>
> **TLS version value mapping** (IRIS
> `Security.Datatype.TLSVersion` VALUELIST):
> `2 = SSLv3`, `4 = TLS 1.0`, `8 = TLS 1.1`, `16 = TLS 1.2`,
> `32 = TLS 1.3`.

**Input:**
```json
{
  "action": "create",
  "name": "MyTLS",
  "tlsMinVersion": 16,
  "tlsMaxVersion": 32,
  "type": 0,
  "verifyPeer": 1
}
```

**Output:**
```json
{
  "action": "created",
  "name": "MyTLS"
}
```
</details>

<details>
<summary><strong>iris_ssl_list</strong> -- List SSL configurations</summary>

**Input:**
```json
{}
```

**Output:**
```json
{
  "sslConfigs": [
    {
      "name": "BFC_SSL",
      "description": "",
      "certFile": "",
      "keyFile": "",
      "caFile": "",
      "caPath": "",
      "cipherList": "ALL:!aNULL:!eNULL:!EXP:!SSLv2",
      "tlsMinVersion": 16,
      "tlsMaxVersion": 32,
      "verifyPeer": 0,
      "verifyDepth": 9,
      "type": 0,
      "enabled": true
    }
  ],
  "count": 1
}
```

> **⚠️ Breaking (pre-release):** `protocols` was replaced by
> `tlsMinVersion` + `tlsMaxVersion` — see the `iris_ssl_manage`
> note above for the TLS version value mapping.
</details>

<details>
<summary><strong>iris_oauth_manage</strong> -- OIDC discovery</summary>

**Input:**
```json
{
  "action": "discover",
  "issuerURL": "https://accounts.google.com"
}
```

**Output:**
```json
{
  "issuer": "https://accounts.google.com",
  "authorization_endpoint": "https://accounts.google.com/o/oauth2/v2/auth",
  "token_endpoint": "https://oauth2.googleapis.com/token"
}
```
</details>

<details>
<summary><strong>iris_oauth_list</strong> -- List OAuth2 configurations</summary>

**Input:**
```json
{}
```

**Output:**
```json
{
  "servers": [],
  "clients": [],
  "serverCount": 0,
  "clientCount": 0
}
```
</details>

---

## Namespace Scoping

**Security note:** Most admin tools operate in the `%SYS` namespace on the IRIS server, regardless of the configured default namespace. This is because IRIS security and configuration classes (`Config.*`, `Security.*`) only exist in `%SYS`.

The following tools **do not** accept a user-specified `namespace` parameter (they always execute in `%SYS`):
- All namespace, database, mapping, user, role, resource, permission, SSL, and OAuth tools

The `iris_webapp_list` tool optionally accepts a `namespace` parameter to filter web applications by namespace.

The `iris_webapp_manage` tool accepts a `namespace` parameter to set the target namespace for the web application being created/modified.

---

## Error Handling

### Common Errors

| Error | Cause | Resolution |
|-------|-------|------------|
| `IRIS connection refused` | IRIS web server not running or wrong host/port | Verify `IRIS_HOST` and `IRIS_PORT` settings |
| `401 Unauthorized` | Invalid credentials or insufficient privileges | Check credentials; admin operations require `%Admin_Manage`, `%Admin_Security`, or `%Admin_Operate` resources |
| `Namespace already exists` | Attempting to create a namespace that exists | Use `iris_namespace_list` to check existing namespaces |
| `Database directory not found` | Invalid directory path for database creation | Ensure the directory path is valid and accessible to the IRIS instance |
| `User does not exist` | Referencing a non-existent user | Use `iris_user_get` without parameters to list all users |
| `Role does not exist` | Adding a non-existent role | Use `iris_role_list` to see available roles |
| `Custom REST endpoint not found` | Bootstrap has not completed | The server auto-bootstraps on first connection; save the web app via SMP if 404 persists |

### Error Response Format

```json
{
  "content": [{ "type": "text", "text": "Error managing namespace 'MYAPP': <details>" }],
  "isError": true
}
```

Passwords are **never** included in error messages or responses (NFR6 security requirement).

---

[Back to IRIS MCP Server Suite](../../README.md)
