# IRIS MCP Suite — Management Portal Tool Gap Analysis & Expansion Scope

**Date:** 2026-06-15
**Author:** Mary (Business Analyst)
**Purpose:** Inventory the management capability exposed by the IRIS Management Portal (`EnsPortal.*` for Interoperability, `%CSP.UI.Portal.*` for System Administration) and identify tools the MCP server suite does not yet ship. Captures both (a) the full gap analysis and (b) the user-defined scope for the upcoming course correction so the change proposal has its source context.
**Status:** Research complete. Course correction **pending — not yet started** (user will initiate).

---

## 1. Executive Summary

- Two portal families were reviewed: **`EnsPortal.*`** (225 classes — Interoperability) and **`%CSP.Portal.*` / `%CSP.UI.Portal.*`** (System Management).
- **`%CSP.Portal.*` is pure UI framework** (home page, menus, page templates) with **no management capability** — the real system-admin surface lives in **`%CSP.UI.Portal.*`** (~294 classes).
- After pruning UI chrome (`Component.*`, `Dialog.*`, `Template.*`, `SVG.*`) and de-duplicating against the existing suite, the meaningful gaps cluster into ~20 candidate tools plus a few enhancements to existing tools.
- The richest untapped veins are **Interoperability rules + Pub/Sub + Workflow** (three whole subsystems), the most security-glaring is **`iris_service_manage`** (no way to toggle IRIS services today), and the most surprising omission is **`iris_backup_manage`**.
- The user has selected a **9-tool + 3-enhancement** subset for the first course correction, plus **two cross-cutting platform features**: subfunction-level enable/disable governance, and multi-server configuration support. See §5.

---

## 2. Methodology & Scope

**Enumeration:** `iris_doc_list` over `EnsPortal.`, `%CSP.Portal.`, and `%CSP.UI.Portal.` (namespace HSCUSTOM, paged to exhaustion). Functional pages were peeked with `iris_doc_get` to identify the underlying IRIS API each page drives — that API is what an MCP tool would wrap, and is the most valuable output for implementers.

**Cross-reference baseline (existing suite, confirmed by tool-name manifest):**

| Server | Existing tools (relevant) |
|---|---|
| iris-interop-mcp | credential_list/manage, interop_rest, lookup_manage/transfer, production_adapters, production_autostart, production_control, production_item, production_logs, production_manage, production_messages, production_queues, production_status, production_summary, rule_get, rule_list, transform_list, transform_test |
| iris-admin-mcp | database_list/manage, mapping_list/manage, namespace_list/manage, oauth_list/manage, permission_check, resource_list/manage, role_list/manage, ssl_list/manage, user_get/manage/password/roles, webapp_get/list/manage |
| iris-ops-mcp | alerts_manage, audit_events, config_manage, database_check, ecp_status, jobs_list, journal_info, license_info, locks_list, metrics_alerts/interop/system, mirror_status, task_history/list/manage/run |
| iris-dev-mcp | doc_* , execute_* , global_* , macro_info, package_list, routine_intermediate, server_info, server_namespace, sql_execute |
| iris-data-mcp | analytics_cubes/mdx, docdb_*, rest_manage |

**Scope-verification probes (read tool descriptions to avoid false gaps):** `iris_production_logs`, `iris_production_item`, `iris_rule_get`, `iris_config_manage`.

---

## 3. Corrections — false positives discarded

The scout agents over-produced (appropriate for discovery). Three claimed gaps were discarded after verification:

| Claimed gap | Verdict | Evidence |
|---|---|---|
| `EnsPortal.AutoStartProduction` | **NOT a gap** | Already covered by `iris_production_autostart` (get/set, empty string disables). Confirmed this session. |
| `EnsPortal.EventLog` ("covered by audit_events") | **Already covered, wrong attribution** | `iris_production_logs` reads `Ens_Util.Log` directly (Info/Warning/Error/Trace/Assert/Alert). It is *not* the system audit log; the scout conflated the two subsystems. Read-only; no event-log purge. |
| "Advanced config" (memory/IO/startup/etc.) | **Mostly covered** | `iris_config_manage` handles config/startup/locale sections. Real residual gap narrowed to **services/authentication** (`Security.Services`), which is not a CPF section. |

> Lesson reinforced (project Rule #16): verify "X exists / X is covered" claims via live probe before trusting. One scout asserted `AutoStartProduction` was distinct from `production_autostart` — it is not.

---

## 4. Full Gap Inventory

### 4.1 Tier 1 — high value, confirmed gaps

| Proposed tool | Server | Capability | Underlying IRIS API |
|---|---|---|---|
| `iris_rule_manage` | iris-interop-mcp | Create / update / delete / validate business rules (today `rule_get`/`rule_list` are read-only) | `Ens.Rule.Definition`, `Ens.Rule.Model.*` |
| `iris_rule_test` | iris-interop-mcp | Fire a rule against a sample context; return matched actions + rule log (mirrors `transform_test`) | `Ens.Rule.*`, `Ens.Rule.RuleLog` |
| `iris_default_settings_manage` | iris-interop-mcp | get/set/list/delete System Default Settings — production-portable settings override layer | `Ens.Config.DefaultSettings` |
| `iris_service_manage` | iris-admin-mcp | list/enable/disable IRIS services + auth settings (toggle `%Service_Telnet`, ECP, CallIn, Bindings) | `Security.Services` (%SYS) |
| `iris_backup_manage` | iris-ops-mcp | run / list / restore backups + external freeze/thaw | `Backup.General` (%SYS) |
| `iris_process_manage` | iris-ops-mcp | process detail (stack/vars) + terminate/suspend/resume (extends read-only `jobs_list`) | `%SYS.ProcessQuery`, `SYS.Process` |

### 4.2 Tier 2 — coherent subsystems / control-plane completions

| Proposed tool | Server | Capability | Underlying IRIS API |
|---|---|---|---|
| `iris_pubsub_manage` | iris-interop-mcp | CRUD domains / subscribers / subscriptions — whole Pub/Sub subsystem uncovered | `EnsLib.PubSub.*` |
| `iris_workflow_manage` | iris-interop-mcp | CRUD workflow roles/users + task/worklist actions — whole Workflow subsystem uncovered | `EnsLib.Workflow.*` |
| `iris_business_partner_manage` | iris-interop-mcp | CRUD trading-partner profiles | `Ens.Config.BusinessPartner` |
| `iris_deployment` ⚠️ | iris-interop-mcp | export / import / deploy production deployment packages (CI/CD value) | `Ens.Deployment.*` |
| `iris_archive_manage` ⚠️ | iris-interop-mcp | message-archive config + run/status | `Ens.Archive.Manager` |
| `iris_ldap_manage` | iris-admin-mcp | CRUD + test LDAP configs | `Security.LDAPConfigs` (%SYS) |
| `iris_x509_manage` | iris-admin-mcp | CRUD X.509 certificate credentials | `%SYS.X509Credentials` |
| `iris_audit_manage` | iris-admin-mcp | enable/disable audit, configure events, view/purge/export log (complements read-only ops `audit_events`) | `Security.Events`, `%SYS.Audit` (%SYS) |
| `iris_journal_manage` | iris-ops-mcp | switch / purge / export / import journals (extends read-only `journal_info`) | `%SYS.Journal.System` |
| `iris_mirror_manage` ⚠️ | iris-ops-mcp | failover control: promote/demote/set-failover (extends read-only `mirror_status`) — destructive, design carefully | `SYS.Mirror` |
| `iris_database_action` | iris-ops-mcp | mount/unmount/compact/defragment/truncate/expand-volume (extends admin create/delete) | `SYS.Database`, `%SYS.DatabaseCompact`, `%SYS.DatabaseDefragment` |
| `iris_sql_analyze` | iris-dev-mcp | show-plan / runtime stats / index analysis / running statements | `$SYSTEM.SQL.Explain`, `%SYS.PTools.*`, `%SQL.Statement` |
| `iris_external_language_server` ⚠️ | iris-dev-mcp | list/manage Python/Java/.NET language servers (relevant to embedded-Python work) | `Config.Gateways`, `%External.*` |

⚠️ = underlying class/method should be live-probed before committing (project Rule #16).

### 4.3 Tier 3 — long tail (build on demand)

- **interop:** `iris_recordmap_manage`/`_test` (`EnsLib.RecordMap`), `iris_schedule_manage` (Ens schedule specs), `iris_managed_alerts` (`Ens.Alerting.ManagedAlert`), `iris_bp_instances` (BPL instance purge), `iris_testing_service` (send test request to a business host).
- **admin:** `iris_encryption_manage` (key files + DB encryption — security-sensitive), `iris_sql_privilege` (column/schema grants — see §5.2), `iris_phone_provider_manage` (2FA).
- **ops:** `iris_csp_session` (list/kill web sessions), `iris_transactions_list`, `iris_ecp_manage` (ECP config, extends `ecp_status`).
- **dev:** `iris_routine_compare`.
- **Likely out of scope unless asked:** sharding, ML/`%SYS.ML`, MFT, NLS, report servers, `Provider.*` provisioning, cluster, work-queue manager.

### 4.4 Enhancements to existing tools (rather than new tools)

| Tool | Current limit | Enhancement |
|---|---|---|
| `iris_production_item` | Only `get/set/enable/disable`; settings limited to 6 keys (poolSize, enabled, comment, category, className, adapterClassName) | Add **add/remove** config items; allow **arbitrary host/adapter setting names** |
| `iris_resource_manage` | Resource CRUD only | **Column/schema-level SQL privileges** (GRANT/REVOKE) |

### 4.5 Where the new tools land (Tier 1 + 2 tally)

| Server | Tier 1 | Tier 2 | New tools |
|---|---|---|---|
| iris-interop-mcp | 3 | 5 | 8 |
| iris-admin-mcp | 1 | 3 | 4 |
| iris-ops-mcp | 2 | 3 | 5 |
| iris-dev-mcp | 0 | 2 | 2 |

---

## 5. Course Correction Scope (user-defined, 2026-06-15)

> The user explicitly scoped the **first** course correction to the items below. Everything else in §4 is deferred (see §5.5).

### 5.1 In-scope new tools (9)

| # | Tool | Server | Underlying IRIS API (starting point) |
|---|---|---|---|
| 1 | `iris_default_settings_manage` | iris-interop-mcp | `Ens.Config.DefaultSettings` (list/get/set/delete) |
| 2 | `iris_service_manage` | iris-admin-mcp | `Security.Services` (%SYS — list/get/enable/disable/set auth) |
| 3 | `iris_backup_manage` | iris-ops-mcp | `Backup.General` (%SYS — run/list/freeze/thaw; restore is partial/`^DBREST`-bound — verify) |
| 4 | `iris_process_manage` | iris-ops-mcp | `%SYS.ProcessQuery` (detail), `SYS.Process` (terminate/suspend/resume) |
| 5 | `iris_ldap_manage` | iris-admin-mcp | `Security.LDAPConfigs` (%SYS — CRUD + test) |
| 6 | `iris_x509_manage` | iris-admin-mcp | `%SYS.X509Credentials` (list/get/import/delete) |
| 7 | `iris_audit_manage` | iris-admin-mcp | `Security.Events` + `%SYS.Audit` (%SYS — enable/disable/configure/view/purge/export) |
| 8 | `iris_database_action` | iris-ops-mcp | `SYS.Database`, `%SYS.DatabaseCompact`, `%SYS.DatabaseDefragment` (mount/dismount/compact/defragment/truncate/expand) |
| 9 | `iris_sql_analyze` | iris-dev-mcp | `$SYSTEM.SQL.Explain`, `%SYS.PTools.*`, `%SQL.Statement` (show-plan/stats/index/running) |

Per-server impact: **admin +4, ops +3, interop +1, dev +1.**

### 5.2 In-scope enhancements to existing tools (3)

1. **Add / remove production config items** — extend `iris_production_item` (or `iris_production_manage`). API: `Ens.Config.Production` item insert/remove + `Ens.Config.Item`; production must be updated/recompiled after edit.
2. **Set arbitrary host/adapter settings** — generalize `iris_production_item`'s `settings` object beyond the 6 fixed keys to any host or adapter setting name. API: `Ens.Config.Item.Settings` / `Ens.Config.Setting`.
3. **Edit column/schema-level SQL privileges** — extend `iris_resource_manage` (or new `iris_sql_privilege`). API: SQL `GRANT`/`REVOKE`, `$SYSTEM.SQL.Security`, the priv tables behind `%CSP.UI.Portal.Dialog.ColumnPriv` / `SchemaPriv`.

### 5.3 Cross-cutting Feature A — Subfunction-level enable/disable governance

**Requirement (as stated):**
- Ability to **enable and disable functionalities in each tool to protect the system.**
- Granularity is the **subfunction (action) level** — not just whole tools. (e.g., allow a tool's `get` action but deny its `delete` action.)
- Configured at the **MCP server configuration level** — a **list of enabled and disabled tools/subfunctions.**
- **Default policy:**
  - **All existing tools → enabled by default** (no behavior change; backward compatible).
  - **New functionalities → disabled by default *if they write or change*.**
  - **Read functions → fine to leave enabled** (default on).

**Implied model:** every tool action carries a **read vs. write/change classification**; the server gates availability from config; default-deny applies only to *new* write/change actions.

**Analyst considerations (for design — not decisions):**
- **Enforcement point:** advertise-time (don't register disabled actions/tools) vs. call-time (advertise, reject on call). Subfunction granularity argues for: register a tool if ≥1 of its actions is enabled, reject disabled actions at call time with a clear error; fully-disabled tools are not registered at all (reduces tool-count surface — aligns with the suite's 5–20-tools-per-server discipline).
- **Action metadata:** the tool-registration framework needs a per-action `mutates: read|write` (or `effect`) flag to drive the default policy. This is new metadata on existing tools too.
- **Config shape:** needs a list format in whatever the servers already use for config (currently shared connection config). Likely `enabledActions` / `disabledActions` (allow/deny) keyed by `tool` or `tool:action`. Precedence rule (deny-wins?) to be defined.
- **Discoverability:** disabled actions should be reflected in tool descriptions or an error message so the agent doesn't repeatedly attempt a blocked action.
- **Interaction with Feature B:** is the policy global, or per-server-profile? (A prod profile may want stricter gating than a dev profile.)

**Decision (2026-06-15):** Governance is a **two-layer cascade — global baseline, then per-server-profile overrides.** Resolution is **explicit-override-by-specificity**: a profile's setting for a permission applies *only if explicitly stated*; otherwise the permission **inherits the global level**. A profile override may go *either* direction — it can disable something globally enabled, or re-enable something globally disabled.
- **Layering:** default seed → global → profile. The **default seed** sets the baseline (existing actions = enabled; new read actions = enabled; new write/change actions = disabled). **Global** config is the org-wide policy (e.g. opt selected new write actions in). **Profile** explicitly overrides global per environment; silence at the profile = inherit global.
- **Precedence formula:** `effective(action, profile) = profile.explicit(action) ?? global.effective(action)`, where `global.effective(action) = global.explicit(action) ?? defaultSeed(action)`.
- This is a straight last-explicit-wins cascade (not most-restrictive-wins): the more specific layer that *speaks* decides; silence defers outward to the next layer.

**Enforcement & discovery — DECIDED (2026-06-15):**
- **Enforcement = call-time (authoritative).** Every tool stays registered/advertised; each invocation is validated at call time against the effective policy for the *targeted profile*, and a blocked action returns a structured, explanatory error (e.g. `action 'iris_backup_manage:run' is disabled by governance policy for server 'prod'`). Call-time is **required, not merely preferred**: the governing profile is selected per call via the `server` param, so the per-profile cascade layer cannot be evaluated at advertise/registration time. (Supersedes the earlier advertise-time / hybrid lean.)
- **Discovery = MCP Resource (advisory).** Expose the governance policy as an MCP **resource** so the agent can read the effective enabled/disabled action map for a given profile and skip attempting blocked actions (fewer failed calls) — *if it chooses*. MCP resources are a supported server primitive (`resources/list`, `resources/templates/list`, `resources/read`; project ref: [`mcp-specification-reference-2025-11-25.md`](./mcp-specification-reference-2025-11-25.md)). Suggested shape: a resource template `iris-governance://{profile}` returning that profile's effective policy, plus a default/global resource for the baseline. Enforcement does **not** depend on the agent reading the resource — the resource is informational; the call-time gate is the security boundary.
- **Implementation note:** the suite is **tools-only today.** Serving a resource means each server must declare the `resources` capability and implement `resources/list` + `resources/read` (and `resources/templates/list` for the parameterized form) — net-new infrastructure in `@iris-mcp/shared`.

### 5.4 Cross-cutting Feature B — Multiple server configurations

**Requirement (as stated):**
- Support **multiple server configurations.**
- Must be done in a way that **does not break existing configurations** (backward compatible).
- Be able to **tell the agent to use a particular server**, and it will **pass that as a parameter to each tool if it is something other than the default server.**
- **User's proposed implementation (one option offered):** allow each tool to take **server url, port, username, password** as parameters on each call, so it can connect to something other than the default server.

**Analyst considerations (for design — not decisions):**
- The user framed raw per-call connection params as *"one way of doing this"* — explicitly an option, not a mandate. Two viable shapes:
  - **(a) Raw connection params per call** (user's suggestion): simple, fully ad-hoc. Costs: username/password repeated on every tool call → leaks credentials into tool-call transcripts/logs, more tokens, more error surface.
  - **(b) Named server profiles** (recommended to evaluate): config defines named profiles (`prod → {host, port, creds, namespace}`); each tool takes an optional `server` (profile name) param. Agent passes just the **name** ("use `prod`"). Credentials stay in config — never on the wire or in transcripts. Backward compatible: omit `server` → current default.
  - **(c) Hybrid:** `server` profile name as primary + optional raw overrides for true ad-hoc targets.
- **Backward compatibility:** whichever shape, the new param(s) must be **optional**; absent = today's default-server behavior. No existing client config changes required.
- **Security note:** option (a) places passwords in model-visible tool arguments. Option (b) keeps secrets server-side. Recommend (b) as primary unless ad-hoc unconfigured targets are a hard requirement.
- **Surface consistency:** the chosen param(s) must be added uniformly across **every** tool in **every** server for predictable agent behavior.

**Decision (2026-06-15):** Adopt **named server profiles (option b).** Config defines named profiles (`name → {host, port, credentials, namespace, ...}`); every tool gains an **optional `server` (profile name) parameter**. The agent passes only the profile name ("use `prod`"); credentials stay server-side and never appear in tool arguments or transcripts. **Backward compatible:** `server` omitted → existing default server, no client-config change required. Raw per-call connection overrides (option a) are **deferred** unless an ad-hoc unconfigured-target requirement emerges. Each server profile also carries its own governance policy layer (see §5.3 decision).

### 5.5 Documentation impact — README + client-config (in scope)

The two cross-cutting features change how every server is configured, so documentation is a **first-class deliverable of this course correction**, not an afterthought.

**Doc targets:**
- **Root [`README.md`](../../../README.md):** the *Set Environment Variables* table (currently `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE`/`IRIS_HTTPS`) and the *Configure Your MCP Client* examples — add server-profile definition, `server`-param usage, and governance-policy config; include an explicit backward-compat note (existing single-server `IRIS_*` setup keeps working unchanged).
- **Client-config guides:** [`docs/client-config/claude-code.md`](../../../docs/client-config/claude-code.md), [`claude-desktop.md`](../../../docs/client-config/claude-desktop.md), [`cursor.md`](../../../docs/client-config/cursor.md) — same additions, per client.
- **Per-package READMEs (6):** `iris-dev-mcp`, `iris-admin-mcp`, `iris-interop-mcp`, `iris-ops-mcp`, `iris-data-mcp`, and the meta-package `iris-mcp-all` — each should point to the shared profile/governance config and call out which of its actions are **new and default-disabled** (write/change) so users know what to opt in.
- **[`packages/shared/README.md`](../../../packages/shared/README.md):** the shared connection layer — document profile resolution + the governance gate if implemented there.

**What must be documented:**
- **Multi-server:** how to define named profiles; how to select one via the `server` param ("use `prod`"); that omitting it uses the default; that the existing single-server `IRIS_*` env setup is untouched.
- **Governance:** the default seed (existing = on, new reads = on, new writes = off); how to set the global policy; how to set per-profile overrides; the cascade resolution (§5.3); a worked example (e.g. enable `iris_backup_manage:run` globally, then disable it for the `prod` profile).

**Config mechanism — DECIDED (2026-06-15):** profiles and governance policy are supplied as **JSON blobs in environment variables** (e.g. `IRIS_PROFILES`, `IRIS_GOVERNANCE`) — **not** an external config file. This keeps all configuration in the MCP client's `env` block (consistent with today's `IRIS_*` vars), so the `docs/client-config/*` guides remain the single place users configure connections. The **default profile maps to today's `IRIS_*` vars** for backward compatibility (omit `server` → default profile → existing `IRIS_*`). Doc examples are unblocked.
- **Ergonomics note for doc authors:** a JSON blob lives *inside* the client's already-JSON `env` value, so the string must be properly escaped (or single-line-stringified). README/client-config examples must show correctly-escaped `IRIS_PROFILES` / `IRIS_GOVERNANCE` values so users can copy-paste without breaking their `.mcp.json` / `claude_desktop_config.json`.

### 5.6 Explicitly deferred (NOT in this course correction)

From §4, the following remain candidates for later cycles and are **out of scope** for the first course correction: `iris_rule_manage`, `iris_rule_test`, `iris_pubsub_manage`, `iris_workflow_manage`, `iris_business_partner_manage`, `iris_deployment`, `iris_archive_manage`, `iris_journal_manage`, `iris_mirror_manage`, `iris_external_language_server`, and all Tier 3 items.

---

## 6. Open Questions / Verification Items

1. **⚠️ Live-probe before committing** (Rule #16): `Ens.Deployment.*` API shape, `Ens.Archive.Manager`, external-language-server config classes, and `Backup.General` **restore** path (restore may be `^DBREST`-bound and not cleanly scriptable).
2. **Governance precedence:** ✅ RESOLVED (2026-06-15) — two-layer cascade, explicit-override-by-specificity (profile override wins when stated, else inherit global, else default seed). See §5.3.
3. **Governance enforcement point:** ✅ RESOLVED (2026-06-15) — **call-time** (authoritative gate; required because the profile is selected per-call), plus an **MCP resource** (`iris-governance://{profile}`) exposing per-profile effective policy for advisory discovery. Requires adding the `resources` server capability (net-new; tools-only today). See §5.3.
4. **Policy scope vs. Feature B:** ✅ RESOLVED (2026-06-15) — policy is global **and** per-profile (cascade). See §5.3.
5. **Feature B shape:** ✅ RESOLVED (2026-06-15) — named server profiles; optional `server` param per tool; raw per-call overrides deferred. See §5.4.
6. **Enhancement placement:** column/schema SQL privileges — extend `iris_resource_manage` or introduce `iris_sql_privilege`? Add/remove items — `iris_production_item` vs `iris_production_manage`?
7. **Bootstrap impact:** new ObjectScript handler classes require `gen:bootstrap` regeneration (per project memory/rules) — fold into the change proposal's file list.
8. **Config home for profiles + governance:** ✅ RESOLVED (2026-06-15) — **JSON blob in environment variables** (e.g. `IRIS_PROFILES` / `IRIS_GOVERNANCE`), **not** an external config file. Default profile maps to today's `IRIS_*` vars for backward compatibility. Unblocks §5.5 doc examples; only ergonomics caveat is escaping the JSON string inside the client's JSON `env` block.

---

## 7. References

- Portal source enumerated via `iris_doc_list` / `iris_doc_get` (namespace HSCUSTOM): `EnsPortal.*`, `%CSP.Portal.*`, `%CSP.UI.Portal.*`.
- Existing suite categorization: [`iris-mcp-v2-server-suites-2026-04-05.md`](./iris-mcp-v2-server-suites-2026-04-05.md).
- Project rules referenced: #2 (read IRIS class source before wrapping), #3 (Config/SYS/Security separation), #16 (verify spec "X exists" claims via live probe), #18 (auto-generated bootstrap is output-only).
