# Tool Support — API Catalog

This document maps every tool in the IRIS MCP Server Suite to the backing IRIS API it calls. Use this as a reference when debugging tool behavior, planning deployment dependencies, or deciding which servers to install.

## Legend

| Marker | API |
|:---:|---|
| 🟦 | **Atelier REST** — standard IRIS API at `/api/atelier/v{N}/...`, shipped with IRIS |
| 🟥 | **ExecuteMCPv2** custom REST — handlers at `/api/executemcp/v2/...`, deployed automatically via bootstrap |
| 🟩 | **Other IRIS API** — DocDB (`/api/docdb/v1`), Management (`/api/mgmnt/v2`), etc. — standard IRIS endpoints that are neither Atelier nor custom |

> **Epic 29 — tool-call audit log (`IRIS_AUDIT_LOG`) is server CONFIG, not a tool.** Every tool below can optionally be recorded to a secrets-free JSONL audit file via `IRIS_AUDIT_LOG` (default unset = OFF, a mechanical no-op) — this is a single interception point in `@iris-mcp/shared`'s `McpServerBase.handleToolCall`, not an entry in any table below, and it carries **no `mutates` classification and no `IRIS_GOVERNANCE` key** (deliberately: it is server configuration set by whoever deploys the process, not a governed action an AI client could disable). **No tool count in this document moves** — see [Compliance & Auditability](README.md#compliance--auditability) in the suite README for the entry format and the disambiguation from the `iris_audit_manage` / `iris_audit_events` rows below (those manage/read IRIS's own `%SYS.Audit*` security-audit subsystem — a different, IRIS-native feature). Epic 31 added a `profileSource` field to each entry (attribution only, `"env"` or `"server-manager"`, present whenever the call resolved a real registry profile — omitted only when the `server` parameter named an unknown profile, so absence means "no profile resolved", never `"env"`) — same non-tool, non-governed nature.

> **Epic 30 — tool visibility presets (`IRIS_TOOLS_PRESET`/`IRIS_TOOLS_DISABLE`/`IRIS_TOOLS_ENABLE`) trim `tools/list`, not this catalog.** Every tool below can be advertise-time HIDDEN — absent from `tools/list`, uncallable (standard MCP unknown-tool error) — under `IRIS_TOOLS_PRESET=core`/`developer` or an explicit `IRIS_TOOLS_DISABLE`. This document remains the **package-level** catalog of every tool that EXISTS in the suite, independent of what any one running server's visibility config currently shows; a hidden tool still has a row here (it still exists, still calls the same API, still carries the same governance classification — visibility and this document's scope are orthogonal). Default `IRIS_TOOLS_PRESET` (unset) is `full` — today's behavior, every tool below visible, byte-for-byte. Per-server `core`/`developer` runtime counts and the full layering model are in the suite README's [Tool Visibility Presets](README.md#tool-visibility-presets) section; the authoritative per-tool disposition for each server lives in that package's `src/tools/presets.ts`. **No tool count in this document moves** — hiding a tool is a runtime advertise-time filter, not a change to what the suite ships.

> **Epic 32 — the governance FILE (`IRIS_GOVERNANCE_FILE`) is another config CHANNEL, not a tool.** Every governance key referenced below can now also be set in a JSON *file* of the same shape as `IRIS_GOVERNANCE`, referenced by path from any client's `env` block. It adds two cascade layers strictly *below* both `IRIS_GOVERNANCE` env layers (`env.profile ?? env.global ?? file.profile ?? file.global ?? presetSeed ?? defaultSeed`), is **inert when unset** (no file is ever read), and fails startup fast when set-but-unreadable/invalid. Enforcement does not move — the servers remain the sole authority at the `dispatchToolCall` gate. **No tool count, no new governance key, and the frozen Epic-14 baseline (`1e62c5ad5bf7`, 141 keys) is unchanged**; the only surface change is an additive per-key `configSource` (`env`|`file`|`preset`|`default`) in `iris_server_profiles` and the `iris-governance://{profile}` resource. Managed by the `iris-mcp-governance` CLI (a `bin` in `@iris-mcp/shared` — a CLI is not an MCP tool and has no row here). See [Governance file](README.md#governance-file-iris_governance_file).

> **Epic 33 — `@iris-mcp/client-config` is a configuration manager, not a sixth server.** The package (and its `iris-mcp-clients` CLI + the extension's "MCP Clients" view) wires the five servers below into any of 13 MCP clients by editing those clients' own config files. It registers **no MCP tool**, is not a dependency of any server runtime, and calls no IRIS API — nothing in this catalog changes. See [`packages/client-config/README.md`](packages/client-config/README.md).

> **Story 35.3 — `IRIS_ACCEPT_LANGUAGE` is server CONFIG, not a tool.** Every HTTP request every tool below makes now carries an explicit `Accept-Language` header (default `en-US,en;q=0.9`, operator-overridable), set once in `@iris-mcp/shared`'s `IrisHttpClient` — no tool row, no governance key, **no tool count moves**. It pins ONE of TWO independent IRIS localization mechanisms: request-locale negotiation. The other — IRIS selecting a `%Status` message table per WORKER PROCESS, independent of any header — is untouched, so both English (`ERROR #`) and localized (e.g. `خطأ #`) prefixes can still appear across calls; the existing `ExecuteMCPv2.Utils`/`ExecuteMCPv2.Diagram.Loader` prefix-stripping remains required and unmodified. Details: [suite README](README.md#2-set-environment-variables).

---

## `@iris-mcp/dev` — Development Tools (31)

| # | Tool | API | Endpoint |
|---|---|:---:|---|
| 1 | `iris_server_info` | 🟦 Atelier | `GET /api/atelier/` |
| 2 | `iris_server_namespace` | 🟦 Atelier | `GET /api/atelier/v{N}/{ns}` |
| 3 | `iris_doc_get` | 🟦 Atelier | `GET \| HEAD /doc/{name}`; optional `startLine`/`endLine` (Story 38.2) return a numbered line range of a UDL text document with `totalLines` and `ts`, and the **whole document when omitted** |
| 4 | `iris_doc_put` | 🟦 Atelier | `PUT /doc/{name}`; an existing document is saved with a **version-checked save** (a 409 on it is `DOCUMENT_CONFLICT`, never retried; `ignoreConflict` default **false**), and a put to an existing class that drops a Storage definition is refused with `STORAGE_DROPPED` unless `allowStorageRegeneration` is `true` (default **false**) (Story 38.3) |
| 5 | `iris_doc_delete` | 🟦 Atelier | `DELETE /doc/{name}` |
| 6 | `iris_doc_list` | 🟦 Atelier | `GET /docnames/{cat}/{type}`; a non-empty `modifiedSince` is **refused** before any request (IRIS cannot filter documents by modification time; Story 38.7) |
| 7 | `iris_doc_load` | 🟦 Atelier | `PUT /doc/{name}` (bulk) + `POST /action/compile`; with `ignoreConflict` **false** an existing document is saved with a version-checked save (a 409 on it is a per-file `DOCUMENT_CONFLICT`, never retried; Story 38.7) |
| 8 | `iris_doc_compile` | 🟦 Atelier | `POST /action/compile` |
| 9 | `iris_doc_index` | 🟦 Atelier | `POST /action/index` (class structure) |
| 10 | `iris_doc_search` | 🟦 Atelier | `GET /action/search` |
| 11 | `iris_doc_convert` | 🟦 Atelier | `GET /doc/{name}?format=...` (UDL ↔ XML) |
| 12 | `iris_doc_xml_export` | 🟦 Atelier | `POST /action/xml/{export\|load\|list}` (load takes `?flags=` when `compile: true`) |
| 13 | `iris_macro_info` | 🟦 Atelier | `POST /action/getmacrodefinition` + `POST /action/getmacrolocation` |
| 14 | `iris_sql_execute` | 🟥 ExecuteMCPv2 | `POST /dev/sql/execute` (Story 38.5: prepares once, classifies by statement type (by keyword only for a refuse-only `%NOJOURN` check under a rows-affected cap), and executes in the same request; optional `readOnly` (default **false**), `maxRowsAffected` (default **no cap**; `0` is a dry count), `countOnly` (default **false**); the Atelier `POST /action/query` route is no longer used) |
| 15 | `iris_execute_tests` | 🟦 Atelier | `POST /work` + `GET /work/{id}` (async unittest); a run outliving its wait budget returns a non-error "running" result (`jobId`/`runIndex` handles) instead of a timeout error (Story 36.1) — the run-index handle is captured via `GET /global` (🟥 ExecuteMCPv2, the pre-existing `iris_global_get` route), reading `IRIS.TempAtelierAsyncQueue(<jobId>,"unittest","id")` and, as a completed-runs-only fallback, `^UnitTest.Result`'s counter (read before queueing and after completion); no new governance key (bare `iris_execute_tests`, unchanged) |
| 16 | `iris_execute_command` | 🟥 ExecuteMCPv2 | `POST /command` |
| 17 | `iris_execute_classmethod` | 🟥 ExecuteMCPv2 | `POST /classmethod` |
| 18 | `iris_global_get` | 🟥 ExecuteMCPv2 | `GET /global` |
| 19 | `iris_global_set` | 🟥 ExecuteMCPv2 | `POST /global` |
| 20 | `iris_global_kill` | 🟥 ExecuteMCPv2 | `DELETE /global` |
| 21 | `iris_global_list` | 🟥 ExecuteMCPv2 | `GET /global/list` |
| 22 | `iris_package_list` | 🟦 Atelier | `GET /docnames/{cat}/{type}` (client-side rollup) |
| 23 | `iris_doc_export` | 🟦 Atelier | `GET /docnames/{cat}/{type}` + `GET /doc/{name}` (bulk) |
| 24 | `iris_routine_intermediate` | 🟦 Atelier | `GET /doc/{name}` (candidate fallback) |
| 25 | `iris_sql_analyze` | 🟦 Atelier | `POST /action/query` (`EXPLAIN` + `INFORMATION_SCHEMA` views); `advise`: `POST /dev/sql/advise-data` (🟥 ExecuteMCPv2) + `POST /action/query` for `workload` mode's statement enumeration |
| 26 | `iris_loc_count` | 🟥 ExecuteMCPv2 | `GET /dev/loc` (`ExecuteMCPv2.Loc.*` library) |
| 27 | `iris_env_diff` | 🟥 ExecuteMCPv2 | `POST /dev/doc/hashes` + `GET /config/mapping/{type}` + `GET /interop/defaultsettings` + `GET /security/webapp` + `POST /system/config` (per-domain; only requested domains are fetched) |
| 28 | `iris_env_promote` | 🟥 ExecuteMCPv2 | `plan`: pure transform, no IRIS connection; `execute`: the same per-domain endpoints as `iris_env_diff` (writes) — `POST /config/mapping/{type}` (create/delete), `PUT /doc/{name}` + `POST /action/compile` (🟦 Atelier), `POST /interop/defaultsettings`, `POST /security/webapp`, `POST /system/config` |
| 29 | `iris_test_status` | 🟦 Atelier | `poll`: `GET /work/{jobId}` (re-attach) + `POST /action/query` (SQL read of `%UnitTest_Result.*` by exact `InstanceIndex`); `cancel`: `DELETE /work/{jobId}`. Both actions also read the job's queue node (run index, request type) via `GET /global` (🟥 ExecuteMCPv2, the same route `iris_global_get`/`iris_execute_tests` use; best-effort) — companion to `iris_execute_tests` (Story 36.2); `poll` is `read` and **enabled by default**, `cancel` is `write` and **DEFAULT-DISABLED** by governance |
| 30 | `iris_doc_edit` | 🟦 Atelier | `GET /doc/{name}` (the one read, and the re-read the answer is built from) + `PUT /doc/{name}` (one save carrying `If-None-Match: <ts>`); never compiles — surgical line edits of an existing class, routine or include file (Story 38.4); `apply` is `write` and **enabled by default**, `regenerateStorage` (the Storage-guard override) is `write` and **DEFAULT-DISABLED**; both inherit a disable of `iris_doc_put` (parent key). Disable `apply` with `{"global":{"iris_doc_edit:apply":false}}`. A `STALE_CONTENT` refusal (an edit's `expected` text no longer matches) carries `mismatches[].current`, which can be passed back as `expected` unchanged; `DOCUMENT_CONFLICT` (the document changed after it was read) is never retried; both change nothing |
| 31 | `iris_sql_query` | 🟥 ExecuteMCPv2 | `POST /dev/sql/execute` (Story 38.5; the same route as `iris_sql_execute`, always read-only: only SELECT runs, inside a transaction that is always rolled back); `read` and **enabled by default**, including under the read-only preset; it inherits a disable of `iris_sql_execute` (parent key) |

**Mix:** 20 Atelier · 11 ExecuteMCPv2 · 0 other

> **Epic 17 (2026-06-16) — governance defaults:** added `iris_sql_analyze` (`explain`/`stats`/`indexUsage`/`running`). All four actions are governance-classified `read` and therefore **enabled by default** (a `read` classification is still required for every new key — `assertGovernanceClassification` throws on an unclassified non-baseline key — but reads resolve enabled). The tool is Atelier/SQL-only (no ObjectScript handler, no bootstrap contribution).

> **Epic 22 (2026-07-03) — governance defaults:** added `iris_loc_count` (namespace lines-of-code counter over CLS/MAC/INT/INC via `StudioOpenDialog` + `GetTextAsArray`). The tool is governance-classified `read` (scalar) and therefore **enabled by default** — reads resolve enabled under the default seed; the frozen governance baseline is untouched. `spec` is required (whole-namespace scans need an explicit `*`); compiler-generated documents are excluded unless `includeGenerated` is set; wildcard scans exclude `%`-prefixed system documents (name them explicitly to count them), and overlapping spec parts (an exact name before a wildcard that also matches it) can drop documents — an IRIS `StudioOpenDialog` spec quirk (CR 22.0-4). Backed by the `ExecuteMCPv2.Loc.{Classifier,Scanner,Generate}` library + `ExecuteMCPv2.REST.Loc` handler (bootstrap contribution — 4 new embedded classes).

> **Epic 27 (2026-07-10) — governance defaults:** added `iris_env_diff` (dev 26 → 27) and `iris_env_promote` (dev 27 → 28) — cross-profile environment drift detection and (gated) promotion across five domains (`documents`, `mappings`, `defaultSettings`, `webapps`, `config`; `documents` is opt-in only, needing an explicit `spec`). `iris_env_diff` and `iris_env_promote:plan` are governance-classified `read` and are **enabled by default**; `iris_env_promote:execute` is truthfully classified `write` and is **DEFAULT-DISABLED** — unlike `iris_production_control:clean`, it deliberately does NOT use the `defaultEnabled` mechanism (promotion is a real environment-mutating write, not a recovery-of-last-resort action). `execute` never deletes a target-only item (`onlyInTarget` diff entries are always warnings, never steps) and redacts credential-ish System Default Settings values in both diff and plan/error output; enabling it also requires the **target** profile's own governance to allow the underlying write families (a fourth, target-side gate on top of `iris_env_promote:execute` itself). Enable via `IRIS_GOVERNANCE`, e.g. `{"global":{"iris_env_promote:execute":true}}`. The frozen Epic-14 governance baseline (`1e62c5ad5bf7`, 141 keys) is **unchanged** — all three new keys (`iris_env_diff`, `iris_env_promote:plan`, `iris_env_promote:execute`) are non-baseline. Backed by the new ObjectScript endpoint `ExecuteMCPv2.REST.EnvSync:DocHashes` (`POST /dev/doc/hashes`, Story 27.0; `BOOTSTRAP_VERSION` `e5c18edd00c0` → `1e2008753853`) plus the pre-existing `Config`/`Interop`/`Security`/`SystemConfig` handlers for the other four domains.

> **Epic 28 (2026-07-11) — SQL Performance Advisor, governance defaults:** added the `advise` action to `iris_sql_analyze` — evidence-cited SQL performance findings (`full-scan`, `missing-index`, `stale-stats`, `unused-index`, `plan-anomaly`) for a `query` or the recent statement `workload`. **Strictly advisory**: recommends and cites a plan excerpt for every finding; never applies anything (no `applyIndex` write ships in v1). `advise` is governance-classified `read` and is **enabled by default** (a `read` classification is still required for every new key). **Tool count is UNCHANGED** — `advise` is a new action on the existing `iris_sql_analyze` tool, not a new tool (Rule #31); the suite governance-key count moves **200 live / 59 post-foundation → 201 live / 60 post-foundation**. The frozen Epic-14 governance baseline (`1e62c5ad5bf7`, 141 keys) is **unchanged**. `workload` mode's `topN` (default 5, max 20) caps real analysis work, not just output size — each statement analyzed is a full endpoint round-trip (Rule #38). Backed by the new ObjectScript endpoint `ExecuteMCPv2.REST.SqlAdvisor:AdviseData` (`POST /dev/sql/advise-data`, Story 28.1; `BOOTSTRAP_VERSION` `1e2008753853` → `6422caf6ec31`) plus a pure-TypeScript heuristic engine (Story 28.2, no bootstrap contribution).

> **Story 38.4 (2026-10-15) — governance defaults:** added `iris_doc_edit` (dev 29 → 30) with two post-foundation keys. `iris_doc_edit:apply` is truthfully classified `write` and ships **ENABLED** through the `defaultEnabled` marker (Project Lead decision S-3: every edit is guarded by the `expected` text of the lines it changes, the save is version-checked and never retried, and a class edit that would drop a Storage definition is refused); it is one of two holders of that marker (with `iris_production_control:clean`) and the list is closed. `iris_doc_edit:regenerateStorage` is the guard override as a separate action, `write` and **DEFAULT-DISABLED**. The tool declares the parent key `iris_doc_put`: when `iris_doc_put` is explicitly disabled both keys seed disabled, reported as `configSource: "parent"` and denied with `inheritedFrom` (an explicit setting on the child still wins). The frozen Epic-14 baseline (`1e62c5ad5bf7`, 141 keys) is **unchanged**; the suite governance-key counts move by the two new keys. No ObjectScript or bootstrap change (`BOOTSTRAP_VERSION` unchanged); the tool is Atelier-only.

> **Story 38.5 (2026-10-15) — governance defaults, SQL write safety:** added `iris_sql_query` (dev 30 → 31), one post-foundation key, truthfully classified `read` and therefore **ENABLED by default**, including under the read-only preset (which blocks the frozen-baseline write `iris_sql_execute`). It declares the parent key `iris_sql_execute`: when `iris_sql_execute` is explicitly disabled, `iris_sql_query` seeds disabled, reported as `configSource: "parent"` and denied with `inheritedFrom` (an explicit setting on `iris_sql_query` still wins). `iris_sql_execute` itself gains no `action` enum and no annotation change; it gains the optional parameters `readOnly` (default `false`), `maxRowsAffected` (default no cap; `0` is a dry count) and `countOnly` (default `false`), the operator variables `IRIS_SQL_READ_ONLY` (unset by default; `true` or `false`, case-insensitive) and `IRIS_SQL_MAX_ROWS_AFFECTED` (unset by default; a non-negative integer, `0` valid), both global (every profile inherits them, no per-profile key) and both failing startup on a malformed value, the additive result fields `rowsAffected` and `totalCount`, and the refusal codes `SQL_READ_ONLY` and `SQL_ROWS_AFFECTED_CAP`. Both tools now run through the new ExecuteMCPv2 route `POST /dev/sql/execute` (the `ExecuteMCPv2.REST.Sql` handler, a bootstrap contribution: `BOOTSTRAP_VERSION` moves), so `iris_sql_execute` depends on the bootstrapped service like `iris_execute_command` does. Read-only is **statement-level read-only, not side-effect-free**: the statement runs inside a transaction that is always rolled back, which does not undo `$INCREMENT`/`$SEQUENCE` counters (row ID counters included), process-private or IRISTEMP globals, changes made with `%NOJOURN` by a function, procedure or trigger, `%PARALLEL` worker-process work, `JOB` or device output, or a function, procedure or trigger that starts, commits or rolls back a transaction (some changes may be saved). The frozen Epic-14 baseline (`1e62c5ad5bf7`, 141 keys) is **unchanged**; the suite governance-key counts move by the one new key.

> **Epic 34 (2026-08-17) — `iris_execute_command` / `iris_execute_classmethod` response fidelity:** both tools keep their rows, their endpoints (`POST /command`, `POST /classmethod`), their existing `write` classification and their default state — **no new tool, action, or governance key** (Rule #31 not triggered; the frozen baseline `1e62c5ad5bf7` and the 201-live/60-post-foundation key counts are unchanged). What changed is the ObjectScript handler `ExecuteMCPv2.REST.Command` and the two tools' **response shape**, strictly additively (Rule #19 — existing plain-scalar calls return the same `returnValue`/`argCount`): `/classmethod` now captures device output the same way `/command` always has (returned in `output`, so narrating methods and stock `%UnitTest.Manager.RunTest` no longer need a `%SYS.Capture` wrapper), accepts `{byRef: true, value?}` marker args and returns their post-call values in `byRefValues`, and raises the positional-arg ceiling from 10 to 20. `returnValue`, `byRefValues` and `output` share **ONE 32768-raw-character response budget** (spent in that order) with a machine-detectable `[IRIS-MCP-TRUNCATED ceiling=<N>chars]` marker and three flags (`returnValueTruncated`/`byRefTruncated`/`truncated`); per Rule #38 that ceiling bounds the **response payload only** — the target has already executed — and it is not Web-Gateway-timeout protection. Story 34.8 additionally fixed request-body decoding across **all 14 `ExecuteMCPv2.REST.*` handler classes** (46 call sites, every server in this catalog): `ExecuteMCPv2.Utils.ReadRequestBody` now decodes raw UTF-8 explicitly, so non-ASCII input is no longer silently corrupted on the way in (see [Known Limitations](README.md#known-limitations)). `BOOTSTRAP_VERSION` moved several times across the epic and ships at `01dc15bb27df`; per-tool detail lives in [`packages/iris-dev-mcp/README.md`](packages/iris-dev-mcp/README.md).

> **Epic 35 (2026-08-18) — `iris_doc_load` glob-shape validation (Story 35.9):** the base for document-name mapping is the directory prefix before the first glob metacharacter, so the wildcard must come BEFORE the package directory — `.../src/ClineTest/*.cls` swallows `ClineTest` into the base and would map `ClineTest/Wumpus.cls` to unqualified `Wumpus.cls`. For `.cls`/`.mac`/`.int`/`.inc` files the tool now parses the file's own `Class <Pkg.Name>` / `ROUTINE <Name>` declaration and REFUSES the upload when it disagrees with the path-derived name (both names named, plus the corrected-glob and `baseDir` remedies); IRIS would otherwise store the doc under the content-declared name while the tool reported the wrong one — the PUT mismatch signal arrives as a string-typed `status` field the shared HTTP client never throws on. Headerless files (`.inc` fragments, CSP pages) keep pure path-derived naming; the comparison is exact (case-sensitive — IRIS preserves case). New additive optional `baseDir` parameter: when supplied it is used verbatim (separators normalized) instead of glob-shape inference, and the cross-check still applies (defense-in-depth). **No new tool or action key** (Rule #31 — additive parameter only; tool/action counts unmoved); `extractBaseDir` inference with `baseDir` omitted is byte-identical to before (Rule #19). Pure TypeScript change — no bootstrap contribution, `BOOTSTRAP_VERSION` unmoved.

---

## `@iris-mcp/admin` — Administration (26)

| # | Tool | API | Endpoint |
|---|---|:---:|---|
| 1 | `iris_namespace_manage` | 🟥 ExecuteMCPv2 | `/config/namespace` |
| 2 | `iris_namespace_list` | 🟥 ExecuteMCPv2 | `/config/namespace` |
| 3 | `iris_database_manage` | 🟥 ExecuteMCPv2 | `/config/database` |
| 4 | `iris_database_list` | 🟥 ExecuteMCPv2 | `/config/database` |
| 5 | `iris_mapping_manage` | 🟥 ExecuteMCPv2 | `/config/mapping/{type}` |
| 6 | `iris_mapping_list` | 🟥 ExecuteMCPv2 | `/config/mapping/{type}` |
| 7 | `iris_user_manage` | 🟥 ExecuteMCPv2 | `/security/user` |
| 8 | `iris_user_get` | 🟥 ExecuteMCPv2 | `/security/user` or `/security/user/{name}` |
| 9 | `iris_user_roles` | 🟥 ExecuteMCPv2 | `/security/user/roles` |
| 10 | `iris_user_password` | 🟥 ExecuteMCPv2 | `/security/user/password` |
| 11 | `iris_role_manage` | 🟥 ExecuteMCPv2 | `/security/role` |
| 12 | `iris_role_list` | 🟥 ExecuteMCPv2 | `/security/role` |
| 13 | `iris_resource_manage` | 🟥 ExecuteMCPv2 | `/security/resource` (create/modify/delete) + `/security/sqlprivilege` (grant/revoke/listPrivileges) |
| 14 | `iris_resource_list` | 🟥 ExecuteMCPv2 | `/security/resource` |
| 15 | `iris_permission_check` | 🟥 ExecuteMCPv2 | `/security/permission` |
| 16 | `iris_webapp_manage` | 🟥 ExecuteMCPv2 | `/security/webapp` |
| 17 | `iris_webapp_get` | 🟥 ExecuteMCPv2 | `POST /security/webapp/get` (path in body) |
| 18 | `iris_webapp_list` | 🟥 ExecuteMCPv2 | `/security/webapp` |
| 19 | `iris_ssl_manage` | 🟥 ExecuteMCPv2 | `/security/ssl` |
| 20 | `iris_ssl_list` | 🟥 ExecuteMCPv2 | `/security/ssl` |
| 21 | `iris_oauth_manage` | 🟥 ExecuteMCPv2 | `/security/oauth` |
| 22 | `iris_oauth_list` | 🟥 ExecuteMCPv2 | `/security/oauth` |
| 23 | `iris_service_manage` | 🟥 ExecuteMCPv2 | `/security/service` |
| 24 | `iris_ldap_manage` | 🟥 ExecuteMCPv2 | `/security/ldap` |
| 25 | `iris_x509_manage` | 🟥 ExecuteMCPv2 | `/security/x509` |
| 26 | `iris_audit_manage` | 🟥 ExecuteMCPv2 | `/security/audit` |

**Mix:** 0 Atelier · 26 ExecuteMCPv2 · 0 other — **fully custom**. Atelier has no security or namespace management endpoints, which is why every one of these needs ObjectScript handlers.

> **Epic 15 (2026-06-16):** added `iris_service_manage`, `iris_ldap_manage`, `iris_x509_manage`, `iris_audit_manage`, and extended `iris_resource_manage` with SQL object-privilege actions (`grant`/`revoke`/`listPrivileges`) backed by `/security/sqlprivilege`. The privilege extension adds governance keys but no new tool, so admin went 22 → 26 (4 new tools). Write actions (`grant`/`revoke` and the new service/ldap/x509/audit mutations) are governance-classified `write` (default-disabled under an `IRIS_GOVERNANCE` policy); reads (`list`/`get`/`status`/`test`/`listPrivileges`) are enabled by default.
>
> **Story 35.4 (2026-08-18):** `iris_resource_manage:listPrivileges` was unbounded — grantee `_SYSTEM` (holds `%All`) returned 15,341 rows / 2,900,478 characters, exceeding the client transport limit. Two additive parameters (no new tool, no new action key): `maxRows` (default 100, clamped at 1000 — an OUTPUT-only bound on the server-side fetch loop, not a scan bound, and therefore not timeout protection) and `cursor` (opt-in client-side pagination, 50 rows per page, within the `maxRows` ceiling, via `ctx.paginate`). Derived `GRANTED_VIA=SuperUser` rows — the cross-product a `%All` holder draws — are now omitted automatically (a `reason` string + `superUserPrivilegesOmitted` count explain why); real non-derived grants are still listed. The omission keys off each row's `GRANTED_VIA` value rather than resolving the grantee's roles, so it needs no `%SYS` access and holds however `%All` was acquired. A capped response carries `rowsCapped: true`; all three new fields (`rowsCapped`, `reason`, `superUserPrivilegesOmitted`) are present ONLY when actually triggered, and a caller who passes neither `maxRows` nor `cursor` is not paginated at all — so an under-cap, non-`%All` caller's response is byte-identical to the pre-35.4 shape.
>
> **Story 35.5 (2026-08-18) — `iris_oauth_manage` validates BEFORE delegating; `discover` accepts `sslConfiguration`.** Client create/delete and server create/discover pre-check preconditions (`OAuth2.Client.%ExistsId`, server-definition existence, `$ZNAME`-shape name) and fail with a clean, named reason instead of IRIS's raw `<PARAMETER>`/`<METHOD DOES NOT EXIST>` faults; client delete uses the real `OAuth2.Client.DeleteId` (the IdKey is the application name). `discover` takes an additive optional `sslConfiguration` (bound as `Discover(issuerEndpoint, sslConfiguration, *server)` — the 3-arg form; discovery of an HTTPS issuer without a matching SSL config previously returned an empty `configuration`). **Governance unchanged:** every `iris_oauth_manage` action is a pre-governance baseline key and stays **enabled by default** (verified mechanically against the default seed 2026-08-19).

### Fields returned — Security list/read tools

Added 2026-04-21 (Story 11.2) after a handler-completeness fix batch
corrected several list/get tools that used to advertise fields via
their Zod schemas but silently dropped them server-side.

- **`iris_role_list`** row: `name, description, resources, grantedRoles`.
  Handler uses `Security.Roles:ListAll` (wider ROWSPEC than `:List`).
  `resources` is a comma-separated list of `resource:permission` pairs,
  e.g. `%DB_USER:RW,%Ens_Code:R`. The `%All` super-role always returns
  `resources: ""` — IRIS special-cases it.
- **`iris_user_get`** row: `name, fullName, enabled, namespace, roles,
  comment, expirationDate, changePasswordOnNextLogin`. List mode
  backfills these via per-row `Security.Users.Get()` because
  `Security.Users:List` only ships `Name, Enabled, Roles, LastLoginTime,
  Flags`. Single-user mode echoes the `name` argument (IRIS uses it as
  a lookup key and does not return it as a property).
- **`iris_ssl_list`** row: `name, description, certFile, keyFile, caFile,
  caPath, cipherList, tlsMinVersion, tlsMaxVersion, verifyPeer,
  verifyDepth, type, enabled`. ⚠️ **Pre-release breaking change**: the
  former `protocols` bitmask was replaced with separate
  `tlsMinVersion` and `tlsMaxVersion` integer fields. See the
  `iris_ssl_manage` README section for the TLS version value mapping
  (`2=SSLv3, 4=TLS1.0, 8=TLS1.1, 16=TLS1.2, 32=TLS1.3`).
- **`iris_permission_check`** response: `target, targetType, resource,
  permission, granted, grantedPermission?`. A new `reason` field is
  emitted only on the `%All` short-circuit path (when the target IS
  the `%All` role or when a user's role list contains `%All`). Value
  is always `"target holds %All super-role"`. The `reason` field is
  omitted on the regular path.
- **`iris_database_list`** row: `name, directory, size, maxSize,
  expansionSize, globalJournalState, mountRequired, mountAtStartup,
  readOnly, resource`. Added 2026-04-21 (Story 11.3) — the three size
  fields (all MB) are now sourced from `SYS.Database` (runtime state)
  rather than `Config.Databases` (static configuration, which does not
  carry them). Unmounted databases fall back to `0` per field without
  erroring the whole list.

---

## `@iris-mcp/interop` — Interoperability (24)

| # | Tool | API | Endpoint |
|---|---|:---:|---|
| 1 | `iris_production_manage` | 🟥 ExecuteMCPv2 | `/interop/production` |
| 2 | `iris_production_control` | 🟥 ExecuteMCPv2 | `/interop/production/control` (start/stop/restart/update/recover/clean) |
| 3 | `iris_production_status` | 🟥 ExecuteMCPv2 | `/interop/production/status` |
| 4 | `iris_production_summary` | 🟥 ExecuteMCPv2 | `/interop/production/summary` |
| 5 | `iris_production_item` | 🟥 ExecuteMCPv2 | `/interop/production/item` (add/remove + arbitrary host/adapter settings) |
| 6 | `iris_production_autostart` | 🟥 ExecuteMCPv2 | `/interop/production/autostart` |
| 7 | `iris_production_logs` | 🟥 ExecuteMCPv2 | `/interop/production/logs` |
| 8 | `iris_production_queues` | 🟥 ExecuteMCPv2 | `/interop/production/queues` |
| 9 | `iris_production_messages` | 🟥 ExecuteMCPv2 | `/interop/production/messages` |
| 10 | `iris_production_adapters` | 🟥 ExecuteMCPv2 | `/interop/production/adapters` |
| 11 | `iris_credential_manage` | 🟥 ExecuteMCPv2 | `/interop/credential` |
| 12 | `iris_credential_list` | 🟥 ExecuteMCPv2 | `/interop/credential` |
| 13 | `iris_lookup_manage` | 🟥 ExecuteMCPv2 | `/interop/lookup` |
| 14 | `iris_lookup_transfer` | 🟥 ExecuteMCPv2 | `/interop/lookup/transfer` |
| 15 | `iris_rule_list` | 🟥 ExecuteMCPv2 | `/interop/rule` |
| 16 | `iris_rule_get` | 🟥 ExecuteMCPv2 | `/interop/rule/get` |
| 17 | `iris_transform_list` | 🟥 ExecuteMCPv2 | `/interop/transform` |
| 18 | `iris_transform_test` | 🟥 ExecuteMCPv2 | `/interop/transform/test` |
| 19 | `iris_interop_rest` | 🟥 ExecuteMCPv2 | `/interop/rest` |
| 20 | `iris_default_settings_manage` | 🟥 ExecuteMCPv2 | `/interop/defaultsettings` |
| 21 | `iris_message_diagram` | 🟥 ExecuteMCPv2 | `/interop/production/messages/diagram` |
| 22 | `iris_message_resend` | 🟥 ExecuteMCPv2 | `/interop/message/resend` + `/interop/message/resend/preview` |
| 23 | `iris_message_search` | 🟥 ExecuteMCPv2 | `/interop/message/search` |
| 24 | `iris_message_body` | 🟥 ExecuteMCPv2 | `/interop/message/body` |

**Mix:** 0 Atelier · 24 ExecuteMCPv2 · 0 other — **fully custom**. Ensemble/Interoperability isn't exposed by Atelier at all.

> **Epic 17 (2026-06-16) — governance defaults:** added `iris_default_settings_manage` (`list`/`get`/`set`/`delete`) and extended `iris_production_item` with `add`/`remove` actions plus arbitrary host/adapter settings (interop stays 19 → 20: one new tool; `iris_production_item` is enhanced in place). Write actions are governance-classified `write` and **default-disabled** under an `IRIS_GOVERNANCE` policy: `iris_default_settings_manage:set`/`:delete` and `iris_production_item:add`/`:remove`. Reads/pre-existing actions are **enabled by default**: `iris_default_settings_manage:list`/`:get` and the original `iris_production_item:enable`/`:disable`/`:get`/`:set` (the latter four are pre-governance baseline keys). *Epic 18 (2026-06-17) hardened the new add/arbitrary-settings surface — bad-className/duplicate-name/unknown-`@`-suffix inputs are now rejected before any write — without changing these governance defaults.*
>
> **Epic 20 (2026-06-30) — governance defaults:** added a `clean` action to `iris_production_control` (interop stays 20 — new action, not new tool) mapping to `Ens.Director.CleanProduction`, to unwedge a stopped production that `recover` cannot fix; its `killAppData` persistent-wipe is double-gated behind `confirm:true`. `clean` is classified `write` but is **enabled by default** — the new `defaultEnabled` governance mechanism (decision F2) ships a truthful write enabled-by-default without touching the frozen baseline — because it is a recovery operation an operator expects available; it can still be disabled with an explicit `IRIS_GOVERNANCE` `{"global":{"iris_production_control:clean":false}}` override. The same change fixes a latent bug where `recover` passed an argument to the no-arg `RecoverProduction()`.
>
> **Epic 21 (2026-07-02) — governance defaults:** added `iris_message_diagram` (interop 20 → 21) — a Mermaid sequence diagram from a message-trace session (Visual-Trace equivalent as renderable text: request/response pairing, sync `->>` vs async `-->>` arrows, two-tier `loop` compression of repeated pairs and multi-hop episodes, `[ERROR]` flags, session-metadata header, cross-session dedup via `dedupOf` with a `dedup:false` opt-out). The tool is a pure **read** (`mutates: "read"`) and is **enabled by default** under `IRIS_GOVERNANCE`; `iris_production_messages` remains the tool for raw message rows and is unchanged. Backed by the clean-room ObjectScript library `ExecuteMCPv2.Diagram.*` (reference tool consulted for functional spec only — no code or sample data embedded).
>
> **Epic 26 (2026-07-09) — governance defaults:** added `iris_message_resend` (interop 21 → 22) — resend/replay Interoperability messages via the pinned `Ens.MessageHeader:ResendDuplicatedMessage` API, by explicit header IDs (`resend`) or a bounded item+status+time-window filter with a dry-run-first double gate (`resendFiltered`; executing requires `dryRun:false` AND `confirm:true`, Epic-20 double-gate pattern). `preview` is a pure **read** and is **enabled by default**. `resend`/`resendFiltered` are truthfully classified `write` and are **DEFAULT-DISABLED** — unlike `iris_production_control:clean`, this tool deliberately does NOT use the `defaultEnabled` mechanism, because resend duplicates business/clinical data flow downstream rather than recovering a wedged production; enable via `IRIS_GOVERNANCE` (e.g. `{"global":{"iris_message_resend:resend":true,"iris_message_resend:resendFiltered":true}}`). Backed by the new ObjectScript handler `ExecuteMCPv2.REST.MessageResend.cls` (`BOOTSTRAP_VERSION` `13b4b5f003ab` → `1f3afba4ac52`).
>
> **Epic 35 (2026-08-19) — `iris_production_item` composite-key correctness (Story 35.1) + `iris_interop_rest` contract notes (Story 35.5/35.8).** `Ens.Config.Item` is keyed by the composite `(production, name)` pair, not `name` alone: `get` and `set` accept an optional `production` to disambiguate an item name that exists in more than one production (omitted ⇒ `get` resolves the first matching row and, since Story 38.0, reports its `production` in the response; `set` defaults to the namespace's active production), and `set`/`remove` remain reachable for items whose host class no longer resolves to a business type (a two-arg `NameExists` + item-list fallback keeps them repairable). `set` now persists durably (`%Save()` + `SaveToClass` dual-write — the production class XData is the source of truth; the SQL extent is a re-synced cache). `iris_interop_rest`'s `name` is an ObjectScript **package name** (e.g. `MyApi`, `MyCompany.MyApi`) — URL-path values like `/myapi` are rejected by IRIS `$ZNAME` validation; `delete` removes the application registration (spec + dispatch) but the generated `.impl` implementation class is **preserved by design** (IRIS `%REST.API.DeleteApplication` — the impl class carries user-written endpoint code; delete it separately if unwanted). **No tool or action key moved** (Rule #31); `iris_production_item:set` stays a pre-governance baseline key (**enabled by default**) and `:add`/`:remove` stay **default-disabled** writes, exactly as the Epic 17 note above states — verified mechanically against the default seed 2026-08-19.
>
> **Story 39.1 (2026-10-16) — governance defaults:** added `iris_message_search` (interop 22 → 23) — a read-only search of `Ens.MessageHeader` over the new route `POST /interop/message/search`. Its `action` enum is fixed: `headers` searches the headers of a required window (`from` required, `to` defaulting to now, at most 7 days; filters `item`, `source`, `target`, `status`, `sessionId`, `bodyClass`, `errorOnly`; keyset-paged, `limit` 100 by default and 500 at most) and returns header rows only, never body content, `ErrorStatus` or `Description`; `body` and `searchTable` answer with the `NOT_IMPLEMENTED` refusal until their stories land. All three keys are truthfully `read` and are **enabled by default** (and stay enabled under the `read-only` preset); an operator can restrict one with `IRIS_GOVERNANCE`, e.g. `{"global":{"iris_message_search:headers":false}}`. The tool is in the interop `core` and `developer` presets. The filters-to-WHERE translation moved out of `iris_message_resend`'s `resendFiltered` into one shared helper (`ExecuteMCPv2.REST.MessageSearch.HeaderWhere`); the `resendFiltered` dry-run and refusal wire is byte-identical to a capture taken before the move (the path that resends needs a running production and is covered by `MessageResendLiveTest` only). New class `ExecuteMCPv2.REST.MessageSearch.cls` (bootstrap 30 → 31 classes, `BOOTSTRAP_VERSION` `089f8f0a62b2` → `6dcdd238c792`).
>
> **Story 39.2 (2026-10-16) — PHI data policy:** the `iris_message_resend` preview's body summary is now under a per-profile `dataPolicy` (`block`, `redact` or `allow`; default `redact`; set with `IRIS_DATA_POLICY`, an `IRIS_PROFILES` entry's `dataPolicy` or the governance file's `dataPolicy` section; reported by `iris_server_profiles`). Under the default `redact`, an HL7 v2 body keeps today's class-name note and every other body (a stream included) is withheld with a reason; `allow` returns today's output exactly. **No tool, action or governance key is added, so no default state and no tool count moves** (`preview` stays an enabled-by-default read). The scope of the policy over every tool of the suite is the [PHI data policy scope](#phi-data-policy-scope-as-of-2026-10-16) table below. The preview route gained the optional request fields `bodyDetail` and `bodyTextMaxChars` (additive); `BOOTSTRAP_VERSION` `6dcdd238c792` → `d440a659ba1e` (still 31 classes).
>
> **Story 39.3 (2026-10-16) — message body content search:** the `body` action of `iris_message_search` is built. It takes a required `bodyClass` (the exact name of a persistent body class) and 1 to 10 structured `filters` (`{property, op, value}`, ANDed; operators `eq`, `ne`, `lt`, `le`, `gt`, `ge`, `contains`, `startsWith`, `isNull`, `notNull`), plus the scope options of `headers`, and returns the same header rows, never a body value. The IRIS handler resolves each property to its compiled `SqlFieldName` (a delimited identifier), maps each operator from a closed list, takes the table from the class dictionary and binds every value as a parameter; a refusal names the parameter, never the value. **No tool, action or governance key is added, so no default state and no tool count moves** (`body` stays an enabled-by-default read; it is refused with `DATA_POLICY_BLOCKED` under the `block` data policy, and `filters` is a declared PHI input, so the audit log redacts it under `redact` and `block`). `headers` refuses a `filters` key, and `searchTable` still answers `NOT_IMPLEMENTED`, now with `availableActions: ["headers","body"]`. `BOOTSTRAP_VERSION` `d440a659ba1e` → `f7b0868c95d0` (still 31 classes). The scope row of `iris_message_search` in the [PHI data policy scope](#phi-data-policy-scope-as-of-2026-10-16) table is now governed for `body`.

> **Story 39.4 (2026-10-17) — Search Table lookup:** the `searchTable` action of `iris_message_search` is built. It takes a required `searchTableClass` (the exact name of a compiled virtual-document Search Table class, such as `EnsLib.HL7.SearchTable`) and the same 1 to 10 structured `filters` as `body` (`{property, op, value}`, ANDed), plus the scope options of `headers`, and returns the same header rows, never a Search Table or body value. The IRIS handler resolves each property to the integer PropId of its `Ens.Config.SearchTableProp` row (through IRIS's own `getPropsList`) and binds it, maps each operator from a closed list, normalizes each value as the Search Table stores it, takes the table from the class dictionary and binds every value; a namespace with no Search Table property answers `notApplicable`. **No tool, action or governance key is added, so no default state and no tool count moves** (`searchTable` stays an enabled-by-default read; it is refused with `DATA_POLICY_BLOCKED` under the `block` data policy, and `filters`, already a declared PHI input, is redacted in the audit log under `redact` and `block`). No tool returns `NOT_IMPLEMENTED` any more; the code stays in the catalog. `BOOTSTRAP_VERSION` `f7b0868c95d0` → `b6ec56073e29` (still 31 classes). The scope row of `iris_message_search` in the [PHI data policy scope](#phi-data-policy-scope-as-of-2026-10-16) table is now governed for `body` and `searchTable`.

> **Story 39.5 (2026-10-17) — message body reader:** added `iris_message_body` (interop 23 → 24; the suite goes from 108 to 109 package tools, 113 to 114 advertised) — a read of the bodies of 1 to 20 message headers by ID, over the new route `POST /interop/message/body`, rendered by kind: an HL7 v2 body as ER7 text, an XML virtual document as XML, a persistent object as JSON (its `%JSON.Adaptor` export, otherwise a dump of its public properties), a stream or stream container as text, and a header with no body class as its literal value; any other body is shown as its class and ID with a reason. Each shown text is cut at `maxChars` (default 10000, at most 1048576), with `truncated`. The tool is a **read, enabled by default** (and still enabled under the `read-only` preset): one governance key, `iris_message_body`, which an operator restricts with `{"global":{"iris_message_body":false}}`. It is **governed by the PHI data policy** and is the first consumer of body text: the route is told which bodies it may read, so under `redact` IRIS returns the text of HL7 v2 bodies only and no other body's content leaves IRIS, and the HL7 v2 text goes complete through the redaction engine before it is sanitized and cut; `block` reads no body; `allow` shows bodies as stored; a call's `dataPolicy` can only tighten the profile's policy. The tool is the second member of a pair with `iris_message_search` in `TOOL_PAIRS` and is in the `core` and `developer` presets (`core` is 12 runtime tools). `Hl7Text` now refuses a body over the cap from the stored segment sizes (`MessageSearch.Hl7Size`, batch children included) before it serializes anything (DW-577), and `ValidateHeaderIds` takes a maximum (20 for this route, 100 elsewhere). New class `ExecuteMCPv2.REST.MessageBody.cls` (bootstrap 31 → 32 classes, `BOOTSTRAP_VERSION` `b6ec56073e29` → `2fd17b50a024`). The scope row of `iris_message_body` in the [PHI data policy scope](#phi-data-policy-scope-as-of-2026-10-16) table is governed, dated 2026-10-17; the table's own date stays 2026-10-16.
>
> **Story 39.6 (2026-10-17) — message forensics docs, prompt and capstone:** no tool, action or governance key is added, so no default state and no tool count moves (109 package tools, 114 advertised; the Interoperability server stays at 24 package tools and its `core` roster at 12 runtime tools; the frozen baseline stays `1e62c5ad5bf7`, 141 keys; `BOOTSTRAP_VERSION` stays `2fd17b50a024`). The message forensics tools keep their default states: the `headers`, `body` and `searchTable` actions of `iris_message_search` and the tool `iris_message_body` are **reads, enabled by default** (and still enabled under the `read-only` preset), and the `preview` action of `iris_message_resend` is a read, enabled by default, while `resend` and `resendFiltered` stay writes, disabled by default. The pack of MCP prompts goes from 12 to 13 (see [MCP prompts](#mcp-prompts-not-tools)): the new `find-patient-messages` prompt finds a patient's messages by a Search Table value (`PatientID`) in a window of at most 7 days and reads bodies only when the user wants content, and `trace-message-flow` now searches the headers of a session, reads the bodies that matter, draws the diagram and reads the logs of erroring items, with its name, title and arguments unchanged. A prompt carries no `mutates` classification and no governance key; both prompts keep their main path in the Interoperability `core` preset, call reads only, and neither loosens the PHI data policy or reads a withheld body another way. A committed `tools/list` snapshot pins the title, description, input schema and annotations of every listed tool on the five servers (`pnpm gen:tools-list-snapshot:check` compares and writes nothing; a sanctioned change to a listed entry is regenerated with `pnpm gen:tools-list-snapshot --force`). A capstone live gate, `epic39-capstone-gate.test.ts`, drives the built dev, admin and interop servers over the SDK client on a disposable namespace and checks, on synthetic messages, that under `redact` no body PHI value and no search filter value leaves through a Search Table lookup, a body read, the audit file or stderr; it shows least exposure and is not a compliance claim. The live gates' duplicated test helpers moved into one shared module.

---

## `@iris-mcp/ops` — Operations & Monitoring (21)

| # | Tool | API | Endpoint |
|---|---|:---:|---|
| 1 | `iris_metrics_system` | 🟥 ExecuteMCPv2 | `/monitor/system` |
| 2 | `iris_metrics_alerts` | 🟥 ExecuteMCPv2 | `/monitor/alerts` |
| 3 | `iris_metrics_interop` | 🟥 ExecuteMCPv2 | `/monitor/interop` |
| 4 | `iris_alerts_manage` | 🟥 ExecuteMCPv2 | `/monitor/alerts/manage` |
| 5 | `iris_jobs_list` | 🟥 ExecuteMCPv2 | `/monitor/jobs` |
| 6 | `iris_locks_list` | 🟥 ExecuteMCPv2 | `/monitor/locks` |
| 7 | `iris_journal_info` | 🟥 ExecuteMCPv2 | `/monitor/journal` |
| 8 | `iris_mirror_status` | 🟥 ExecuteMCPv2 | `/monitor/mirror` |
| 9 | `iris_audit_events` | 🟥 ExecuteMCPv2 | `/monitor/audit` |
| 10 | `iris_database_check` | 🟥 ExecuteMCPv2 | `/monitor/database` |
| 11 | `iris_license_info` | 🟥 ExecuteMCPv2 | `/monitor/license` |
| 12 | `iris_ecp_status` | 🟥 ExecuteMCPv2 | `/monitor/ecp` |
| 13 | `iris_task_manage` | 🟥 ExecuteMCPv2 | `/task/manage` |
| 14 | `iris_task_list` | 🟥 ExecuteMCPv2 | `/task/list` |
| 15 | `iris_task_run` | 🟥 ExecuteMCPv2 | `/task/run` |
| 16 | `iris_task_history` | 🟥 ExecuteMCPv2 | `/task/history` |
| 17 | `iris_config_manage` | 🟥 ExecuteMCPv2 | `/system/config` |
| 18 | `iris_process_manage` | 🟥 ExecuteMCPv2 | `/monitor/process` + `/monitor/process/manage` |
| 19 | `iris_database_action` | 🟥 ExecuteMCPv2 | `/monitor/database/action` |
| 20 | `iris_backup_manage` | 🟥 ExecuteMCPv2 | `/monitor/backup/manage` |
| 21 | `iris_health_check` | 🟥 ExecuteMCPv2 | `/monitor/health` |

**Mix:** 0 Atelier · 21 ExecuteMCPv2 · 0 other — **fully custom**.

> **Epic 23 (2026-07-07) — composite health check, governance defaults:** added `iris_health_check` (ops 20 → 21) — one round-trip across up to 9 instance areas (`system`, `databases`, `journal`, `mirror`, `locks`, `license`, `ecp`, `alerts`, `interop`) returning a structured verdict (`healthy`/`warning`/`critical`) with a per-area finding. The `memory` area from earlier drafts was DROPPED (Story 23.0 finding — no reliable instance-wide memory-health signal exists in IRIS; it is not folded into `system` or any other area). The ObjectScript endpoint (`ExecuteMCPv2.REST.Health:HealthCheck`, Story 23.1) returns RAW per-area values only; every threshold, per-area level rule, and the overall verdict are computed in TypeScript (architecture.md ADR H5), so threshold tuning is free of a bootstrap bump. The tool is a pure **read** (`mutates: "read"`) and is **enabled by default** under `IRIS_GOVERNANCE`; an `error` finding (a failed probe) counts as `warning` severity for the verdict and never fakes a `critical` result, and a `notApplicable` finding (e.g. no mirror membership, no Interoperability classes in the namespace) never affects the verdict.
>
> **Epic 16 (2026-06-16) — governance defaults:** added `iris_process_manage`, `iris_database_action`, and `iris_backup_manage` (ops 17 → 20). Write actions are governance-classified `write` and **default-disabled** under an `IRIS_GOVERNANCE` policy: `iris_process_manage:terminate`/`:suspend`/`:resume`; **all six** `iris_database_action` actions (`mount`/`dismount`/`compact`/`defragment`/`truncate`/`expandVolume`); and `iris_backup_manage:run`/`:freeze`/`:thaw`. Reads are **enabled by default**: `iris_process_manage:get` and `iris_backup_manage:listHistory`. (`iris_backup_manage` has no `restore` action — IRIS restore is interactive with no scriptable classmethod; see the `iris-ops` README.)

> Atelier v8 does expose `GET /%SYS/jobs` and `GET /%SYS/cspapps`, but those return limited data and don't cover locks, metrics, tasks, journals, mirrors, audit, or database integrity. The custom REST handler gets all of them uniformly.

### Fields returned — Monitoring + config tools

Added 2026-04-21 (Story 11.3) after accuracy fixes to three tools that
were silently returning stale or per-process data.

- **`iris_metrics_system`** metrics: the two counters
  `iris_global_references_total` and `iris_routine_commands_total`
  are **instance-wide** values sampled from `SYS.Stats.Global`
  (sum of `RefLocal + RefPrivate + RefRemote`) and
  `SYS.Stats.Routine.RtnCommands` respectively — NOT per-process
  `$ZU(190,N)` snapshots. Values are monotonically increasing and
  match the Management Portal System Dashboard.
- **`iris_config_manage`** `get` `locale` response `properties`:
  `current, availableLocales, localeCount`. The `current` field
  (new in Story 11.3) reports the IRIS instance locale code
  (e.g. `"enuw"`) via `%SYS.NLS.Locale.%New().Name`, with a
  direct-global fallback to `^%SYS("LOCALE","CURRENT")`.
- **`iris_health_check`** (Epic 23) `structuredContent`:
  `{verdict, checkedAt, findings, raw}`. `findings[]` is one entry
  per CHECKED area — `{area, level, metric, value, threshold,
  explanation}`, `level` one of `ok`/`warning`/`critical`/
  `notApplicable`/`error`. `raw` mirrors the endpoint's per-area raw
  values for every checked area (an errored area has no `raw` entry).
  Optional `areas` (array, default all 9; an empty array is treated
  as "all", matching the endpoint's own default) restricts which
  areas are checked; optional `thresholds` overrides any subset of
  the defaults (`journalPctWarn=80/Crit=92`, `dbFreePctWarn=10/Crit=3`,
  `licensePctWarn=80/Crit=95`, `lockTablePctWarn=50/Crit=85`) and is
  never sent to the endpoint — it is applied purely client-side.
  `journal`/`license`/`lockTable` thresholds are ASCENDING (% full or
  % used — high is bad); only `dbFreePct` is DESCENDING (% free — low
  is bad). `system`/`mirror`/`ecp`/`interop` carry no ok/warning
  threshold in v1 (informational — always `ok`, or `notApplicable`
  when not configured).

---

## `@iris-mcp/data` — Data & Analytics (7)

| # | Tool | API | Endpoint |
|---|---|:---:|---|
| 1 | `iris_docdb_manage` | 🟩 **DocDB** | `/api/docdb/v1/{ns}` + `/db/{db}` |
| 2 | `iris_docdb_document` | 🟩 **DocDB** | `/api/docdb/v1/{ns}/doc/{db}` |
| 3 | `iris_docdb_find` | 🟩 **DocDB** | `/api/docdb/v1/{ns}/find/{db}` |
| 4 | `iris_docdb_property` | 🟩 **DocDB** | `/api/docdb/v1/{ns}/prop/{db}/{prop}` |
| 5 | `iris_analytics_mdx` | 🟥 ExecuteMCPv2 | `/analytics/mdx` |
| 6 | `iris_analytics_cubes` | 🟥 ExecuteMCPv2 | `/analytics/cubes` |
| 7 | `iris_rest_manage` | 🟩 **Management API** + 🟥 ExecuteMCPv2 | `/api/mgmnt/v2/{ns}` (spec-first) · `/security/webapp` (legacy/all) |

> The four DocDB tools require the `%Service_DocDB` service, which is **disabled by default** on IRIS — see the multi-API note below.

**Mix:** 0 Atelier · 2 ExecuteMCPv2 · 5 other — **the only server that uses all three API tiers.** DocDB and the Management API are standard IRIS APIs (not Atelier, not custom), and analytics/DeepSee is custom because IRIS has no standard REST facade for MDX or cube operations.

### Fields returned — Data & Analytics tools

- **`iris_analytics_cubes` list** row: `name, sourceClass, factCount,
  lastBuildTime, lastBuildTimeRaw`. The analytics endpoint emits the build
  timestamp as raw `$HOROLOG` (`days,seconds.frac`). Added 2026-04-21
  (Story 11.4): the TypeScript layer converts the value to ISO 8601 UTC in
  `lastBuildTime` and preserves the original string in `lastBuildTimeRaw`
  for cross-checking via `$ZDATETIME` or debugging. Malformed or missing
  horolog values yield `lastBuildTime: ""` without throwing.
- **`iris_analytics_cubes` build/sync** (Story 35.2): the response body is
  guaranteed to be the JSON envelope alone — the `build` branch
  (`%DeepSee.Utils:%BuildCube` with `pAsync=0`) now runs under a null-device
  redirect, so its device output can no longer be prepended to the wire body
  (a contamination that made the response unparseable JSON). The `sync`
  branch was probed and verified clean of the defect (it binds `pVerbose=0`),
  and was left untouched. No tool/action key moved; `build` and `sync` are
  pre-governance baseline keys, **enabled by default**.
- **`iris_rest_manage` list** row: `name, dispatchClass, namespace,
  swaggerSpec`. Added 2026-04-21 (Story 11.4): a `scope` parameter
  controls the backend. `scope: "spec-first"` (default) routes to the
  Management API and matches the SMP REST listing — returns only
  OpenAPI-spec-first dispatch classes (those with a `.spec` companion).
  Updated 2026-04-22 (Story 12.5, FEAT-2 **BREAKING pre-release**):
  `scope: "legacy"` (renamed from the old `scope: "all"`) routes to
  the ExecuteMCPv2 webapp endpoint and includes hand-written `%CSP.REST`
  subclasses (e.g., `ExecuteMCPv2.REST.Dispatch`) with `swaggerSpec: null`.
  New `scope: "all"` returns the deduplicated union of spec-first + legacy.
- **`iris_rest_manage` get** — `fullSpec` parameter (Story 12.5, FEAT-6):
  by default (`fullSpec: false`) the tool returns a compact swagger summary
  `{title, version, description, basePath, pathCount, definitionCount}`
  instead of the full OpenAPI spec object (which can be 50 KB+). Pass
  `fullSpec: true` to receive the complete spec.
- **`iris_rest_manage` get/delete** — legacy routing (Story 35.6): on a
  Management API 404, `get` falls back to the legacy webapp list and returns
  `{name, dispatchClass, namespace, swaggerSpec: null, explanation}` for a
  legacy `%CSP.REST` name (`fullSpec` has no effect — no spec exists), or an
  accurate not-found naming BOTH scopes when the name is in neither (if the
  legacy list itself cannot be queried, the error says that scope could not be
  checked, with the reason — it never reports an unchecked scope as absent).
  The gateway's misleading "Check the IRIS web server configuration" 404 text is
  never surfaced. `delete` stays spec-first-only: a legacy name fails with an
  explanation pointing at `iris_webapp_manage:delete`.
- **`iris_doc_xml_export` import** — compile parity (Story 35.6): additive
  `compile` (default false) and `flags` parameters mirror `iris_doc_load`.
  `compile: true` sends the native Atelier `flags` query param with the `c`
  compile qualifier folded in when absent or explicitly negated (IRIS
  qualifiers are case-insensitive; `-c` negates, last `c` wins — so `-c`
  becomes `-cc`), and loaded documents are compiled in the same call. When `compile` is omitted/false, NO `flags` param is sent
  (byte-identical pre-35.6 request) and the response adds a note stating the
  imported documents are NOT compiled, naming the remedy (`compile: true` or
  `iris_doc_compile`). Non-empty per-file `status` text (e.g. a compile
  error — IRIS reports it there, not in `status.errors`) is surfaced in the
  response text.
- **`iris_rule_list` / `iris_transform_list`** — filter/pagination (Story
  12.5, FEAT-3): both tools now accept `prefix` (startsWith), `filter`
  (case-insensitive substring), `cursor`, and `pageSize`. Filtering and
  pagination are applied client-side; the server still returns the full list.
- **`iris_global_list` filter** (Story 12.5, FEAT-8): the `filter`
  parameter is now case-insensitive by default (matches `iris_doc_list`
  semantics). Pass `caseSensitive: true` to restore the legacy behavior.
- **`iris_doc_search` wire request**: the documented default `files`
  pattern (`*.cls,*.mac,*.int,*.inc`) is now reliably sent on every call.
  Before Story 11.4, the param was silently dropped when the caller
  omitted `files`, which let the Atelier server's narrower default kick
  in and returned empty results for matches that lived in `.cls` files.

> **Placeholder note:** `iris_debug_session` (FR106) and `iris_debug_terminal` (FR107) are documented in the PRD but deferred post-MVP. The `debug.ts` file is a 14-line placeholder with no exports, and they do not count against the 109-tool total.

---

## Framework tools (all servers)

These tools are provided by the shared framework (`@iris-mcp/shared` `server-base.ts`) and registered automatically on **every** server — they are NOT in any package's `tools/index.ts`. Each adds +1 to that server's advertised tool count.

| Tool | API | Purpose | Governance |
|---|:---:|---|---|
| `iris_server_profiles` | — (in-memory) | **Call this FIRST.** Reports the configured server-profile roster (non-secret connection metadata — `password` is NEVER included) and the effective governance policy (which actions are enabled/disabled) for a selected profile (optional `profile` arg; default `default`) or all profiles (`allProfiles: true`). Lets a client pick the right `server` profile and avoid disabled actions without reading client config. Does not connect to IRIS. | **read → enabled by default** (Epic 19, decision E1) |

> **Epic 19 (2026-06-18) — governance defaults:** added the framework tool `iris_server_profiles`. It is governance-classified `read` and therefore **enabled by default** (a `read` classification is still required for every new key — `assertGovernanceClassification` throws on an unclassified non-baseline key — but reads resolve enabled; an operator may still disable it explicitly via `IRIS_GOVERNANCE`). It is a new non-baseline key, so the frozen governance baseline (`1e62c5ad5bf7`) is unchanged.
>
> **Epic 31 (2026-07-25) — Server Manager connections:** `iris_server_profiles`' roster entries gained two optional FIELDS (not a new action, no tool-count change, Rule #31) — `source` (`"env"` or `"server-manager"`, where a profile's connection fields came from) and `sourceFile` (the settings file, for a `"server-manager"`-sourced profile only). Both are attribution-only and never included when unset. No new governance key; the frozen baseline (`1e62c5ad5bf7`, 141 keys) is unchanged. See [Server Manager connections](README.md#server-manager-connections-optional).

---

## PHI data policy scope (as of 2026-10-16)

The PHI data policy (`dataPolicy`: `block`, `redact` or `allow`, default `redact`; see [PHI data policy](README.md#phi-data-policy) in the suite README) governs the output of a tool that returns message-body or body-derived data. This table classifies every tool of the suite, exhaustive as of 2026-10-16, as **governed** (the tool declares `dataPolicy`, so the policy applies), **residual** (the tool can return body or body-derived text but is not under the policy; an operator restricts it through its governance key or tool visibility) or **not applicable**. The data policy reduces exposure of message-body data; it is not a compliance certification.

| Tool | Scope | Why |
|---|---|---|
| `iris_message_body` | governed | Returns message bodies (a read, enabled by default; added 2026-10-17). `block` withholds every body; `redact` shows an HL7 v2 body redacted by the reviewed keep-list, complete or not at all, and withholds every other body, whose text IRIS never returns; `allow` shows bodies as stored. A call's `dataPolicy` only tightens. |
| `iris_message_resend` | governed | The `preview` action's body summary is the one body-derived output. Under `redact` an HL7 v2 body shows only its class name and every other body is withheld with a reason; `block` withholds every body; `allow` is unchanged. `resend` and `resendFiltered` return status texts only. |
| `iris_message_search` | governed | The `body` and `searchTable` actions are under the policy: refused with `DATA_POLICY_BLOCKED` under `block`; under `redact` and `allow` they return header rows only (default state of each: a read, enabled by default). The `headers` action is not: for a header with no body class the body ID is the literal body value, so restrict `iris_message_search:headers` with its governance key. |
| `iris_sql_execute` | residual | Runs caller-supplied SQL, which can select message-body columns. Restrict it with its governance key or `IRIS_SQL_READ_ONLY`. |
| `iris_sql_query` | residual | Runs caller-supplied SELECTs, which can select message-body columns. |
| `iris_sql_analyze` | residual | Returns plans and statistics for caller-supplied SQL, which can echo literals. |
| `iris_global_get` | residual | Reads any global node, message bodies included. |
| `iris_execute_command` | residual | Runs caller code whose output is unrestricted. |
| `iris_execute_classmethod` | residual | Calls any class method, whose result and output are unrestricted. |
| `iris_execute_tests` | residual | Returns the text of unit-test results, which can quote data. |
| `iris_test_status` | residual | Returns the text of unit-test results, which can quote data. |
| `iris_doc_get` | residual | Returns the source of a document, which can hold message text. |
| `iris_doc_search` | residual | Returns matching lines of document source, which can hold message text. |
| `iris_doc_convert` | residual | Returns document source, which can hold message text. |
| `iris_doc_xml_export` | residual | Returns document source as XML, which can hold message text. |
| `iris_doc_export` | residual | Writes document source to local files, which can hold message text. |
| `iris_doc_edit` | residual | Returns a unified diff and numbered excerpts of the edited document, which can hold message text. |
| `iris_routine_intermediate` | residual | Returns the compiled intermediate code of a routine, which can hold message text. |
| `iris_macro_info` | residual | Returns a macro's definition and expanded value, which are source text and can hold message text. |
| `iris_rule_get` | residual | Returns the source of a rule class (UDL with its rule XML), which can hold message text. |
| `iris_task_list` | residual | Returns each task's last status text, which a task's own code writes and which can quote data. |
| `iris_task_history` | residual | Returns the status and result text of task runs, which a task's own code writes and which can quote data. |
| `iris_lookup_manage` | residual | Returns and sets lookup table values, which can hold identifying data. |
| `iris_lookup_transfer` | residual | Exports whole lookup tables, values included. |
| `iris_production_messages` | residual | Returns header columns; for a header with no body class the body ID is the literal body value. |
| `iris_env_diff` | residual | Compares configuration values across profiles, lookup values included. |
| `iris_env_promote` | residual | Copies configuration values across profiles, lookup values included. |
| `iris_production_logs` | residual | The Event Log text of an adapter or a parser can carry segment text. |
| `iris_message_diagram` | residual | A header's sanitized `ErrorStatus`, which parser errors fill with segment text, appears in the diagram. |
| `iris_transform_test` | residual | Returns the output of a transformation run on a caller-supplied message. |
| `iris_docdb_document` | residual | Returns the content of DocDB documents. |
| `iris_docdb_find` | residual | Returns the content of DocDB documents that match. |
| `iris_analytics_mdx` | residual | Returns the result data of an MDX query. |
| `iris_audit_manage` | residual | Returns audit configuration and event data, whose descriptions can carry request text. |
| `iris_audit_events` | residual | Returns audit events, whose descriptions can carry request text. |

Every other tool is not applicable: it returns no body or body-derived text. That includes the `resend` and `resendFiltered` actions of `iris_message_resend` (status texts). A header's `ErrorStatus` and `Description` are reachable only through the residual tools above; the governed forensics tools keep excluding both. A header with no body class is the one header column that holds a body value: its body ID is the literal body, which is why the `headers` action of `iris_message_search` and `iris_production_messages` are restricted through their governance keys rather than the policy.

A restriction on a residual tool is the tool's own governance key (`IRIS_GOVERNANCE`, `IRIS_GOVERNANCE_FILE`) or the tool-visibility presets, not the data policy. The data policy changes the default output of the resend preview (the one sanctioned change of Story 39.2), under `block` refuses the `body` and `searchTable` actions of `iris_message_search`, and governs every body `iris_message_body` returns (the tool Story 39.5 adds); the policy itself adds no action and no governance key.

---

## MCP prompts (not tools)

Starting with Epic 25, the suite also ships a pack of 13 **MCP prompts** (`ops` 2, `dev` 5, `interop` 4, `admin` 2; `data` none in v1) — a separate MCP protocol capability (`prompts/list` / `prompts/get`), not tools. Prompts carry no `mutates` classification, no governance key, and are **not counted** in any per-server tool table or the suite-wide rollup below. `interop` gained `resend-failed-messages` in Epic 26, once `iris_message_resend` shipped; `dev` gained `promote-environment-change` in Epic 27, once `iris_env_diff`/`iris_env_promote` shipped — no gated prompt remains. `dev` gained `edit-and-test-class` in Story 38.6 (ranged read, guarded `iris_doc_edit`, compile, tests); it names only dev `core` tools on its main path and adds no tool, key or default. `interop` gained `find-patient-messages` in Story 39.6 (a Search Table lookup of a patient's messages, then a body read under the PHI data policy only when the user wants content); it names only interop `core` tools on its main path, calls reads only, and adds no tool, key or default. `trace-message-flow` was extended in the same story to search headers, read bodies, draw the diagram and read the logs, with its name, title and arguments unchanged. See the root README's [Workflow Prompts & Agent Skills](README.md#workflow-prompts--agent-skills) section for the full list and the generated [`skills/`](skills/README.md) install pack.

---

## Suite-wide rollup

Per-server totals below count each server's PACKAGE tools (its `tools/index.ts` array). Every server ALSO advertises the one framework tool `iris_server_profiles` (see "Framework tools" above), so each server's advertised surface is one greater than the package total shown here.

| Server | Atelier | ExecuteMCPv2 | Other | Package total | Advertised (+1 framework) |
|---|:---:|:---:|:---:|:---:|:---:|
| `@iris-mcp/dev` | 20 | 11 | 0 | **31** | **32** |
| `@iris-mcp/admin` | 0 | 26 | 0 | **26** | **27** |
| `@iris-mcp/interop` | 0 | 24 | 0 | **24** | **25** |
| `@iris-mcp/ops` | 0 | 21 | 0 | **21** | **22** |
| `@iris-mcp/data` | 0 | 2 | 5 | **7** | **8** |
| **Total** | **20** | **84** | **5** | **109** | **114** |

---

## Dependency implications

### Only `@iris-mcp/dev` is partially portable without the custom REST

20 of the 31 dev tools hit Atelier directly. Even if the `ExecuteMCPv2.*` handler classes were missing or not compiled, a developer could still use doc CRUD, line edits, compile, search, macros, SQL analysis, unit tests, server info, package browsing, bulk export, and macro-expanded routine lookup — and `iris_test_status:poll`/`:cancel` (re-attach by `jobId`, or a fallback to `runIndex` alone, both via pure Atelier/SQL calls; only its BEST-EFFORT queue-node reads — run index, request type — depend on `/global`, so without it pass `runIndex` for an authoritative `poll` result). The 11 ExecuteMCPv2-backed tools (`iris_execute_*`, `iris_global_*`, `iris_sql_execute`, `iris_sql_query`, `iris_loc_count`, `iris_env_diff`, `iris_env_promote`) would fail but the rest would work.

### Four servers are fully dependent on the custom REST handlers

`@iris-mcp/admin`, `@iris-mcp/interop`, `@iris-mcp/ops` — and effectively `@iris-mcp/dev` for any command/global/LOC/environment-diff work — depend entirely on the ExecuteMCPv2 handlers. **If the bootstrap fails on an install, 84 of the 109 tools (77% of the suite) stop working.** This is why the auto-upgrading bootstrap mechanism (version-stamped probe introduced in commit `6538b20`, HTTP 409 fix in `66a4cbd`) is load-bearing infrastructure — it guarantees that every server restart reconciles the IRIS-side handlers with the embedded classes.

### `@iris-mcp/data` is the outlier — multi-API

It's the only server that integrates with pre-existing IRIS APIs other than Atelier:

- **DocDB** (`/api/docdb/v1`) — 4 tools for document database operations
- **Management API** (`/api/mgmnt/v2`) — 1 tool for REST application management
- **ExecuteMCPv2** — 2 tools for DeepSee analytics (MDX queries, cube operations)

If DocDB or the Management API aren't enabled on the IRIS instance, 5 of the 7 data tools would error — **independently of your custom REST deployment**. Note the asymmetry: the Management API is typically enabled by default, but `%Service_DocDB` is **disabled by default on IRIS**. Until it is enabled (Management Portal > *System Administration > Security > Services > %Service_DocDB*, or `iris_service_manage` `action="enable"` — itself governance-default-disabled, needing an `IRIS_GOVERNANCE` override), the four DocDB tools fail with `ERROR #822: Access Denied`, which they translate into an actionable error naming both remedy routes.

### Pre-publish implication: bootstrap is critical infrastructure

Because 84 of 109 tools depend on the ExecuteMCPv2 custom REST classes being deployed and current, the version-stamped auto-upgrade mechanism is not optional nice-to-have — it's a requirement for any change to any handler class to actually reach beta users without manual intervention. That's why Epic 9's bootstrap hardening (commits `6538b20`, `66a4cbd`, and the drift-check regression test) landed before first npm publish.

---

## Maintenance

When adding a new tool, update this file as part of the same commit. The drift-check unit test in `packages/shared/src/__tests__/bootstrap.test.ts` will catch bootstrap regressions mechanically, but this API catalog is human-maintained.

To regenerate the API mix manually, grep for the markers in each tool file:

```bash
# Atelier tools
grep -rn 'atelierPath(' packages/*/src/tools/ | grep -v __tests__

# Custom REST tools
grep -rn 'BASE_URL = "/api/executemcp/v2"' packages/*/src/tools/

# Other IRIS APIs
grep -rn 'BASE_DOCDB_URL\|BASE_MGMNT_URL\|/api/docdb\|/api/mgmnt' packages/*/src/tools/
```
