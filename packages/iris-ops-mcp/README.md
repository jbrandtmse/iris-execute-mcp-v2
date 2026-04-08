# @iris-mcp/ops

**IRIS Operations & Monitoring MCP Server** -- System metrics, jobs, locks, journals, mirrors, audit events, database integrity, licensing, ECP, task scheduling, and system configuration via the Model Context Protocol.

Part of the [IRIS MCP Server Suite](../../README.md).

---

## Installation

```bash
npm install -g @iris-mcp/ops
```

Or run directly without installing:

```bash
npx @iris-mcp/ops
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
    "iris-ops-mcp": {
      "command": "npx",
      "args": ["-y", "@iris-mcp/ops"],
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
    "iris-ops-mcp": {
      "command": "npx",
      "args": ["-y", "@iris-mcp/ops"],
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
  "iris-ops-mcp": {
    "command": "npx",
    "args": ["-y", "@iris-mcp/ops"],
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

### Metrics & Monitoring Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris.metrics.system` | System metrics in Prometheus format | *(none)* | readOnly, idempotent |
| `iris.metrics.alerts` | Active system alerts with severity | *(none)* | readOnly, idempotent |
| `iris.metrics.interop` | Interoperability volume and interface metrics | `namespace?` | readOnly, idempotent |

### Process & Lock Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris.jobs.list` | List all running IRIS jobs/processes | *(none)* | readOnly, idempotent |
| `iris.locks.list` | List all current system locks | *(none)* | readOnly, idempotent |

### Infrastructure Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris.journal.info` | Journal file status and directory info | *(none)* | readOnly, idempotent |
| `iris.mirror.status` | Mirror configuration and membership status | *(none)* | readOnly, idempotent |
| `iris.audit.events` | Audit log events with filters | `beginDate?`, `endDate?`, `username?`, `eventType?`, `maxRows?` | readOnly, idempotent |
| `iris.database.check` | Database status (mounted, encrypted, size) | `name?` | readOnly, idempotent |
| `iris.license.info` | License type, capacity, usage, expiration | *(none)* | readOnly, idempotent |
| `iris.ecp.status` | ECP connection status | *(none)* | readOnly, idempotent |

### Task Scheduling Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris.task.manage` | Create, modify, or delete a scheduled task | `action`, `id?`, `name?`, `taskClass?`, `namespace?`, `suspended?` | destructive |
| `iris.task.list` | List all scheduled tasks with details | *(none)* | readOnly, idempotent |
| `iris.task.run` | Trigger immediate task execution | `id` | -- |
| `iris.task.history` | View task execution history | `taskId?` | readOnly, idempotent |

### System Configuration Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris.config.manage` | Get, set, or export system configuration | `action`, `section?`, `properties?` | destructive (set) |

---

## Tool Examples

<details>
<summary><strong>iris.metrics.system</strong> -- System metrics</summary>

**Input:**
```json
{}
```

**Output (Prometheus text format):**
```
# HELP iris_process_count Number of IRIS processes
# TYPE iris_process_count gauge
iris_process_count 42
# HELP iris_global_refs_total Total global references
# TYPE iris_global_refs_total counter
iris_global_refs_total 1234567
# HELP iris_db_size_mb Database size in megabytes
# TYPE iris_db_size_mb gauge
iris_db_size_mb{db="USER"} 256
iris_db_size_mb{db="IRISSYS"} 1024
```
</details>

<details>
<summary><strong>iris.metrics.alerts</strong> -- System alerts</summary>

**Input:**
```json
{}
```

**Output:**
```json
{
  "state": 0,
  "stateText": "OK",
  "alertCount": 0,
  "alerts": [],
  "lastAlert": ""
}
```
</details>

<details>
<summary><strong>iris.metrics.interop</strong> -- Interop metrics</summary>

**Input:**
```json
{
  "namespace": "USER"
}
```

**Output:**
```json
{
  "namespaces": [
    {
      "namespace": "USER",
      "productionName": "MyApp.Production",
      "productionState": "Running",
      "productionStateCode": 1,
      "queueDepth": 5,
      "errorCount24h": 2,
      "messageCount24h": 1500
    }
  ],
  "count": 1
}
```
</details>

<details>
<summary><strong>iris.jobs.list</strong> -- List running jobs</summary>

**Input:**
```json
{}
```

**Output:**
```json
{
  "jobs": [
    {
      "pid": 1234,
      "namespace": "USER",
      "routine": "MyApp.Service",
      "state": "RUN",
      "userName": "_SYSTEM",
      "commandsExecuted": 50000,
      "globalReferences": 12000,
      "cpuTime": 45.2
    }
  ],
  "count": 1
}
```
</details>

<details>
<summary><strong>iris.locks.list</strong> -- List locks</summary>

**Input:**
```json
{}
```

**Output:**
```json
{
  "locks": [
    {
      "lockName": "^MyGlobal(\"key1\")",
      "ownerPid": 1234,
      "owner": "1234",
      "mode": "Exclusive",
      "flags": "",
      "counts": "1"
    }
  ],
  "count": 1
}
```
</details>

<details>
<summary><strong>iris.journal.info</strong> -- Journal status</summary>

**Input:**
```json
{}
```

**Output:**
```json
{
  "currentFile": "C:\\InterSystems\\IRIS\\mgr\\journal\\20260407.001",
  "primaryDirectory": "C:\\InterSystems\\IRIS\\mgr\\journal",
  "alternateDirectory": "C:\\InterSystems\\IRIS\\mgr\\journal2",
  "fileCount": 15,
  "currentOffset": 524288,
  "freeSpaceBytes": 53687091200,
  "state": "Enabled"
}
```
</details>

<details>
<summary><strong>iris.mirror.status</strong> -- Mirror status</summary>

**Input:**
```json
{}
```

**Output:**
```json
{
  "isMember": false,
  "mirrorName": "",
  "memberType": "Not Member",
  "isPrimary": false,
  "isBackup": false,
  "isAsyncMember": false,
  "status": "This instance is not a mirror member"
}
```
</details>

<details>
<summary><strong>iris.audit.events</strong> -- Query audit log</summary>

**Input:**
```json
{
  "username": "_SYSTEM",
  "maxRows": 5
}
```

**Output:**
```json
{
  "events": [
    {
      "timestamp": "2026-04-07 10:30:00",
      "username": "_SYSTEM",
      "eventSource": "%System",
      "eventType": "Login",
      "event": "LoginSuccess",
      "description": "User logged in",
      "clientIPAddress": "127.0.0.1",
      "namespace": "%SYS"
    }
  ],
  "count": 1,
  "maxRows": 5
}
```
</details>

<details>
<summary><strong>iris.database.check</strong> -- Database health</summary>

**Input:**
```json
{
  "name": "USER"
}
```

**Output:**
```json
{
  "databases": [
    {
      "name": "USER",
      "directory": "C:\\InterSystems\\IRIS\\mgr\\user",
      "mounted": true,
      "readOnly": false,
      "encrypted": false,
      "journalState": 2,
      "sizeMB": 256,
      "maxSizeMB": 0
    }
  ],
  "count": 1
}
```
</details>

<details>
<summary><strong>iris.license.info</strong> -- License info</summary>

**Input:**
```json
{}
```

**Output:**
```json
{
  "customerName": "InterSystems",
  "licenseCapacity": "Community",
  "expirationDate": "2027-01-01",
  "connectionLimit": 0,
  "userLimit": 5,
  "coresLicensed": 4,
  "cpusLicensed": 1,
  "currentCSPUsers": 2
}
```
</details>

<details>
<summary><strong>iris.ecp.status</strong> -- ECP status</summary>

**Input:**
```json
{}
```

**Output:**
```json
{
  "configured": false,
  "status": "ECP not configured"
}
```
</details>

<details>
<summary><strong>iris.task.manage</strong> -- Create a task</summary>

**Input:**
```json
{
  "action": "create",
  "name": "Daily Purge",
  "taskClass": "MyApp.Tasks.PurgeOldData",
  "namespace": "USER"
}
```

**Output:**
```json
{
  "action": "create",
  "id": 42,
  "name": "Daily Purge"
}
```
</details>

<details>
<summary><strong>iris.task.list</strong> -- List tasks</summary>

**Input:**
```json
{}
```

**Output:**
```json
{
  "tasks": [
    {
      "id": 42,
      "name": "Daily Purge",
      "taskClass": "MyApp.Tasks.PurgeOldData",
      "namespace": "USER",
      "suspended": "0",
      "priority": "Normal",
      "runInterval": "Daily"
    }
  ],
  "count": 1
}
```
</details>

<details>
<summary><strong>iris.task.run</strong> -- Run a task immediately</summary>

**Input:**
```json
{
  "id": 42
}
```

**Output:**
```json
{
  "triggered": true,
  "id": 42,
  "message": "Task triggered for immediate execution"
}
```
</details>

<details>
<summary><strong>iris.task.history</strong> -- Task execution history</summary>

**Input:**
```json
{
  "taskId": 42
}
```

**Output:**
```json
{
  "history": [
    {
      "taskName": "Daily Purge",
      "lastStart": "2026-04-07 02:00:00",
      "completed": "2026-04-07 02:00:15",
      "status": "Completed",
      "result": "Success",
      "namespace": "USER",
      "username": "_SYSTEM",
      "taskId": "42"
    }
  ],
  "count": 1
}
```
</details>

<details>
<summary><strong>iris.config.manage</strong> -- Get system configuration</summary>

**Input:**
```json
{
  "action": "get",
  "section": "config"
}
```

**Output:**
```json
{
  "section": "config",
  "properties": {
    "globals": 400,
    "routines": 256,
    "locksiz": 16777216,
    "MaxServerConn": 1
  }
}
```
</details>

---

## Namespace Scoping

Most operations tools are **system-level** and do not require a namespace parameter. They operate across the entire IRIS instance.

**Tools that accept the `namespace` parameter:**
- `iris.metrics.interop` -- optionally filter interop metrics to a single namespace
- `iris.task.manage` -- specify the execution namespace for a new task

**Tools that do NOT accept `namespace`** (system-wide scope):
- `iris.metrics.system`, `iris.metrics.alerts`
- `iris.jobs.list`, `iris.locks.list`
- `iris.journal.info`, `iris.mirror.status`, `iris.audit.events`
- `iris.database.check`, `iris.license.info`, `iris.ecp.status`
- `iris.task.list`, `iris.task.run`, `iris.task.history`
- `iris.config.manage`

---

## Error Handling

### Common Errors

| Error | Cause | Resolution |
|-------|-------|------------|
| `IRIS connection refused` | IRIS web server not running or wrong host/port | Verify `IRIS_HOST` and `IRIS_PORT` settings |
| `401 Unauthorized` | Invalid credentials or insufficient privileges | Check credentials; ops operations may require `%Admin_Operate` or `%Admin_Manage` resources |
| `ECP not configured` | No ECP setup on this instance | This is an informational response, not an error |
| `Mirror not configured` | No mirror setup on this instance | This is an informational response, not an error |
| `Task not found` | Invalid task ID | Use `iris.task.list` to find valid task IDs |
| `Configuration section not found` | Invalid section name | Valid sections: `config`, `startup`, `locale` |
| `Custom REST endpoint not found` | Bootstrap has not completed | The server auto-bootstraps on first connection; save the web app via SMP if 404 persists |

### Error Response Format

```json
{
  "content": [{ "type": "text", "text": "Error retrieving system metrics: <details>" }],
  "isError": true
}
```

---

[Back to IRIS MCP Server Suite](../../README.md)
