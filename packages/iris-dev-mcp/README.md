# @iris-mcp/dev

**IRIS Development Tools MCP Server** -- ObjectScript document CRUD, compilation, SQL execution and analysis, globals management, code execution, unit testing, package browsing, bulk export, lines-of-code analysis, and cross-profile environment diff & promotion via the Model Context Protocol.

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

### Multiple servers & the `server` parameter

Optionally, set `IRIS_PROFILES` (a JSON map of named IRIS instances) and `IRIS_GOVERNANCE` (a JSON tool-action policy) to target several instances from one server and restrict which actions are allowed. Every tool accepts an optional `server` parameter (a profile name from `IRIS_PROFILES`) that selects which instance the call targets; omit it to use the `default` profile. It composes with the existing per-call `namespace` override. Both variables are **optional and additive** — omit them and this server behaves exactly as a single-instance, fully-enabled install. Full model, escaping, and worked examples: [Multiple Servers & Governance](../../README.md#multiple-servers--governance).

### Read-only mode (`IRIS_GOVERNANCE_PRESET`)

Set `IRIS_GOVERNANCE_PRESET=read-only` to block every write-classified action on **this server** with one environment variable — no `IRIS_GOVERNANCE` JSON needed. `IRIS_GOVERNANCE_PRESET` is **framework configuration, not a tool** — it applies identically across all five servers in the suite (`@iris-mcp/dev` included), not something this package registers or exposes. An explicit `IRIS_GOVERNANCE` override still wins over the preset. Omit (or set `"full"`) for today's behavior (opt-in, default off). Details: [Read-only mode](../../README.md#read-only-mode-point-it-at-production-with-one-environment-variable).

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

### Framework Tools

Provided by the shared framework and available on **every** suite server (Epic 19).

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_server_profiles` | **Call this first.** Reports the configured server-profile roster (non-secret connection metadata — `password` is never included) and the effective governance policy (which actions are enabled/disabled). | `profile?`, `allProfiles?` | readOnly, idempotent |

`iris_server_profiles` is a **read tool, enabled by default**. It reports in-memory config and does not connect to IRIS. Use it to choose the right `server` profile and avoid governance-disabled actions before invoking other tools.

### Document Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_doc_get` | Retrieve a document by name (UDL or XML format) | `name`, `namespace?`, `format?`, `metadataOnly?` | readOnly, idempotent |
| `iris_doc_put` | **Debug/scratch** — write a document directly to IRIS without creating a file on disk (use `iris_doc_load` for production code) | `name`, `content`, `namespace?`, `ignoreConflict?` (default: **false** — do not overwrite a newer server copy) | idempotent |
| `iris_doc_delete` | Delete one or more documents | `name` (string or array), `namespace?` | destructive, idempotent |
| `iris_doc_list` | List documents with optional filters | `category?`, `type?`, `filter?`, `generated?`, `namespace?`, `modifiedSince?`, `cursor?` | readOnly, idempotent |
| `iris_doc_load` | Bulk upload files from disk into IRIS | `path` (glob), `compile?`, `flags?`, `namespace?`, `ignoreConflict?` (default: **true** — overwrite server copies even when newer) | idempotent |
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
| `iris_routine_intermediate` | Fetch the compiled-intermediate routine (.1.int) for a class by its bare name — macro-expanded form IRIS executes at runtime | `name`, `namespace?`, `format?` | readOnly, idempotent |

### Format and Export Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_doc_convert` | Convert document between UDL and XML | `name`, `targetFormat`, `namespace?` | readOnly, idempotent |
| `iris_doc_xml_export` | Export, import, or list documents in XML format | `action`, `docs?`, `content?`, `namespace?` | destructive (import), not idempotent |

### SQL Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_sql_execute` | Execute a SQL query with parameterized values | `query`, `parameters?`, `maxRows?`, `namespace?` | -- |
| `iris_sql_analyze` | Analyze SQL: show query plan (`explain`), parse maps/indexes from the plan (`indexUsage`), cached-statement stats (`stats`), or currently-running statements (`running`) | `action`, `query?`, `filter?`, `maxRows?`, `namespace?` | readOnly, idempotent |

> **Governance defaults:** all four `iris_sql_analyze` actions (`explain`/`stats`/`indexUsage`/`running`) are classified `read` and are therefore **enabled by default** — none is gated behind `IRIS_GOVERNANCE`. (A `read` classification is still required for every new tool key, but reads resolve enabled under the default seed.)
>
> **SQL resource caps (optional, opt-in):** an operator may set `IRIS_SQL_MAX_ROWS` (a ceiling on the number of rows `iris_sql_execute` **returns** — the response carries `rowsCapped: true` when it clamps the caller's request, distinct from the pre-existing `truncated`/`totalAvailable`; it bounds the returned row count post-fetch, not the server-side result set or transfer) and/or `IRIS_SQL_TIMEOUT` (a per-request timeout in **seconds**) as environment variables. Both are unset by default (no cap, today's behavior) and apply regardless of `IRIS_GOVERNANCE_PRESET`. Details: [suite README](../../README.md#read-only-mode-point-it-at-production-with-one-environment-variable).

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
| `iris_global_list` | List globals with optional filter | `filter?`, `caseSensitive?`, `cursor?`, `namespace?` | readOnly, idempotent |

### Execution Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_execute_command` | Execute an ObjectScript command | `command`, `namespace?` | -- |
| `iris_execute_classmethod` | Invoke a class method with arguments | `className`, `methodName`, `args?`, `namespace?` | -- |
| `iris_execute_tests` | Run unit tests (package, class, or method level) | `target`, `level`, `namespace?` | readOnly, idempotent |

### Code Metrics Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_loc_count` | Count lines of code in the namespace's ObjectScript documents (CLS/MAC/INT/INC): blank / source code / source comment / test code / test comment buckets, percentages, and the top-N largest documents. `spec` is REQUIRED (whole-namespace scans need an explicit `*` and risk the ~60s gateway timeout); compiler-generated documents are excluded by default | `spec`, `namespace?`, `includeGenerated?`, `topN?`, `format?` | readOnly, idempotent |

> **Governance defaults:** `iris_loc_count` is classified `read` and is therefore **enabled by default** — it is not gated behind `IRIS_GOVERNANCE`. (A `read` classification is still required for every new tool key, but reads resolve enabled under the default seed.)

### Environment Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_env_diff` | Compare two configured IRIS profiles (`source` vs `target`) across up to five domains — `documents`, `mappings`, `defaultSettings`, `webapps`, `config` — and report a structured drift report. Default `domains` (no `spec` needed): `mappings`, `defaultSettings`, `webapps`, `config`; `documents` is opt-in only and requires `spec` (a bare `*` is refused unless `allowWide` is set). Credential-ish System Default Settings values are redacted | `source`, `target`, `domains?`, `spec?`, `allowWide?`, `namespace?`, `ignoreTimestamps?` | readOnly, idempotent |
| `iris_env_promote` | Turn a prior `iris_env_diff` result into an ordered promotion plan (`action: "plan"`), or execute an allowlisted subset of that plan against `target` (`action: "execute"`) behind four refuse-before-any-write gates: `confirm`, a `steps` allowlist, plan-hash freshness (the same `diff` re-hashed), and the target profile's own governance. Halts on the first failed step; never deletes a target-only item | `action`, `source`, `target`, `diff?`, `plan?`, `steps?`, `confirm?`, `namespace?` | -- |

> **Governance defaults:** `iris_env_diff` and `iris_env_promote`'s `plan` action are classified `read` and are therefore **enabled by default** — neither is gated behind `IRIS_GOVERNANCE`. `iris_env_promote`'s `execute` action is truthfully classified `write` and is **DEFAULT-DISABLED** (unlike `iris_production_control:clean`, it deliberately does not use the `defaultEnabled` mechanism — promotion is a real environment-mutating write, not a recovery action); enable it via `IRIS_GOVERNANCE`, e.g. `{"global":{"iris_env_promote:execute":true}}` — `execute` ALSO requires the **target** profile's own governance to allow the underlying write families it uses (a fourth gate on top of this one). **Safety:** nothing on the target is ever deleted — items that exist on the target only (`onlyInTarget`) are always informational warnings, never steps — and System Default Settings values that look like credentials are redacted in both diff and plan/execute output; their plaintext never appears in any tool result. Credentials/users/roles promotion is out of scope entirely.

---

## Prompts

Workflow-shaped [MCP prompts](../../README.md#workflow-prompts--agent-skills) (Epic 25) served via `prompts/list`/`prompts/get`. Prompts are a separate protocol capability from tools — they carry no governance key and do not change this server's tool count.

| Prompt | Description |
|---|---|
| `diagnose-slow-query` | Runs `iris_sql_analyze` (`explain` → `indexUsage` → `stats`) and recommends a fix — never auto-applies one. |
| `objectscript-review` | A concise pre-write checklist distilling this project's ObjectScript conventions ($$$ macros, `Quit` in try/catch, `%OnNew`/`initvalue`, no-underscore names, storage sections untouchable). |
| `deploy-and-test-class` | Deploys an ObjectScript class or package (`iris_doc_load`, glob-path form), resolves compile errors, then runs its unit tests (`iris_execute_tests`) with a total-count check. |
| `promote-environment-change` | Reviews and promotes configuration/code drift from a source IRIS environment to a target using the review-before-write `iris_env_diff` → `iris_env_promote` workflow — scoped diff, review with the user, plan, an explicit user-selected step allowlist, confirmed execute, then re-diff to verify. Never acts on `onlyInTarget` warnings; states the no-deletions guarantee and that `execute` is default-disabled. |

Also installable as [Agent Skills](../../skills/README.md).

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
<summary><strong>iris_doc_put</strong> -- Debug/scratch: write a document directly to IRIS</summary>

**Debug/scratch tool** — for production code, use `iris_doc_load` to ensure source
control and review. This tool writes content directly to IRIS without creating a
file on disk, and is intended for one-off inspection, quick reproductions, or
throwaway test classes only.

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
    { "name": "MyApp.Services", "docCount": 12, "depth": 2 },
    { "name": "MyApp.Utils", "docCount": 4, "depth": 2 },
    { "name": "MyApp.Tests", "docCount": 8, "depth": 2 }
  ],
  "count": 3,
  "namespace": "USER",
  "depth": 2,
  "totalDocs": 24
}
```

For a structural overview at package granularity, use `iris_package_list`. For individual document names, use `iris_doc_list`. To pull many documents at once, see `iris_doc_export`.

> **Note on CSP static assets in system namespaces.** Because `iris_package_list` aggregates the same Atelier `docnames` feed that `iris_doc_export` walks, it inherits the same system-namespace asymmetry: static web files (CSS, JS, images under `/csp/…/*.css`, `*.js`, etc.) appear in `docnames` even though they are not stored in an Atelier-retrievable form. On a stock IRIS 2025.1 `%SYS` namespace the `csp` package row will look inflated (~2,174 of 6,131 docs) for this reason. This is an **IRIS-side asymmetry, not a tool defect**. To get a clean code-only rollup, pass **`category: "CLS"`** (classes) or **`category: "RTN"`** (routines + include files) — the same workaround documented for `iris_doc_export`.
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

When `files` is omitted, the tool sends the documented default pattern
`*.cls,*.mac,*.int,*.inc` on every call — previously the param was silently
dropped when the caller omitted it, which let the Atelier server's narrower
default kick in and returned empty results for matches that lived in `.cls`
files. Pass an explicit `files` value to narrow the search.

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
<summary><strong>iris_routine_intermediate</strong> -- Fetch the macro-expanded compiled-intermediate routine</summary>

Returns the `.1.int` routine (or `.int` for `.mac`/`.int` sources) IRIS generates during compilation — the fully macro-expanded form IRIS actually executes at runtime. Useful when you need to see what `$$$` macros expand to (e.g., what `$$$OK` or `$$$ThrowOnError` resolves to in a specific class's context), or to inspect compiled output without running code.

Pass the **bare class/routine name** (no `.cls` extension). The tool auto-resolves by trying candidate document paths in order: `<name>.1.int`, then `<name>.int` (the `.mac` source itself is intentionally NOT a candidate — the macro-expanded intermediate is what this tool returns). The first 2xx response wins; `candidatesTried` reports which paths were attempted. If all candidates return 404 the tool returns a `compile-first` hint.

**Input:**
```json
{
  "name": "ExecuteMCPv2.REST.Command",
  "namespace": "HSCUSTOM"
}
```

**Output:**
```json
{
  "name": "ExecuteMCPv2.REST.Command",
  "resolvedDoc": "ExecuteMCPv2.REST.Command.1.int",
  "namespace": "HSCUSTOM",
  "content": "ROUTINE ExecuteMCPv2.REST.Command.1 [Type=INT]\n%File ; ExecuteMCPv2.REST.Command.1 ;(CLS)\nzExecute() public {\n New %sc\n Set %sc=$$$OK\n ...\n}\nzRedirects() public {\n ...\n}",
  "candidatesTried": ["ExecuteMCPv2.REST.Command.1.int"]
}
```

The `content` string contains the routine body as IRIS compiled it (newline-joined), including the ROUTINE header, methodimpl declarations, and macro-expanded ObjectScript.
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

If the operator has set `IRIS_SQL_MAX_ROWS` lower than the effective request, the output additionally carries `"rowsCapped": true` (e.g. `IRIS_SQL_MAX_ROWS=5` with `maxRows: 10` above would clamp `rowCount` to 5 and add `rowsCapped: true`). Unset, this field never appears.
</details>

<details>
<summary><strong>iris_sql_analyze</strong> -- Show a query plan</summary>

**Input:**
```json
{
  "action": "explain",
  "query": "SELECT Name FROM %Dictionary.ClassDefinition WHERE Name %STARTSWITH 'Ens'"
}
```

`explain` returns the query plan text; `indexUsage` additionally parses the maps/indexes named in the plan; `stats` reads cached-statement statistics (`INFORMATION_SCHEMA.STATEMENTS`); `running` lists currently-executing statements (`INFORMATION_SCHEMA.CURRENT_STATEMENTS`). `query` is required for `explain`/`indexUsage`.

**Output:**
```json
{
  "action": "explain",
  "plan": "<plans>\n <plan>\n   ...\n   Read master map %Dictionary.ClassDefinition.Master ...\n </plan>\n</plans>"
}
```
</details>

<details>
<summary><strong>iris_loc_count</strong> -- Count lines of code</summary>

**Input:**
```json
{
  "spec": "MyApp.*.cls,*.mac",
  "topN": 5
}
```

`spec` is REQUIRED (comma-delimited, `*`/`?` wildcards) — a whole-namespace scan needs an explicit `"*"` and risks the ~60s gateway timeout on large namespaces. Compiler-generated documents (e.g. the `.int` code generated from a class) are excluded by default; pass `includeGenerated: true` to count them. System (`%`-prefixed) documents are excluded from wildcard scans — name them explicitly (e.g. `%Z*.cls`) to count them — and spec parts should not overlap: an exact document name listed before a wildcard part that also matches it can drop documents (an IRIS `StudioOpenDialog` spec quirk). `format: "csv"` renders `metric,value` rows instead of the ASCII table (client-side only — `structuredContent` always carries the full object).

**Output (`structuredContent`):**
```json
{
  "filesParsed": 44,
  "totalLines": 16215,
  "blankLines": 1413,
  "sourceCodeLoc": 8677,
  "sourceCommentLoc": 2463,
  "testCodeLoc": 2997,
  "testCommentLoc": 665,
  "codePct": 72.0,
  "sourceCodePct": 53.5,
  "testCodePct": 18.5,
  "commentPct": 19.3,
  "whitespacePct": 8.7,
  "topDocuments": [
    { "name": "MyApp.REST.Api.cls", "type": "cls", "totalLines": 3186, "codeLoc": 2283, "commentLoc": 634, "isTest": false }
  ],
  "truncatedTopN": true
}
```

The `content` text renders the reference `cos_loc_counter.sh` ASCII metrics table (or its CSV rows with `format: "csv"`).
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

**Input (case-insensitive filter — default):**
```json
{
  "filter": "my"
}
```

**Output:**
```json
{
  "globals": ["MyData", "MyConfig", "MyTemp"],
  "count": 3
}
```

The `filter` is applied client-side as a **case-insensitive** substring match by default, matching `iris_doc_list` semantics. A filter of `"my"` matches `"MyData"`, `"MYAPP"`, and `"mytemp"`.

Pass `caseSensitive: true` to restore the old case-sensitive (exact substring) behavior.
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

**All 28 tools in this package accept the `namespace` parameter** except:
- `iris_server_info` -- Server-level info, no namespace needed

Tools that use the Atelier REST API (doc, compile, intelligence, sql, server tools) resolve namespace via the Atelier URL path. Tools that use the custom REST endpoint (global, execute tools) pass namespace as a request parameter. `iris_env_diff`/`iris_env_promote` are the exception in spirit rather than mechanism: their `namespace` overrides BOTH the `source` and `target` profile's namespace identically (each side otherwise falls back to its own profile's configured default), rather than targeting one connection's namespace like every other tool here.

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
