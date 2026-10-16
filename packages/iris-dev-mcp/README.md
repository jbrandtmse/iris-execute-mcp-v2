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

Set `IRIS_TOOLS_PRESET=core` to trim this server's `tools/list` to a **15-tool runtime roster** (14 package tools + `iris_server_profiles`; about 13 is a guideline, not a hard limit) — the authoring loop (get/edit/put/list/compile/load), the execution & debug loop (command/classmethod/tests, global get/set/kill), and the SQL tools `iris_sql_execute` and `iris_sql_query`. `iris_doc_get` and `iris_doc_edit` are a pair and stay co-visible in every preset. `IRIS_TOOLS_PRESET=developer` keeps all **32 runtime tools** (31 + `iris_server_profiles`) visible — every tool on this server is already dev-relevant, so `developer` behaves like `full` here. Omit (or set `"full"`) for today's behavior — every tool visible, byte-for-byte. `IRIS_TOOLS_DISABLE`/`IRIS_TOOLS_ENABLE` hide/force-show individual tools independent of the preset. This is orthogonal to `IRIS_GOVERNANCE_PRESET` above (visibility = does the agent know a tool exists; governance = is an already-visible call allowed). Full model, exact per-tool roster, and the payload-size measurements: [Tool Visibility Presets](../../README.md#tool-visibility-presets).

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
| `iris_doc_get` | Retrieve a document by name (UDL or XML format), or a numbered line range of a UDL text document | `name`, `namespace?`, `format?`, `metadataOnly?`, `startLine?`, `endLine?` | readOnly, idempotent |
| `iris_doc_put` | **Debug/scratch** — write a document directly to IRIS without creating a file on disk (use `iris_doc_load` for production code). An existing document is saved only if it has not changed since the tool read its current version; a put to an existing class that drops one of its Storage definitions is refused | `name`, `content`, `namespace?`, `ignoreConflict?` (default: **false**; skips the version check), `allowStorageRegeneration?` (default: **false**; lets a put that drops Storage definitions through) | idempotent |
| `iris_doc_edit` | Surgical line edits of an existing class, routine or include file: `insert`, `delete` or `replace` lines addressed by the numbers of a ranged `iris_doc_get`, each guarded by its `expected` text; all edits apply or none, in one version-checked save, and the answer (a unified diff, an excerpt per edit, `totalLines`, `ts`) comes from a re-read. Does not compile. **`apply` is a write that is enabled by default** (Project Lead decision S-3: every edit is guarded by `expected`, the save is version-checked and never retried, and a class edit that would drop a Storage definition is refused); disable it with `{"global": {"iris_doc_edit:apply": false}}`, or by disabling `iris_doc_put`. `regenerateStorage` (the Storage-guard override) is **disabled by default** | `action` (`apply` \| `regenerateStorage`), `name`, `edits` (each: `op`, `afterLine?`, `startLine?`, `endLine?`, `text?`, `expected`), `namespace?` | destructive |
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
| `iris_sql_execute` | Execute a SQL statement with parameterized values; optionally read-only, capped by rows affected, or count-only | `query`, `parameters?`, `maxRows?`, `readOnly?`, `maxRowsAffected?`, `countOnly?`, `namespace?` | -- |
| `iris_sql_query` | Run a SQL query (SELECT only) with parameterized values; read, enabled by default, available under the read-only preset | `query`, `parameters?`, `maxRows?`, `countOnly?`, `namespace?` | readOnly, idempotent |
| `iris_sql_analyze` | Analyze SQL: show query plan (`explain`), parse maps/indexes from the plan (`indexUsage`), cached-statement stats (`stats`), currently-running statements (`running`), or get SQL Performance Advisor findings (`advise`) | `action`, `query?`, `filter?`, `maxRows?`, `workload?`, `topN?`, `namespace?` | readOnly, idempotent |

> **Governance defaults:** all five `iris_sql_analyze` actions (`explain`/`stats`/`indexUsage`/`running`/`advise`) are classified `read` and are therefore **enabled by default** — none is gated behind `IRIS_GOVERNANCE`. (A `read` classification is still required for every new tool key, but reads resolve enabled under the default seed.)
>
> **`advise` — SQL Performance Advisor (Epic 28):** given `query` (or `workload: true` to advise the top-`topN` recent statements instead, mutually exclusive with `query`), returns evidence-cited findings — `full-scan`, `missing-index` (with a suggested `CREATE INDEX` DDL), `stale-stats`, `unused-index`, `plan-anomaly` — each carrying a plan excerpt and a confidence level. **Strictly advisory: recommendations are heuristic; verify with `explain` before applying any change** — `advise` never applies anything itself (no write/`applyIndex` action ships in v1). `topN` (default 5, max 20) bounds real analysis work in `workload` mode, not just output size — each statement analyzed is a full endpoint round-trip (EXPLAIN + dictionary reads), so a larger `topN` is proportionally more work. If the recent-statement workload source is unavailable on your IRIS edition/version, `workload` mode returns a clear capability message rather than a raw SQL error.
>
> **Governance defaults (SQL):** `iris_sql_execute` keeps its pre-governance classification (a write that is **enabled by default**, so it is blocked by the read-only preset). `iris_sql_query` (Story 38.5) is classified `read` and is therefore **enabled by default**, and it stays enabled under the read-only preset. Its parent key is `iris_sql_execute`: when an operator explicitly disables `iris_sql_execute`, `iris_sql_query` is disabled too (a `GOVERNANCE_DISABLED` refusal with `inheritedFrom: "iris_sql_execute"`), unless `iris_sql_query` is set explicitly, e.g. `{"global":{"iris_sql_execute":false,"iris_sql_query":true}}`. See [Parent keys](../../README.md#parent-keys-a-new-tool-that-re-exposes-an-existing-one).
>
> **SQL write safety (optional, opt-in — Story 38.5):** `iris_sql_execute` takes `readOnly` (default `false`: only queries run; any other statement is refused with `SQL_READ_ONLY` before it runs), `maxRowsAffected` (default: no cap; `0` is a dry count: an INSERT, UPDATE or DELETE that changes more rows is rolled back and refused with `SQL_ROWS_AFFECTED_CAP`; under a cap only SELECT, INSERT, UPDATE and DELETE run, and an INSERT, UPDATE or DELETE whose text contains the `%NOJOURN` token (a comment or a string counts) is refused before it runs, because it turns journaling off and the rollback could not undo it; the count is the statement's own row count, so rows that triggers, cascades or functions change are not counted and a SELECT is not bounded by it) and `countOnly` (default `false`: returns `totalCount` and no rows). An operator may set `IRIS_SQL_READ_ONLY=true` (every call read-only; unset by default) and `IRIS_SQL_MAX_ROWS_AFFECTED` (a non-negative integer ceiling; unset by default); a call can only tighten them, and the result carries `readOnlyForced` or `maxRowsAffectedCapped` when one applied. Both variables are global: every profile inherits them. An INSERT, UPDATE or DELETE result carries `rowsAffected` (`-1` for `TRUNCATE TABLE`). Read-only is **statement-level read-only, not side-effect-free**: the statement runs inside a transaction that is always rolled back, which does not undo `$INCREMENT`/`$SEQUENCE` counters (row ID counters included), process-private or IRISTEMP globals, changes made with `%NOJOURN` by a function, procedure or trigger the statement runs, work that parallel query worker processes do (`%PARALLEL`), `JOB` or device output, other external effects, or a function, procedure or trigger that starts, commits or rolls back a transaction (reported as an error when the transaction level the tool opened has changed, which a commit followed by a new `TSTART` does not show; some changes may be saved). A capped statement that is rolled back leaves the same effects. Both tools run through the ExecuteMCPv2 `/dev/sql/execute` endpoint, which the bootstrap deploys; `iris_sql_query` always runs read-only.
>
> **SQL resource caps (optional, opt-in):** an operator may set `IRIS_SQL_MAX_ROWS` (a ceiling on the number of rows `iris_sql_execute` and `iris_sql_query` **return** — the response carries `rowsCapped: true` when it clamps the caller's request, distinct from the pre-existing `truncated`/`totalAvailable`; it bounds the returned row count post-fetch, not the server-side result set or transfer) and/or `IRIS_SQL_TIMEOUT` (a per-request timeout in **seconds**) as environment variables. Both are unset by default (no cap, today's behavior) and apply regardless of `IRIS_GOVERNANCE_PRESET`. Details: [suite README](../../README.md#read-only-mode-point-it-at-production-with-one-environment-variable).
>
> **`iris_execute_tests` wait budget (optional, opt-in — Story 36.1):** an operator may set `IRIS_TEST_TIMEOUT` (the tool's DEFAULT wait budget, in **seconds**, before it returns a "running" result instead of blocking further) as an environment variable. Unset by default — the tool keeps its 120-second default. It applies to every server profile (named `IRIS_PROFILES` entries inherit it, like `IRIS_SQL_TIMEOUT`). A per-call `timeout` argument, when given, takes precedence over `IRIS_TEST_TIMEOUT`. See the `iris_execute_tests` detail section below for the full running-result contract.

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
| `iris_execute_tests` | Run unit tests (package, class, or method level). A run that outlives its wait budget returns a non-error "running" result carrying `jobId`/`runIndex` handles instead of a timeout error — see detail below | `target`, `level`, `timeout?`, `namespace?` | readOnly, idempotent |

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

### Test Status Tools

| Tool | Description | Key Parameters | Annotations |
|------|-------------|----------------|-------------|
| `iris_test_status` | Companion to `iris_execute_tests` (Story 36.2): re-attach to a test run by `jobId` and/or read it by `runIndex` (`action: "poll"`), or stop a running one (`action: "cancel"`) — see detail below | `action`, `jobId?`, `runIndex?`, `namespace?` | destructive |

> **Governance defaults:** `iris_test_status:poll` is classified `read` and is therefore **enabled by default**. `iris_test_status:cancel` is truthfully classified `write` and is **DEFAULT-DISABLED** (it deliberately does not use the `defaultEnabled` mechanism — stopping a run is not a recovery-of-last-resort action like `iris_production_control:clean`); enable it via `IRIS_GOVERNANCE`, e.g. `{"global":{"iris_test_status:cancel":true}}`.

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
  "content": ["Class MyApp.Service {", "", "ClassMethod Hello() As %String", "{", "  Quit \"Hello World\"", "}", "", "}", ""],
  "ts": "2026-04-07 10:30:00.000"
}
```
</details>

<details>
<summary><strong>iris_doc_get with a line range</strong> -- Read part of a UDL text document</summary>

Pass `startLine` and/or `endLine` (1-based, inclusive) to read part of a class, routine or include file instead of
the whole document. Use a range for **large classes**, and to read the **exact lines before changing them with
`iris_doc_edit`**, which uses the same line numbers. A ranged read is still one request for the whole document; the
lines are cut from it afterwards, so it saves the agent's context, not IRIS's work.

**Input:**
```json
{
  "name": "MyApp.Service.cls",
  "startLine": 3,
  "endLine": 5
}
```

**Output (text):** a header line, then the lines in the `cat -n` layout: the line number right-aligned in 6 columns, a
tab, then the line exactly as IRIS holds it (leading tabs, trailing spaces and empty lines included).
```
Document 'MyApp.Service.cls' in namespace 'USER': lines 3-5 of 9 (ts 2026-04-07 10:30:00.000)
     3	ClassMethod Hello() As %String
     4	{
     5	  Quit "Hello World"
```

**Output (`structuredContent`):**
```json
{
  "name": "MyApp.Service.cls",
  "ts": "2026-04-07 10:30:00.000",
  "startLine": 3,
  "endLine": 5,
  "totalLines": 9,
  "lines": ["ClassMethod Hello() As %String", "{", "  Quit \"Hello World\""]
}
```

- **Numbering.** Line N is element N-1 of the line array that IRIS returns, after one leading byte-order mark is removed.
  A class ends with an empty last line, and it counts: `totalLines` is 9 for the 9-element `content` array of the
  full-read example above, whose last element is that empty line. `iris_loc_count` reports the same `totalLines` for a
  class. A routine's or include file's line 1 is its `ROUTINE` header: `ROUTINE <name>` for a `.mac` routine (IRIS
  drops the type), `ROUTINE <name> [Type=INC]` for an include file.
- **Defaults and clamp.** `startLine` alone reads to the last line; `endLine` alone reads from line 1. An `endLine`
  past the end is clamped to the last line, and the response shows the effective `startLine` and `endLine`.
- **`ts`.** The document's version timestamp, the same string `metadataOnly` returns as `etag`. `iris_doc_edit` sends it
  back to IRIS so that an edit cannot overwrite a change it did not see.
- **Without the parameters** the request and the result are unchanged: the whole document, as before.
- **Errors** (`isError: true`, nothing is read into the result):
  - `startLine` or `endLine` is not a whole number of at least 1: the argument check refuses it before the tool runs (an `Invalid arguments` error that names the parameter).
  - `startLine` is after `endLine`, or past the last line (the message states the document's `totalLines`).
  - A range with `metadataOnly`, or with `format: "xml"`: ranges apply only to UDL text.
  - A binary document (the message names it), or a document IRIS cannot read (the message names it and carries IRIS's reason).
</details>

<details>
<summary><strong>iris_doc_put</strong> -- Debug/scratch: write a document directly to IRIS</summary>

**Debug/scratch tool** — for production code, use `iris_doc_load` to ensure source
control and review. This tool writes content directly to IRIS without creating a
file on disk, and is intended for one-off inspection, quick reproductions, or
throwaway test classes only. A leading byte-order mark is stripped from the content
before it is sent, and a write IRIS refuses (a non-empty `result.status` inside an
HTTP 200 response) is returned as an error carrying IRIS's text; nothing is stored then.

- **Existing documents.** A document that does not exist yet is created by one request. For a document that exists,
  IRIS refuses an unversioned write with HTTP 409 and the document's current text and version; the tool uses that
  answer as its read, then saves once more with `If-None-Match` set to that version. A 409 on that save means the
  document changed meanwhile: the tool returns a `DOCUMENT_CONFLICT` refusal (nothing stored) and never retries.
  `ignoreConflict` (default **false**) skips the version check. No path sends an extra GET or HEAD.
- **Storage guard.** A persistent class keeps its Storage definitions (the map from properties to the globals that
  hold its rows) in its source. A put to an existing class whose content drops one of those definitions is refused
  with `STORAGE_DROPPED` and nothing is stored, because IRIS would generate new storage at the next compile, which can
  change how existing rows are read. Names are compared exactly: a rename is a drop, and changing a definition's
  content is allowed. `allowStorageRegeneration: true` (default **false**) lets the put through, and then the
  next compile regenerates the storage. The guard applies to `.cls` documents only, in UDL or XML form. It reads the
  class text the way IRIS does for the forms it is tested against; in a few hand-written forms (a brace hidden in
  embedded SQL or HTML, for example) it can miss a drop.
- **Unguarded paths.** The guard covers `iris_doc_put` and `iris_doc_edit` (action `apply`). `iris_doc_load` (a file is the source of truth for its
  class, uploaded with `ignoreConflict` on by default), the `iris_env_promote` `execute` sync (it replaces the target
  class by design) and the `iris_doc_xml_export` import (an XML export carries its own Storage) do not run it. The
  bootstrap's own classes have no Storage definitions. `iris_docdb_document` and `iris_global_set` write DocDB
  records and global nodes, not documents. A test lists every document-writing path with its verdict.

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

**Refusal** (`isError: true`, nothing stored) when the class has Storage definitions `Default` and `Second` and the
content keeps only `Default`:
```text
Document 'MyApp.Orders.cls' was not saved in namespace 'USER': the content drops the Storage definition 'Second' that the class has now, and IRIS would generate new storage at the next compile, which can change how existing rows are read. Nothing was stored. Keep the Storage definitions in the content (read the class with iris_doc_get first), or pass allowStorageRegeneration: true to let IRIS regenerate the storage.
```
```json
{
  "code": "STORAGE_DROPPED",
  "name": "MyApp.Orders.cls",
  "namespace": "USER",
  "droppedStorage": ["Second"]
}
```
</details>

<details>
<summary><strong>iris_doc_edit</strong> -- Surgical line edits of an existing document (Story 38.4)</summary>

Change a few lines of an existing class, routine or include file without resending the whole document. Read the exact
lines first with a ranged `iris_doc_get` (the two tools use the same 1-based line numbers and are always visible
together), then send the edits. Each edit is an `insert` (`afterLine`, `text`, `expected`; `afterLine: 0` inserts before
line 1), a `delete` (`startLine`, `endLine`, `expected`) or a `replace` (`startLine`, `endLine`, `text`, `expected`),
addressed in the numbering of that read.

- **Default state.** `action: "apply"` is a **write that is enabled by default**, the one exception to "a new write
  ships disabled" besides `iris_production_control:clean` (Project Lead decision S-3). Every edit is guarded by the
  `expected` text of the lines it changes, the save is version-checked, and a class edit that would drop a Storage
  definition is refused, so it does not overwrite a line whose text differs from what the agent expected. Disable it with
  `{"global": {"iris_doc_edit:apply": false}}`, or by disabling `iris_doc_put` (a disabled `iris_doc_put` makes both
  `iris_doc_edit` keys seed disabled, reported as `configSource: "parent"`; an explicit setting on `iris_doc_edit:apply`
  still wins). The read-only preset blocks it too. `action: "regenerateStorage"` (the Storage-guard override, below) is
  **disabled by default**. See [Parent keys](../../README.md#parent-keys-a-new-tool-that-re-exposes-an-existing-one).
- **`expected`.** The current text of the addressed lines (of line `afterLine`, or line 1 when `afterLine` is 0, for an
  insert). `text` and `expected` are parsed alike: one leading byte-order mark is dropped, one trailing line break is
  dropped, and CRLF and LF both separate lines, so `"a\nb\n"` and `"a\r\nb"` are both the two lines `a`, `b`. An empty
  `text` is one empty line; to remove lines use `delete`. Make `expected` distinctive when a line such as `}` is not
  unique: if another writer shifted lines before this tool's read, a non-unique line can still match.
- **All or nothing.** The tool reads the document once, checks every edit (shape, overlaps, line numbers, `expected`,
  Storage), applies them all bottom-up against the numbering of that read, and saves once with `If-None-Match` set to
  the version it read. Edits may come in any order. Two edits that address the same lines, or an insert inside a range
  another edit changes, are rejected before any request. Lines no edit touches are sent byte-identical.
- **Refusals** (`isError: true`, nothing stored): `STALE_CONTENT` lists every edit whose `expected` text differs from the
  document now, with the current text; `DOCUMENT_CONFLICT` means the document changed after the tool read it (never
  retried, and no `ignoreConflict` exists); `STORAGE_DROPPED` is the Storage guard of `iris_doc_put`, with this
  remedy: keep the Storage definitions in the edited lines, or run the same edits with `action: "regenerateStorage"`.
  Argument and range errors carry no code. IRIS refusing the text (a non-empty `result.status` inside an HTTP 200
  response) is returned as an error carrying IRIS's text.
- **The answer is a re-read.** IRIS reformats class source when it saves (it puts a blank line between members, for
  example), so the tool reads the document back and answers from that: `unifiedDiff` (3 context lines, the read against
  the re-read), one excerpt per edit (the lines the edit produced, plus 3 context lines on each side, as in a ranged
  `iris_doc_get` of the same range), the new `totalLines` and `ts`. Never the whole document. An edit whose result
  equals the stored text saves nothing and reports `changed: false`. A class edit that IRIS stores back as it was (it
  restores a deleted blank line between members, for example) is saved, re-read and also reported as `changed: false`,
  with an empty `unifiedDiff` and a text saying so.
- **No compile.** The tool does not compile: run `iris_doc_compile` next.

**Input:**
```json
{
  "action": "apply",
  "name": "MyApp.Service.cls",
  "namespace": "USER",
  "edits": [
    { "op": "insert", "afterLine": 3, "text": "/// Says hello.", "expected": "" },
    {
      "op": "replace",
      "startLine": 6,
      "endLine": 6,
      "text": "  Set name = $Get(^Names, \"World\")\n  Quit \"Hello \" _ name",
      "expected": "  Quit \"Hello World\""
    }
  ]
}
```

**Output (text):** the sentence, the diff, then one numbered excerpt per edit:
```text
Document 'MyApp.Service.cls' edited in namespace 'USER': 2 edits applied; it has 12 lines now (ts 2026-04-07 10:31:12.000). It is not compiled: run iris_doc_compile next.

--- MyApp.Service.cls	2026-04-07 10:30:00.000
+++ MyApp.Service.cls	2026-04-07 10:31:12.000
@@ -1,9 +1,11 @@
 Class MyApp.Service Extends %RegisteredObject
 {
 
+/// Says hello.
 ClassMethod Hello() As %String
 {
-  Quit "Hello World"
+  Set name = $Get(^Names, "World")
+  Quit "Hello " _ name
 }
 
 }

Edit 1 (insert after line 3), now lines 1-7:
     1	Class MyApp.Service Extends %RegisteredObject
     2	{
     3	
     4	/// Says hello.
     5	ClassMethod Hello() As %String
     6	{
     7	  Set name = $Get(^Names, "World")

Edit 2 (replace lines 6-6), now lines 4-11:
     4	/// Says hello.
     5	ClassMethod Hello() As %String
     6	{
     7	  Set name = $Get(^Names, "World")
     8	  Quit "Hello " _ name
     9	}
    10	
    11	}
```

**Output (`structuredContent`):**
```json
{
  "name": "MyApp.Service.cls",
  "namespace": "USER",
  "ts": "2026-04-07 10:31:12.000",
  "totalLines": 12,
  "changed": true,
  "unifiedDiff": "--- MyApp.Service.cls\t2026-04-07 10:30:00.000\n+++ MyApp.Service.cls\t2026-04-07 10:31:12.000\n@@ -1,9 +1,11 @@\n Class MyApp.Service Extends %RegisteredObject\n {\n \n+/// Says hello.\n ClassMethod Hello() As %String\n {\n-  Quit \"Hello World\"\n+  Set name = $Get(^Names, \"World\")\n+  Quit \"Hello \" _ name\n }\n \n }",
  "excerpts": [
    { "edit": 1, "op": "insert", "startLine": 1, "endLine": 7, "lines": ["Class MyApp.Service Extends %RegisteredObject", "{", "", "/// Says hello.", "ClassMethod Hello() As %String", "{", "  Set name = $Get(^Names, \"World\")"] },
    { "edit": 2, "op": "replace", "startLine": 4, "endLine": 11, "lines": ["/// Says hello.", "ClassMethod Hello() As %String", "{", "  Set name = $Get(^Names, \"World\")", "  Quit \"Hello \" _ name", "}", "", "}"] }
  ]
}
```

**Refusal** (`isError: true`, nothing stored) when a replace of line 6 expected `  Quit "Hello"` but the line reads
`  Quit "Hello World"`:
```text
Document 'MyApp.Service.cls' was not changed in namespace 'USER': the expected text of edit 1 does not match the document now. Nothing was stored. Retry with the current text below as expected, or read the lines again with iris_doc_get.

Edit 1 (replace lines 6-6), current text:
     6	  Quit "Hello World"
```
```json
{
  "code": "STALE_CONTENT",
  "name": "MyApp.Service.cls",
  "namespace": "USER",
  "ts": "2026-04-07 10:30:00.000",
  "totalLines": 10,
  "mismatches": [
    { "edit": 1, "op": "replace", "startLine": 6, "endLine": 6, "current": "  Quit \"Hello World\"" }
  ]
}
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

**Safety controls** (all optional; defaults: `readOnly` false, `maxRowsAffected` no cap, `countOnly` false). A DELETE capped at 2 rows that would change 3 is rolled back and refused:

```json
{ "query": "DELETE FROM Sample.Person WHERE Age > 90", "maxRowsAffected": 2 }
```

```json
{
  "isError": true,
  "structuredContent": {
    "code": "SQL_ROWS_AFFECTED_CAP",
    "namespace": "USER",
    "statementType": "DELETE",
    "rowsAffected": 3,
    "maxRowsAffected": 2,
    "capSource": "parameter"
  }
}
```

Within the cap the statement commits and the result is `{"columns": [], "rows": [], "rowCount": 0, "rowsAffected": 3}`. Under a cap, an INSERT, UPDATE or DELETE whose text contains the `%NOJOURN` token (a comment or a string counts) is refused with `SQL_ROWS_AFFECTED_CAP` before it runs and has no `rowsAffected`, because it turns journaling off and the rollback could not undo it. With `readOnly: true` (or `IRIS_SQL_READ_ONLY=true`) any statement that is not a SELECT is refused with `SQL_READ_ONLY` (`structuredContent` carries `statementType` and `readOnlySource`: `parameter`, `operator` or `tool`), and a SELECT forced by the operator variable carries `"readOnlyForced": true`. With `countOnly: true` a SELECT returns `{"columns": [], "rows": [], "rowCount": 0, "totalCount": 42}` and transfers no rows; `rowCount` keeps its meaning (rows returned). A function, procedure or trigger that starts, commits or rolls back the transaction this tool opened is reported as an error (no `code`), also when the statement then fails, because the tool could not check or undo it reliably; a commit followed by a new `TSTART` leaves the level unchanged and is not seen.
</details>

<details>
<summary><strong>iris_sql_query</strong> -- Query SQL (read-only)</summary>

Runs a SQL query (SELECT) in a transaction that is always rolled back. Use it for queries, including under the read-only governance preset, where `iris_sql_execute` is blocked. Any other statement, `CALL` included, is refused with `SQL_READ_ONLY` and `readOnlySource: "tool"`.

**Input:**
```json
{
  "query": "SELECT Name FROM %Dictionary.ClassDefinition WHERE Name %STARTSWITH ?",
  "parameters": ["MyApp."],
  "maxRows": 10
}
```

**Output:** `{"columns": ["Name"], "rows": [["MyApp.Service"], ["MyApp.Utils"]], "rowCount": 2}`; with `countOnly: true`, `{"columns": [], "rows": [], "rowCount": 0, "totalCount": 2}`. `IRIS_SQL_MAX_ROWS` (`rowsCapped`) and `IRIS_SQL_TIMEOUT` apply exactly as they do to `iris_sql_execute`; `IRIS_SQL_READ_ONLY` and `IRIS_SQL_MAX_ROWS_AFFECTED` have nothing to bound here.
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
  "deleted": true,
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

**`subscripts` contract and security note (Story 36.4):** `subscripts` is always treated as literal
DATA, never as code. The rules:

- The string is split on **every comma** — a string key that itself contains a comma is not
  supported. Leading/trailing whitespace around each piece (space, tab, non-breaking space) is
  trimmed.
- A canonical number (`1`, `-1.5`) is a numeric subscript. Anything else is a string subscript.
- Wrap a string key in quotes (`'"key1","key2"'`) and double any quote inside it (`'"a""b"'`
  addresses the single subscript `a"b`). Quotes, `_`, `$`, `@`, `(`, `)`, `^`, `|` and control
  characters inside a key are stored and addressed as that literal text — nothing in a subscript is
  ever executed.
- A piece that begins or ends with an unmatched quote — which is what a quoted key containing a
  comma turns into after the split, e.g. `'"a,b"'` — is rejected with a clear error instead of
  silently addressing a different node.

Before Story 36.4, a quote inside a string subscript could close the literal and the rest of the
value ran as ObjectScript — reachable through `iris_global_get` (a read-classified, default-enabled
tool) even under `IRIS_GOVERNANCE_PRESET=read-only`. This is fixed; see the CHANGELOG `### Security`
entry.

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
in `output`; `argCount` is unchanged from prior versions of this tool. Omitting `args` and
passing `[]` are the same zero-argument call.

**Capture caveat (ledger `34-3-R3` / `34-1-R13`, a documented limitation).** The capture
lives in the process-private variables `%ExecuteMCPOutput`/`%ExecuteMCPTruncated`, so a
target that KILLs them — an argumentless `KILL`, or a unit-test class whose setup/teardown
clears them — silently loses everything captured before that point, and `truncated` does
not report it. Run unit-test suites with `iris_execute_tests` rather than through this tool.

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

A completed run's `structuredContent` additionally carries `status: "completed"`,
`jobId`, `runIndex`, and `runIndexSource` — Story 36.1, so a caller can
correlate results by handle instead of guessing at `MAX(InstanceIndex)`.
`runIndexSource` is `"queue"` (read from the job's own
`IRIS.TempAtelierAsyncQueue(<jobId>,"unittest","id")` node on a still-running
poll) or `"counter"` (a run that finished before that node could be read: the
`^UnitTest.Result` counter read just before queueing vs. after completion moved
by exactly 1, and the run drained result rows). Otherwise both are `null` and a
`runIndexNote` says why (e.g. a concurrent run also allocated an index). Existing
fields (`total`/`passed`/`failed`/`skipped`/`details`) are unchanged.

### Long-running suites: `timeout` and the "still running" result (Story 36.1)

The tool waits up to 120 seconds by default before it stops blocking — override
per call with `timeout` (a positive number of **seconds**; hard-capped at 3600s,
a larger value is silently clamped and the response carries `timeoutCapped: true`)
or set `IRIS_TEST_TIMEOUT` as an environment-level default (precedence:
`timeout` argument > `IRIS_TEST_TIMEOUT` > the 120s default). **MCP clients
impose their own `tools/call` ceiling independently of this budget** — the MCP
TypeScript SDK defaults to 60 seconds, and several clients cap at 60s-2min (not
always configurable) — so a long `timeout` value is a convenience, not a
guarantee that the CLIENT will wait that long.

If the wait budget expires while the ObjectScript run is **still executing
server-side**, the tool returns a non-error result instead of a timeout error:

```json
{
  "status": "running",
  "jobId": "31797604",
  "runIndex": 256,
  "runIndexSource": "queue",
  "elapsedMs": 120204,
  "timeoutMs": 120000,
  "target": "MyApp.Tests.SlowSuite",
  "level": "class",
  "namespace": "HSCUSTOM",
  "partial": { "total": 2, "passed": 2, "failed": 0, "skipped": 0, "details": [] },
  "hint": "Still executing server-side. Do NOT re-submit. ..."
}
```

`isError` is `false` — the request succeeded; the run was submitted and is
executing. **This is not a failure and not a final result — do NOT re-submit
the same target**, which starts a SECOND concurrent run against shared test
fixtures. `partial` is the drained-so-far subset ONLY (never a top-level
`total` a consumer could mistake for a final count). Counts under `partial`
can go up on a later look, never down. On a running result `runIndexSource` is
`"queue"` or `null` — the counter fallback is never applied while a run is
still executing (another client's run could be counted instead); a `null`
index carries a `runIndexNote`. If polling an already-queued job fails
(an HTTP error or a network timeout), the error result still carries the
`jobId`, the drained-so-far `partial` rows and the same re-attach `hint`.

To see the run through, re-attach rather than re-submit — the response's `hint`
carries the exact calls:
- **Today, in every preset:** the `runIndex` (the response's own, or
  `iris_global_get` with global `IRIS.TempAtelierAsyncQueue` and subscripts
  `<jobId>,"unittest","id"` while the job is queued or running), then
  `iris_sql_execute`:

  ```sql
  SELECT ti.DateTime AS FinishedAt, tc.Name AS ClassName, tm.Name AS MethodName,
         tm.Status, tm.Duration, tm.ErrorDescription
  FROM %UnitTest_Result.TestMethod tm
  JOIN %UnitTest_Result.TestCase tc ON tm.TestCase = tc.ID
  JOIN %UnitTest_Result.TestSuite ts ON tc.TestSuite = ts.ID
  JOIN %UnitTest_Result.TestInstance ti ON ts.TestInstance = ti.ID
  WHERE ti.InstanceIndex = ?   -- parameters: [runIndex]
  ```

  Only `%UnitTest_Result.TestInstance` has an `InstanceIndex` column — the other
  result tables join down to it. **Never `MAX(InstanceIndex)`**, which can pick
  up a different, concurrently-started run. These rows exist while the run is
  still executing (a method still running already reads `Status` 1), so treat
  them as final only once `FinishedAt` is non-empty.
- **Easier — `iris_test_status`** (Story 36.2, enabled by default): call it
  with `action: "poll"` and the same `jobId` (and/or `runIndex`) and the run's
  own `namespace` (the Atelier queue is instance-wide but `%UnitTest_Result` is
  per-namespace, so it must match) — it builds
  the SAME `running`/`completed` shapes shown above, but sourced authoritatively
  from `%UnitTest_Result` by exact `InstanceIndex` once finished (never from a
  single drain alone). See its own detail block below.

**Concurrency caveat:** two runs of the SAME class started close together
share that class's fixtures, and the Atelier endpoint *predicts* a run's
index (reading the counter) slightly before `%UnitTest.Manager` actually
*allocates* it — a race between near-simultaneous submissions can misattribute
a run's own index. Avoid submitting the same target concurrently.

**Method-level target validation (Story 36.1):** at `level: "method"`, the
`ClassName:MethodName` target is trimmed and validated — more than one `:`
separator, or an empty class segment before `:`, returns an explicit
malformed-target error (distinct from the zero-result guard) instead of
silently discarding part of the target or querying an empty class name. If
the method name you typed doesn't match what actually ran (the endpoint's
`Test`-prefix-stripped filter is many-to-one — `Class:Validate` and
`Class:TestValidate` both resolve to the same wire filter), the response
carries an additive `methodMismatchWarning` field naming the mismatch rather
than staying silent about it.
</details>

<details>
<summary><strong>iris_test_status</strong> -- Re-attach, read, or cancel a test run (Story 36.2)</summary>

Companion to `iris_execute_tests`: use it after that tool returns
`status: "running"` (or after your own client abandoned a long call) instead
of re-submitting the same target — re-submitting starts a SECOND concurrent
run against shared fixtures.

**`action: "poll"` (read, enabled by default) — Input:**
```json
{ "jobId": "31797604", "namespace": "HSCUSTOM" }
```
`jobId` is the all-digits Atelier work-queue id `iris_execute_tests` returned —
anything else is refused before any IRIS call, as is a `jobId` whose queue
entry is not a unit-test job (a poll would otherwise drain another client's
result). Pass the run's own `namespace` (the one `iris_execute_tests`
reported): the Atelier work queue is instance-wide, but `%UnitTest_Result` is
per-namespace, so a different namespace reads a different run.
or, once the job is no longer known to Atelier (already consumed, or stale):
```json
{ "runIndex": 256 }
```

**Output while still running** (identical shape to `iris_execute_tests`'
own `running` result, `partial` being the DELTA this ONE poll drained —
never cumulative across separate calls):
```json
{ "status": "running", "jobId": "31797604", "runIndex": 256, "runIndexSource": "queue",
  "partial": { "total": 0, "passed": 0, "failed": 0, "skipped": 0, "details": [] },
  "hint": "..." }
```

**Output once finished** — built AUTHORITATIVELY from `%UnitTest_Result` by
exact `InstanceIndex` (`runIndexSource: "result-table"`), never from a single
drain alone (an earlier `iris_execute_tests` "running" response may already
have drained some rows, which never reappear). Every `details` row is
value-identical to what `iris_execute_tests` itself returns for the same run —
millisecond `duration`, drain order, and `message` including a method-level
error such as a thrown exception:
```json
{ "total": 1, "passed": 1, "failed": 0, "skipped": 0,
  "details": [{ "class": "MyApp.Tests.SlowSuite", "method": "TestSlow", "status": "passed", "duration": 10009.4, "message": "" }],
  "status": "completed", "jobId": "31797604", "runIndex": 256, "runIndexSource": "result-table" }
```
A finished run that recorded NO method-level results (e.g. a failed
`OnBeforeAllTests`) returns the same `isError: true` zero-result guard
`iris_execute_tests` returns (top-level zeros + an `error` naming the
class-level reason) — never a green `completed` with `total: 0`. If Atelier
reports the job finished but no run index could be captured at all (the
`/global` route unavailable), the rows that poll drained come back under
`partial` of an `isError: true` result — they may be missing rows an earlier
call drained, so they are never presented as a final count; pass `runIndex`
for the authoritative result.

**`runIndex` alone** reads `%UnitTest_Result` directly: `status: "completed"`
(SQL path, as above) once `TestInstance.DateTime` is set, or
`status: "unfinished"` when it is not — the result table alone CANNOT tell a
still-running job from a cancelled/crashed one (a cancelled run's row never
finishes), so an `unfinished` result carries interim rows only under
`partial` (each labelled `"in-progress"`, never counted as a pass) and
recommends polling by `jobId` for an authoritative answer:
```json
{ "status": "unfinished", "runIndex": 61, "runIndexSource": "result-table",
  "partial": { "total": 0, "passed": 0, "failed": 0, "skipped": 0,
    "details": [{ "class": "MyApp.Tests.SlowSuite", "method": "TestSlow", "status": "in-progress", "duration": 0, "message": "Row not final — this method has not finished executing yet." }] },
  "note": "The result table shows InstanceIndex 61 has not finished. ..." }
```

A `jobId` Atelier no longer recognizes (HTTP 404 — already consumed by an
earlier poll/cancel, or stale) falls back to `runIndex` when supplied, else
reports a clear not-found result naming that fallback. A `jobId` whose queue
node is gone AND whose `runIndex` shows unfinished is reported
`status: "abandoned"` — no live Atelier job references it any longer
(cancelled, crashed, or its worker died).

**`action: "cancel"` (write, DEFAULT-DISABLED — enable via `IRIS_GOVERNANCE`,
e.g. `{"global":{"iris_test_status:cancel":true}}`) — Input:**
```json
{ "jobId": "31797604" }
```
Stops a RUNNING job (`DELETE /work/{jobId}`) and reports the OBSERVED
outcome, never an assumed one — the queue entry is re-read after the
`DELETE`, and the result row is reported as found (`unfinished`, or `absent`
when the run never started):
```json
{ "status": "cancelled", "jobId": "31797604", "runIndex": 256,
  "observed": { "queueNode": "gone", "resultRow": "unfinished — TestInstance 256 has no finish time right after the DELETE; a run whose worker was stopped never finalizes (poll by runIndex 256 later to confirm it stays unfinished)" } }
```
A `DELETE` that itself fails (e.g. HTTP 423 while another caller holds the
job's lock) returns `isError: true` with the `jobId`/`runIndex` kept and a
note that whether it took effect is unknown — poll before retrying.
Cancelling a job that had ALREADY finished but was never drained discards
only the queue entry — the results are preserved and returned:
```json
{ "total": 1, "passed": 1, "failed": 0, "skipped": 0, "details": [ /* ... */ ],
  "status": "completed", "jobId": "31797604", "runIndex": 256, "runIndexSource": "result-table",
  "note": "The job had already finished; cancelling discarded only its queue entry. Results are preserved — poll by runIndex 256." }
```
`cancel` requires `jobId` — there is no way to cancel by `runIndex` alone (the
Atelier work-queue `DELETE` route operates on the job id).
</details>

---

## Namespace Scoping

Most tools accept an optional `namespace` parameter to target a specific IRIS namespace. If omitted, the configured default namespace (`IRIS_NAMESPACE` environment variable) is used.

**All 31 tools in this package accept the `namespace` parameter** except:
- `iris_server_info` -- Server-level info, no namespace needed

Tools that use the Atelier REST API (doc, compile, intelligence, server tools) resolve namespace via the Atelier URL path. Tools that use the custom REST endpoint (global, execute, SQL execute/query tools) pass namespace as a request parameter. `iris_env_diff`/`iris_env_promote` are the exception in spirit rather than mechanism: their `namespace` overrides BOTH the `source` and `target` profile's namespace identically (each side otherwise falls back to its own profile's configured default), rather than targeting one connection's namespace like every other tool here.

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
