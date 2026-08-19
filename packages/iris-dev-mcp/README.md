# @iris-mcp/dev

**IRIS Development Tools MCP Server** -- ObjectScript document CRUD, compilation, SQL execution, analysis, and performance advisories, globals management, code execution, unit testing, package browsing, bulk export, lines-of-code analysis, and cross-profile environment diff & promotion via the Model Context Protocol.

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
| `IRIS_ACCEPT_LANGUAGE` | `en-US,en;q=0.9` | **Optional.** `Accept-Language` header sent on every request, pinning `%Status` error text to a predictable language instead of whatever locale an unspecified header resolves to. IRIS also selects a message table per worker process independently of this header, so localized prefixes can still appear — existing prefix-stripping is unaffected. Details: [suite README](../../README.md#2-set-environment-variables). |

### Multiple servers & the `server` parameter

Optionally, set `IRIS_PROFILES` (a JSON map of named IRIS instances) and `IRIS_GOVERNANCE` (a JSON tool-action policy) to target several instances from one server and restrict which actions are allowed. Every tool accepts an optional `server` parameter (a profile name from `IRIS_PROFILES`) that selects which instance the call targets; omit it to use the `default` profile. It composes with the existing per-call `namespace` override. Both variables are **optional and additive** — omit them and this server behaves exactly as a single-instance, fully-enabled install. Full model, escaping, and worked examples: [Multiple Servers & Governance](../../README.md#multiple-servers--governance).

Optionally, set `IRIS_GOVERNANCE_FILE` to the path of a JSON file of the same shape as `IRIS_GOVERNANCE` to load policy from a file shared across several MCP clients instead of inline JSON. **Optional and additive** — unset (the default) means inert: no file is ever read and behavior is byte-for-byte unchanged. An `IRIS_GOVERNANCE` env value always wins over the file. Details: [Governance file](../../README.md#governance-file-iris_governance_file).

### Read-only mode (`IRIS_GOVERNANCE_PRESET`)

Set `IRIS_GOVERNANCE_PRESET=read-only` to block every write-classified action on **this server** with one environment variable — no `IRIS_GOVERNANCE` JSON needed. `IRIS_GOVERNANCE_PRESET` is **framework configuration, not a tool** — it applies identically across all five servers in the suite (`@iris-mcp/dev` included), not something this package registers or exposes. An explicit `IRIS_GOVERNANCE` override still wins over the preset. Omit (or set `"full"`) for today's behavior (opt-in, default off). Details: [Read-only mode](../../README.md#read-only-mode-point-it-at-production-with-one-environment-variable).

### Tool Visibility (`IRIS_TOOLS_PRESET`)

Set `IRIS_TOOLS_PRESET=core` to trim this server's `tools/list` to a **13-tool runtime roster** (12 package tools + `iris_server_profiles`) — the authoring loop (get/put/list/compile/load), the execution & debug loop (command/classmethod/tests, global get/set/kill), and `iris_sql_execute`. `IRIS_TOOLS_PRESET=developer` keeps all **29 runtime tools** (28 + `iris_server_profiles`) visible — every tool on this server is already dev-relevant, so `developer` behaves like `full` here. Omit (or set `"full"`) for today's behavior — every tool visible, byte-for-byte. `IRIS_TOOLS_DISABLE`/`IRIS_TOOLS_ENABLE` hide/force-show individual tools independent of the preset. This is orthogonal to `IRIS_GOVERNANCE_PRESET` above (visibility = does the agent know a tool exists; governance = is an already-visible call allowed). Full model, exact per-tool roster, and the payload-size measurements: [Tool Visibility Presets](../../README.md#tool-visibility-presets).

> **Prompt-pack limitation.** Two of this server's prompts call tools `core` hides: `diagnose-slow-query` calls `iris_sql_analyze` (hidden under `core`), and `promote-environment-change` calls `iris_env_diff`/`iris_env_promote` (both hidden together under `core` — they are always co-visible). Both prompts work unchanged under `full` or `developer`. Running under `core`, either switch to `full`/`developer` or set `IRIS_TOOLS_ENABLE` to re-show the specific tool(s) the prompt needs.

---

### Audit Logging (`IRIS_AUDIT_LOG`)

For regulated deployments, set `IRIS_AUDIT_LOG=/path/to/audit.jsonl` to record **every MCP tool call this server handles** — success, error, or governance denial — as one secrets-free JSON line (session, sequence, tool, action, outcome, redacted parameter keys). It is **off by default** (unset ⇒ a mechanical no-op, zero filesystem writes) and framework-wide — the same interceptor covers every tool on this server. `IRIS_AUDIT_LOG_MAX_MB` (default `50`) sets the single-generation rotation size; `IRIS_AUDIT_LOG_PARAMS=true` additionally records (redacted) parameter *values*. Because it is server-side **configuration** — not a governed tool action — an AI client cannot disable its own audit trail; only an operator with server-environment access can. Full record shape, redaction rules, and how it differs from IRIS's own `iris_audit_*` security-audit tools: [Compliance & Auditability](../../README.md#compliance--auditability).

### Server Manager connections (`IRIS_SERVER_MANAGER`)

Set `IRIS_SERVER_MANAGER=auto` to import IRIS connection definitions straight from the InterSystems Server Manager VS Code extension's `intersystems.servers` settings — one curated roster instead of re-typing host/port/username into every MCP client's config. `IRIS_SERVER_MANAGER` is **framework configuration, not a tool** — it applies identically across all five servers in the suite. Omit (or set `"off"`, the default) for today's behavior: no settings file is ever read. A password-less imported definition is completed via an OS-keychain / `IRIS_CREDENTIAL_HELPER` credential chain (see the [`iris-mcp-credentials` CLI](../../README.md#iris-mcp-credentials-cli) — Server Manager passwords themselves are never readable outside VS Code, by design); `iris_server_profiles` reports where each profile's connection fields came from via `source` (`"env"`/`"server-manager"`) and `sourceFile`. The companion variables are all optional, each with its own default: `IRIS_SM_SERVERS` (unset — import all), `IRIS_SM_SETTINGS_PATHS` (unset — normal discovery), `IRIS_SM_WORKSPACE` (unset — the process CWD) and `IRIS_CREDENTIAL_HELPER` (unset). Full model, discovery precedence, and the SecretStorage boundary explained plainly: [Server Manager connections](../../README.md#server-manager-connections-optional).

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
| `iris_doc_load` | Bulk upload files from disk into IRIS | `path` (glob), `baseDir?`, `compile?`, `flags?`, `namespace?`, `ignoreConflict?` (default: **true** — overwrite server copies even when newer) | idempotent |
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
| `iris_doc_xml_export` | Export, import, or list documents in XML format. Import loads definitions WITHOUT compiling by default (the response says so); pass `compile: true` to compile in the same call | `action`, `docs?`, `content?`, `compile?`, `flags?`, `namespace?` | destructive (import), not idempotent |

### SQL Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_sql_execute` | Execute a SQL query with parameterized values | `query`, `parameters?`, `maxRows?`, `namespace?` | -- |
| `iris_sql_analyze` | Analyze SQL: show query plan (`explain`), parse maps/indexes from the plan (`indexUsage`), cached-statement stats (`stats`), currently-running statements (`running`), or get SQL Performance Advisor findings (`advise`) | `action`, `query?`, `filter?`, `maxRows?`, `workload?`, `topN?`, `namespace?` | readOnly, idempotent |

> **Governance defaults:** all five `iris_sql_analyze` actions (`explain`/`stats`/`indexUsage`/`running`/`advise`) are classified `read` and are therefore **enabled by default** — none is gated behind `IRIS_GOVERNANCE`. (A `read` classification is still required for every new tool key, but reads resolve enabled under the default seed.)
>
> **`advise` — SQL Performance Advisor (Epic 28):** given `query` (or `workload: true` to advise the top-`topN` recent statements instead, mutually exclusive with `query`), returns evidence-cited findings — `full-scan`, `missing-index` (with a suggested `CREATE INDEX` DDL), `stale-stats`, `unused-index`, `plan-anomaly` — each carrying a plan excerpt and a confidence level. **Strictly advisory: recommendations are heuristic; verify with `explain` before applying any change** — `advise` never applies anything itself (no write/`applyIndex` action ships in v1). `topN` (default 5, max 20) bounds real analysis work in `workload` mode, not just output size — each statement analyzed is a full endpoint round-trip (EXPLAIN + dictionary reads), so a larger `topN` is proportionally more work. If the recent-statement workload source is unavailable on your IRIS edition/version, `workload` mode returns a clear capability message rather than a raw SQL error.
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
| `iris_execute_classmethod` | Invoke a class method by name with up to 20 positional arguments (plain scalars or `{byRef, value?}` markers for `ByRef`/`Output` parameters). Captures any `Write` output from the target (no wrapper class needed for narrating methods, stock runners like `%UnitTest.Manager.RunTest`, or targets that switch namespace mid-call) and returns marked positions' post-call values | `className`, `methodName`, `args?`, `namespace?` | -- |
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

**Glob shape matters (Story 35.9).** The base for document-name mapping is the directory prefix
before the first glob metacharacter, so the wildcard must come BEFORE the package directory.
`.../src/ClineTest/*.cls` swallows the `ClineTest` package directory into the base and would map
`ClineTest/Wumpus.cls` to the unqualified `Wumpus.cls`. The tool now REFUSES such uploads: for
`.cls`/`.mac`/`.int`/`.inc` files whose own `Class <Pkg.Name>` / `ROUTINE <Name>` declaration
disagrees with the path-derived name, the file lands in `failures[]` with both names named and is
never uploaded or compiled (IRIS would otherwise store it under the content-declared name while the
tool reported the wrong one). Headerless files (`.inc` fragments, CSP pages) have no declaration and
keep pure path-derived naming.

**BOM and server-reported per-file errors (Story 35.9 rework).** A leading UTF-8 BOM is stripped
before upload (IRIS rejects a BOM'd first line as an illegal header). And a PUT that returns
HTTP 200 can still fail per-document — Atelier reports it only as a string `status` field in the
per-doc result (e.g. `ERROR #16021: Illegal Header Line: ...`) while storing nothing. The tool
surfaces that string as an upload failure in `failures[]` instead of counting the file as uploaded.

**Refused input (trap-shaped glob):**
```json
{
  "path": ".../src/ClineTest/*.cls",
  "compile": true
}
```

**Refusal output:**
```json
{
  "total": 2,
  "uploaded": 0,
  "failed": 2,
  "failures": [
    {
      "file": ".../src/ClineTest/Wumpus.cls",
      "docName": "Wumpus.cls",
      "error": "Refusing to upload 'Wumpus.cls': the path-derived name does not match the file's declared identity 'ClineTest.Wumpus'. The glob pattern's base directory swallowed the package directory — use a wildcard before the package directory (e.g. '.../src/**/*.cls') or pass baseDir='.../src'."
    }
  ]
}
```

**Two remedies, both work:** move the wildcard before the package directory
(`"path": ".../src/**/*.cls"`), or keep the narrow glob and state the package root
deterministically with the optional `baseDir` parameter:

```json
{
  "path": ".../src/ClineTest/*.cls",
  "baseDir": ".../src",
  "compile": true
}
```

Both upload `ClineTest.Wumpus.cls` / `ClineTest.WumpusCave.cls` and compile clean. `baseDir` does
not bypass the content cross-check — it is defense-in-depth, not an override.
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
<summary><strong>iris_doc_xml_export</strong> -- Import from XML (with compile)</summary>

An import **loads definitions without compiling them** by default — the response then includes a note saying the documents are NOT compiled (remedy: `compile: true`, or `iris_doc_compile` afterwards). Pass `compile: true` to compile in the same call; `flags` (e.g. `"cku"`) is honoured only when `compile` is true, and the `c` compile qualifier is folded in automatically when absent or explicitly negated (IRIS qualifier letters are case-insensitive; `-c` negates, so `-c` becomes `-cc` — the last `c` wins). A compile failure still returns HTTP-level success from IRIS — the error text surfaces in the response as a `Per-file status (...)` note.

**Input:**
```json
{
  "action": "import",
  "content": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Export generator=\"IRIS\" version=\"26\">\n<Class name=\"MyApp.Service\">\n<Super>%RegisteredObject</Super>\n</Class>\n</Export>",
  "compile": true
}
```

**Output:**
```json
{
  "content": [
    {
      "file": "import.xml",
      "imported": ["MyApp.Service.cls"],
      "status": ""
    }
  ]
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
<summary><strong>iris_sql_analyze</strong> -- SQL Performance Advisor (<code>advise</code>)</summary>

**Input (query mode):**
```json
{
  "action": "advise",
  "query": "SELECT ID, UnindexedCol FROM MyApp.Orders WHERE UnindexedCol = 'X'"
}
```

Or workload mode (advise the 5 most recent statements instead of one query):
```json
{ "action": "advise", "workload": true, "topN": 5 }
```

`query` and `workload` are mutually exclusive. **Recommendations are heuristic; verify with `explain` before applying any change** — `advise` only recommends and cites evidence, it never applies anything.

**Output (`structuredContent`):**
```json
{
  "mode": "query",
  "findings": [
    {
      "type": "missing-index",
      "confidence": "high",
      "statement": "SELECT ID, UnindexedCol FROM MyApp.Orders WHERE UnindexedCol = 'X'",
      "evidence": "Predicate column(s) UnindexedCol on MyApp.Orders have no index with it as the leading subscript (existing indexes checked: IDKEY).",
      "recommendation": "Consider: CREATE INDEX IdxUnindexedCol ON MyApp.Orders (UnindexedCol). Verify with EXPLAIN after creation.",
      "suggestedDdl": "CREATE INDEX IdxUnindexedCol ON MyApp.Orders (UnindexedCol). Verify with EXPLAIN after creation.",
      "planExcerpt": "Read master map MyApp.Orders.IDKEY, looping on ID."
    }
  ],
  "analyzed": { "statements": 1, "skipped": 0 },
  "notes": []
}
```

When no findings are identified, the response says so explicitly along with what was checked (e.g. `"No performance findings (mode: query). Checked 1 statement ..."`) rather than returning silently empty. In `workload` mode, a statement that fails to `EXPLAIN` is counted in `analyzed.skipped`, not treated as a fatal error; if the recent-statement workload source itself is unavailable on your IRIS edition/version, the call returns a clear capability message instead of a raw SQL error.
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
  "output": "Hello from IRIS",
  "truncated": false
}
```

`output` is capped at **32768 RAW characters** (Story 34.6 AC 34.6.1; the ceiling bounds
raw content, not the serialized wire size — see below) — content beyond the ceiling is cut
off and replaced with a structured, machine-detectable marker
(`[IRIS-MCP-TRUNCATED ceiling=32768chars]`), never a bare `...`. **This ceiling bounds the
response payload only**: the command has already fully executed by the time it is applied,
so it is not protection against the command's own execution time or resource usage, and it
is not a Web Gateway timeout safeguard (Rule #38) — live measurement found the CSP
Gateway/HTTP transport tolerates multi-megabyte responses cleanly (tested clean to
3,000,000 characters). The 32768 value was chosen because a real MCP client (Claude Code
CLI) was observed diverting a rendered tool result away from inline consumption once it
reached 50,031 characters — 32768 stays safely under that measured boundary.

**Raw characters vs. serialized JSON size (Story 34.7, AC 34.7.4).** The 32768 figure is
measured via `$Length` on the raw content **before** JSON string escaping — it is not a
promise about the HTTP response body's own byte size. Quotes, backslashes, and control
characters each expand under JSON escaping (a quote or backslash becomes a 2-character
escape; a control character with no short escape becomes a 6-character `\uXXXX` escape),
so metacharacter-heavy output can serialize to several times the raw-character ceiling.
Live-measured inflation, each row a single field holding exactly 32768 **raw** characters
(so the raw ceiling is honored identically in all three):

| content | serialized HTTP body | inflation |
|---|---|---|
| escaping-neutral plain letters | 32,860 | 1.0x |
| mixed metacharacters (quote, backslash, tab, one control char) | 98,311 | 3.0x |
| **worst case — all C0 control characters** (`\uXXXX`, 6 chars each) | **196,495** | **6.0x** |

**Honest residual risk:** the worst case is about **6x** the raw ceiling — roughly **3.9x
past** the 50,031-character client-divert threshold cited above, which was the entire
rationale for the 32768 figure. The shared budget substantially reduces the pre-34.7 worst
case (which was this same inflation again per independent field) but does **not** restore
that safety margin for metacharacter-heavy content. Tracked as `34-7-QA-1` in
`deferred-work.md`.

`truncated` is `true` whenever `output` does not contain everything the command wrote,
whether because it hit the 32768-character ceiling above or the platform's long-string
ceiling mid-command — the call still succeeds, with whatever was captured up to that
point, and this is never silent. On a FAILED call the tool reports the error text
as usual, and additionally surfaces `truncated` in the response's `structuredContent`
(e.g. `{"truncated": false}` alongside `"isError": true`) whenever the underlying REST
error envelope carried the flag — verified live against the real `/command` endpoint
(Story 34.5). `structuredContent` is omitted entirely, not set to `false`, on any IRIS
error whose response envelope never carried the flag — a request rejected before the
server's capture logic began, or a server predating Story 34.4. (A transport-level
failure such as a refused connection is a different case again: it raises a connection
error rather than producing a tool error response at all.)
</details>

<details>
<summary><strong>iris_execute_classmethod</strong> -- Call a class method</summary>

Each `args` entry is either a plain scalar (by value) or a `{"byRef": true, "value"?: ...}`
marker for a `ByRef`/`Output` parameter — up to 20 positions total. Any `Write` output the
target produces is captured (no wrapper class needed for narrating methods, stock runners
like `%UnitTest.Manager.RunTest`, or targets that switch namespace mid-call) and returned
in `output`; `argCount` is unchanged from prior versions of this tool.

**Response payload budget (Story 34.6 AC 34.6.1, revised by Story 34.7 AC 34.7.3 — ledger
`34-6-CR2-6`).** `returnValue`, `byRefValues`, and `output` **share ONE 32768-RAW-character
response budget** — not three independent 32768 budgets — spent in this field order:
`returnValue` first (the method's actual result, usually small, so it is never starved by
narration), then `byRefValues`, then `output` last (narration is usually the field that
actually exceeds the budget, so it usually absorbs the truncation). Whatever a field does
not use is available to the next one: a small `returnValue` leaves nearly the whole 32768
for `byRefValues`/`output`, while a `returnValue` alone longer than 32768 characters
consumes the **entire** budget, leaving nothing for the other two. Truncated content is cut
off and replaced with a structured, machine-detectable elision marker
(`[IRIS-MCP-TRUNCATED ceiling=<N>chars]`, where `<N>` is however much of the shared budget
remained for that field at that point — not always 32768), never a bare `...`. Flagged via
`returnValueTruncated` (for `returnValue`), `truncated` (for `output`), and `byRefTruncated`
(for `byRefValues`) — three separate booleans, retained from the pre-34.7 shape, since each
describes a different response field.

`byRefValues` (marked positions' post-call values, keyed by zero-based index) is
**additionally** bounded by its own **1000-node structural ceiling**, independent of (and on
top of) the shared character budget above. The shared budget is charged for every piece of
`byRefValues` content emitted — leaf values, `<Object:...>` placeholders, and subscript keys
— but not for the per-node JSON scaffolding, which the 1000-node ceiling bounds instead.
Once either budget is exhausted, further subscript entries are omitted from the affected
node (marked `subscriptsTruncated: true`), and a marked position reached after the shared
budget is already gone is **omitted from `byRefValues` entirely**. A position reached with
budget still remaining, but whose value does not fit in what remains, is cut short in one of
two ways: with the elision marker described above when there is room for the marker itself,
or — when the remaining budget is smaller than the marker (under ~40 characters) — as a
**plain unmarked prefix** of the real value, since emitting the marker there would replace a
value with something larger than itself (Story 34.6 code-review finding CR-6). In that last
case `byRefTruncated` is the **only** signal — the value carries no marker of its own, so
the absence of a marker is not proof that a byRef value is complete.

**Raw characters vs. serialized JSON size (Story 34.7, AC 34.7.4).** The 32768 figure is
measured via `$Length` on each field's raw content **before** JSON string escaping — it is
not a promise about the HTTP response body's own byte size. Quotes, backslashes, and
control characters each expand under JSON escaping (a quote or backslash becomes a
2-character escape; a control character with no short escape becomes a 6-character `\uXXXX`
escape), so metacharacter-heavy content can serialize to several times the raw-character
budget. Live-measured worst case: a single 32768-raw-character field of C0 control
characters (consuming the ENTIRE shared budget by itself) serialized to a
**196,495-character** HTTP response body — 6.0x the raw ceiling. See the measurement table
under `iris_execute_command` above for the full escaping-neutral / mixed / worst-case
range. This supersedes the earlier, now-inapplicable per-field measurement ("two
32768-character fields serializing to 131,102 characters"), which described the pre-34.7
independent-budget shape. **Honest residual risk:** 196,495 is roughly **3.9x past** the
50,031-character client-divert threshold documented under `iris_execute_command` above,
which was the entire rationale for the 32768 figure — the shared budget reduces but does
not eliminate the risk that a metacharacter-heavy response gets diverted away from inline
consumption by an MCP client. Tracked as `34-7-QA-1` in `deferred-work.md`.

**Truncated `output` is not always marked.** Because `output` is spent **last**, it can be
left a remainder smaller than the elision marker itself (~37-41 characters). In that band
`output` is a plain hard-cut prefix with **no** `[IRIS-MCP-TRUNCATED …]` marker at all —
exactly the fallback described for `byRefValues` below. As there, `truncated: true` is then
the **only** signal, so the absence of a marker is not proof that `output` is complete.

None of these ceilings are protection against the
target's own execution time, resource usage, or a Web Gateway timeout — the target has
already fully run by the time these caps are applied to the response payload. On a FAILED
call the tool reports the error text as usual, and additionally surfaces `truncated` in the
response's `structuredContent` whenever the underlying REST error envelope carried the
flag — same mechanism as `iris_execute_command` above (Story 34.5).

**Input (plain scalars):**
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
  "returnValue": "7",
  "argCount": 2,
  "output": "",
  "byRefValues": {},
  "truncated": false,
  "byRefTruncated": false,
  "returnValueTruncated": false
}
```

**Input (an `Output` parameter via a `byRef` marker):**
```json
{
  "className": "MyApp.Utils",
  "methodName": "Summarize",
  "args": [{ "byRef": true }]
}
```

**Output:**
```json
{
  "returnValue": "ok",
  "argCount": 1,
  "output": "",
  "byRefValues": { "0": "summary text" },
  "truncated": false,
  "byRefTruncated": false,
  "returnValueTruncated": false
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

A run that matches zero test methods at any level — a typo'd class or method name, or a
`class:method` spec the runner doesn't match — returns an explicit `error` field naming
the target and level instead of a silent `total: 0, passed: 0, failed: 0`
(Story 34.5). This response carries **both** `isError: true` **and** `structuredContent`
set to the same object shown in the text content (Story 34.6, AC 34.6.4 — a recorded
Project Lead decision: the guard fires only when the target produced nothing, a failed
request rather than a clean run, so `isError` is truthful; carrying `structuredContent`
keeps `structuredContent.total` reading `0` with a populated `error` rather than
regressing to `undefined` for structured consumers). Applied identically to every guard
path — package/class/method levels and the package discovery-time check:
```json
{
  "total": 0,
  "passed": 0,
  "failed": 0,
  "skipped": 0,
  "details": [],
  "error": "No tests found for 'MyApp.Tests.UtilsTest:TestTypo' at level 'method'"
}
```

If the runner instead reports that the target was found but the run failed before any
test method could execute — a setup failure such as an `OnBeforeAllTests` error — the
`error` field carries that reason rather than the generic "not found" wording, so a
broken fixture is never misreported as a misspelled target (same `isError`/
`structuredContent` shape as above):
```json
{
  "total": 0,
  "passed": 0,
  "failed": 0,
  "skipped": 0,
  "details": [],
  "error": "Test run for 'MyApp.Tests.UtilsTest' at level 'class' produced no method-level results — MyApp.Tests.UtilsTest: OnBeforeAllTests: ERROR #5001: ..."
}
```

At `level: "method"`, use the method's real, `Test`-prefixed name (e.g.
`MyApp.Tests.UtilsTest:TestAdd`) — the same form shown in `details[].method`
above. Internally the tool strips that prefix before querying IRIS's Atelier
test-runner endpoint (which matches on the unprefixed form) and restores it on
every result row, so the documented prefixed form is what you should always
pass and always see back; you do not need to do this stripping yourself.
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

## Known Limitations

### Non-ASCII request-body content was mis-decoded (fixed in Story 34.8)

`iris_execute_command`'s `command`, `iris_execute_classmethod`'s `args`, and `iris_global_set`'s `value` are all read through a shared request-body parser. Before Story 34.8 it mis-decoded non-ASCII JSON content (UTF-8 read as Latin-1) — e.g. an emoji arrived corrupted as several garbled characters matching its raw UTF-8 byte values, with **no error and no truncation flag** (`HTTP 200`, silently wrong). For `iris_global_set` this corrupted data **at rest** in the target global.

**This is now fixed** — accented characters, CJK, and emoji all round-trip correctly, and plain ASCII is unaffected. **The fix is forward-only**: data already written corrupted (e.g. via `iris_global_set` before upgrading) is **not** automatically repaired — there is no repair tool for previously-corrupted data.

The decoder is **lenient rather than validating**: invalid byte sequences (orphan continuation bytes, truncated sequences, unpaired surrogates) are replaced with a literal `?` under `HTTP 200` rather than rejected, and non-canonical "overlong" encodings are decoded rather than refused — which has a filter-bypass implication if you byte-inspect these request bodies upstream. Full detail on both, plus the security note: see the [suite README's Known Limitations](../../README.md#known-limitations) and ledger item `34-6-CR-7`.

---

[Back to IRIS MCP Server Suite](../../README.md)
