# Tool Support — API Catalog

This document maps every tool in the IRIS MCP Server Suite to the backing IRIS API it calls. Use this as a reference when debugging tool behavior, planning deployment dependencies, or deciding which servers to install.

## Legend

| Marker | API |
|:---:|---|
| 🟦 | **Atelier REST** — standard IRIS API at `/api/atelier/v{N}/...`, shipped with IRIS |
| 🟥 | **ExecuteMCPv2** custom REST — handlers at `/api/executemcp/v2/...`, deployed automatically via bootstrap |
| 🟩 | **Other IRIS API** — DocDB (`/api/docdb/v1`), Management (`/api/mgmnt/v2`), etc. — standard IRIS endpoints that are neither Atelier nor custom |

---

## `@iris-mcp/dev` — Development Tools (26)

| # | Tool | API | Endpoint |
|---|---|:---:|---|
| 1 | `iris_server_info` | 🟦 Atelier | `GET /api/atelier/` |
| 2 | `iris_server_namespace` | 🟦 Atelier | `GET /api/atelier/v{N}/{ns}` |
| 3 | `iris_doc_get` | 🟦 Atelier | `GET \| HEAD /doc/{name}` |
| 4 | `iris_doc_put` | 🟦 Atelier | `PUT /doc/{name}` |
| 5 | `iris_doc_delete` | 🟦 Atelier | `DELETE /doc/{name}` |
| 6 | `iris_doc_list` | 🟦 Atelier | `GET /docnames/{cat}/{type}` + `GET /modified/{ts}` |
| 7 | `iris_doc_load` | 🟦 Atelier | `PUT /doc/{name}` (bulk) + `POST /action/compile` |
| 8 | `iris_doc_compile` | 🟦 Atelier | `POST /action/compile` |
| 9 | `iris_doc_index` | 🟦 Atelier | `POST /action/index` (class structure) |
| 10 | `iris_doc_search` | 🟦 Atelier | `GET /action/search` |
| 11 | `iris_doc_convert` | 🟦 Atelier | `GET /doc/{name}?format=...` (UDL ↔ XML) |
| 12 | `iris_doc_xml_export` | 🟦 Atelier | `POST /action/xml/{export\|load\|list}` |
| 13 | `iris_macro_info` | 🟦 Atelier | `POST /action/getmacrodefinition` + `POST /action/getmacrolocation` |
| 14 | `iris_sql_execute` | 🟦 Atelier | `POST /action/query` |
| 15 | `iris_execute_tests` | 🟦 Atelier | `POST /work` + `GET /work/{id}` (async unittest) |
| 16 | `iris_execute_command` | 🟥 ExecuteMCPv2 | `POST /command` |
| 17 | `iris_execute_classmethod` | 🟥 ExecuteMCPv2 | `POST /classmethod` |
| 18 | `iris_global_get` | 🟥 ExecuteMCPv2 | `GET /global` |
| 19 | `iris_global_set` | 🟥 ExecuteMCPv2 | `POST /global` |
| 20 | `iris_global_kill` | 🟥 ExecuteMCPv2 | `DELETE /global` |
| 21 | `iris_global_list` | 🟥 ExecuteMCPv2 | `GET /global/list` |
| 22 | `iris_package_list` | 🟦 Atelier | `GET /docnames/{cat}/{type}` (client-side rollup) |
| 23 | `iris_doc_export` | 🟦 Atelier | `GET /docnames/{cat}/{type}` + `GET /doc/{name}` (bulk) |
| 24 | `iris_routine_intermediate` | 🟦 Atelier | `GET /doc/{name}` (candidate fallback) |
| 25 | `iris_sql_analyze` | 🟦 Atelier | `POST /action/query` (`EXPLAIN` + `INFORMATION_SCHEMA` views) |
| 26 | `iris_loc_count` | 🟥 ExecuteMCPv2 | `GET /dev/loc` (`ExecuteMCPv2.Loc.*` library) |

**Mix:** 19 Atelier · 7 ExecuteMCPv2 · 0 other

> **Epic 17 (2026-06-16) — governance defaults:** added `iris_sql_analyze` (`explain`/`stats`/`indexUsage`/`running`). All four actions are governance-classified `read` and therefore **enabled by default** (a `read` classification is still required for every new key — `assertGovernanceClassification` throws on an unclassified non-baseline key — but reads resolve enabled). The tool is Atelier/SQL-only (no ObjectScript handler, no bootstrap contribution).

> **Epic 22 (2026-07-03) — governance defaults:** added `iris_loc_count` (namespace lines-of-code counter over CLS/MAC/INT/INC via `StudioOpenDialog` + `GetTextAsArray`). The tool is governance-classified `read` (scalar) and therefore **enabled by default** — reads resolve enabled under the default seed; the frozen governance baseline is untouched. `spec` is required (whole-namespace scans need an explicit `*`); compiler-generated documents are excluded unless `includeGenerated` is set; wildcard scans exclude `%`-prefixed system documents (name them explicitly to count them), and overlapping spec parts (an exact name before a wildcard that also matches it) can drop documents — an IRIS `StudioOpenDialog` spec quirk (CR 22.0-4). Backed by the `ExecuteMCPv2.Loc.{Classifier,Scanner,Generate}` library + `ExecuteMCPv2.REST.Loc` handler (bootstrap contribution — 4 new embedded classes).

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

## `@iris-mcp/interop` — Interoperability (21)

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

**Mix:** 0 Atelier · 21 ExecuteMCPv2 · 0 other — **fully custom**. Ensemble/Interoperability isn't exposed by Atelier at all.

> **Epic 17 (2026-06-16) — governance defaults:** added `iris_default_settings_manage` (`list`/`get`/`set`/`delete`) and extended `iris_production_item` with `add`/`remove` actions plus arbitrary host/adapter settings (interop stays 19 → 20: one new tool; `iris_production_item` is enhanced in place). Write actions are governance-classified `write` and **default-disabled** under an `IRIS_GOVERNANCE` policy: `iris_default_settings_manage:set`/`:delete` and `iris_production_item:add`/`:remove`. Reads/pre-existing actions are **enabled by default**: `iris_default_settings_manage:list`/`:get` and the original `iris_production_item:enable`/`:disable`/`:get`/`:set` (the latter four are pre-governance baseline keys). *Epic 18 (2026-06-17) hardened the new add/arbitrary-settings surface — bad-className/duplicate-name/unknown-`@`-suffix inputs are now rejected before any write — without changing these governance defaults.*
>
> **Epic 20 (2026-06-30) — governance defaults:** added a `clean` action to `iris_production_control` (interop stays 20 — new action, not new tool) mapping to `Ens.Director.CleanProduction`, to unwedge a stopped production that `recover` cannot fix; its `killAppData` persistent-wipe is double-gated behind `confirm:true`. `clean` is classified `write` but is **enabled by default** — the new `defaultEnabled` governance mechanism (decision F2) ships a truthful write enabled-by-default without touching the frozen baseline — because it is a recovery operation an operator expects available; it can still be disabled with an explicit `IRIS_GOVERNANCE` `{"global":{"iris_production_control:clean":false}}` override. The same change fixes a latent bug where `recover` passed an argument to the no-arg `RecoverProduction()`.
>
> **Epic 21 (2026-07-02) — governance defaults:** added `iris_message_diagram` (interop 20 → 21) — a Mermaid sequence diagram from a message-trace session (Visual-Trace equivalent as renderable text: request/response pairing, sync `->>` vs async `-->>` arrows, two-tier `loop` compression of repeated pairs and multi-hop episodes, `[ERROR]` flags, session-metadata header, cross-session dedup via `dedupOf` with a `dedup:false` opt-out). The tool is a pure **read** (`mutates: "read"`) and is **enabled by default** under `IRIS_GOVERNANCE`; `iris_production_messages` remains the tool for raw message rows and is unchanged. Backed by the clean-room ObjectScript library `ExecuteMCPv2.Diagram.*` (reference tool consulted for functional spec only — no code or sample data embedded).

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

**Mix:** 0 Atelier · 2 ExecuteMCPv2 · 5 other — **the only server that uses all three API tiers.** DocDB and the Management API are standard IRIS APIs (not Atelier, not custom), and analytics/DeepSee is custom because IRIS has no standard REST facade for MDX or cube operations.

### Fields returned — Data & Analytics tools

- **`iris_analytics_cubes` list** row: `name, sourceClass, factCount,
  lastBuildTime, lastBuildTimeRaw`. The analytics endpoint emits the build
  timestamp as raw `$HOROLOG` (`days,seconds.frac`). Added 2026-04-21
  (Story 11.4): the TypeScript layer converts the value to ISO 8601 UTC in
  `lastBuildTime` and preserves the original string in `lastBuildTimeRaw`
  for cross-checking via `$ZDATETIME` or debugging. Malformed or missing
  horolog values yield `lastBuildTime: ""` without throwing.
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

> **Placeholder note:** `iris_debug_session` (FR106) and `iris_debug_terminal` (FR107) are documented in the PRD but deferred post-MVP. The `debug.ts` file is a 14-line placeholder with no exports, and they do not count against the 101-tool total.

---

## Framework tools (all servers)

These tools are provided by the shared framework (`@iris-mcp/shared` `server-base.ts`) and registered automatically on **every** server — they are NOT in any package's `tools/index.ts`. Each adds +1 to that server's advertised tool count.

| Tool | API | Purpose | Governance |
|---|:---:|---|---|
| `iris_server_profiles` | — (in-memory) | **Call this FIRST.** Reports the configured server-profile roster (non-secret connection metadata — `password` is NEVER included) and the effective governance policy (which actions are enabled/disabled) for a selected profile (optional `profile` arg; default `default`) or all profiles (`allProfiles: true`). Lets a client pick the right `server` profile and avoid disabled actions without reading client config. Does not connect to IRIS. | **read → enabled by default** (Epic 19, decision E1) |

> **Epic 19 (2026-06-18) — governance defaults:** added the framework tool `iris_server_profiles`. It is governance-classified `read` and therefore **enabled by default** (a `read` classification is still required for every new key — `assertGovernanceClassification` throws on an unclassified non-baseline key — but reads resolve enabled; an operator may still disable it explicitly via `IRIS_GOVERNANCE`). It is a new non-baseline key, so the frozen governance baseline (`1e62c5ad5bf7`) is unchanged.

---

## MCP prompts (not tools)

Starting with Epic 25, the suite also ships a pack of 9 **MCP prompts** (`ops` 2, `dev` 3, `interop` 2, `admin` 2; `data` none in v1) — a separate MCP protocol capability (`prompts/list` / `prompts/get`), not tools. Prompts carry no `mutates` classification, no governance key, and are **not counted** in any per-server tool table or the suite-wide rollup below. See the root README's [Workflow Prompts & Agent Skills](README.md#workflow-prompts--agent-skills) section for the full list and the generated [`skills/`](skills/README.md) install pack.

---

## Suite-wide rollup

Per-server totals below count each server's PACKAGE tools (its `tools/index.ts` array). Every server ALSO advertises the one framework tool `iris_server_profiles` (see "Framework tools" above), so each server's advertised surface is one greater than the package total shown here.

| Server | Atelier | ExecuteMCPv2 | Other | Package total | Advertised (+1 framework) |
|---|:---:|:---:|:---:|:---:|:---:|
| `@iris-mcp/dev` | 19 | 7 | 0 | **26** | **27** |
| `@iris-mcp/admin` | 0 | 26 | 0 | **26** | **27** |
| `@iris-mcp/interop` | 0 | 21 | 0 | **21** | **22** |
| `@iris-mcp/ops` | 0 | 21 | 0 | **21** | **22** |
| `@iris-mcp/data` | 0 | 2 | 5 | **7** | **8** |
| **Total** | **19** | **77** | **5** | **101** | **106** |

---

## Dependency implications

### Only `@iris-mcp/dev` is partially portable without the custom REST

19 of the 26 dev tools hit Atelier directly. Even if the `ExecuteMCPv2.*` handler classes were missing or not compiled, a developer could still use doc CRUD, compile, search, macros, SQL, SQL analysis, unit tests, server info, package browsing, bulk export, and macro-expanded routine lookup. The 7 ExecuteMCPv2-backed tools (`iris_execute_*`, `iris_global_*`, `iris_loc_count`) would fail but the rest would work.

### Four servers are fully dependent on the custom REST handlers

`@iris-mcp/admin`, `@iris-mcp/interop`, `@iris-mcp/ops` — and effectively `@iris-mcp/dev` for any command/global/LOC work — depend entirely on the ExecuteMCPv2 handlers. **If the bootstrap fails on an install, 77 of the 101 tools (76% of the suite) stop working.** This is why the auto-upgrading bootstrap mechanism (version-stamped probe introduced in commit `6538b20`, HTTP 409 fix in `66a4cbd`) is load-bearing infrastructure — it guarantees that every server restart reconciles the IRIS-side handlers with the embedded classes.

### `@iris-mcp/data` is the outlier — multi-API

It's the only server that integrates with pre-existing IRIS APIs other than Atelier:

- **DocDB** (`/api/docdb/v1`) — 4 tools for document database operations
- **Management API** (`/api/mgmnt/v2`) — 1 tool for REST application management
- **ExecuteMCPv2** — 2 tools for DeepSee analytics (MDX queries, cube operations)

If DocDB or the Management API aren't enabled on the IRIS instance (they typically are by default, but can be disabled), 5 of the 7 data tools would error — **independently of your custom REST deployment**.

### Pre-publish implication: bootstrap is critical infrastructure

Because 77 of 101 tools depend on the ExecuteMCPv2 custom REST classes being deployed and current, the version-stamped auto-upgrade mechanism is not optional nice-to-have — it's a requirement for any change to any handler class to actually reach beta users without manual intervention. That's why Epic 9's bootstrap hardening (commits `6538b20`, `66a4cbd`, and the drift-check regression test) landed before first npm publish.

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
