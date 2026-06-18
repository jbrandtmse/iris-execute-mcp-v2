# Sprint Change Proposal — 2026-06-15

**Author:** Mary (Business Analyst) via `bmad-correct-course`
**Trigger:** Management Portal tool-gap analysis ([mcp-tool-expansion-gap-analysis-2026-06-15.md](./research/mcp-tool-expansion-gap-analysis-2026-06-15.md))
**Change type:** Additive capability expansion (new requirement from stakeholder)
**Path forward:** Option 1 — Direct Adjustment (append new epics)
**Scope classification:** Major (new platform capability; architect involvement for shared-core changes)
**Review mode:** Batch
**New epics:** Epic 14, 15, 16, 17
**New FRs:** FR111–FR126

---

## 1. Issue Summary

A capability-gap analysis of the IRIS Management Portal (`EnsPortal.*` for Interoperability, `%CSP.UI.Portal.*` for System Administration) surfaced management surface the MCP suite does not yet expose. The user selected a first tranche for implementation: **9 new tools, 3 enhancements to existing tools, and 2 cross-cutting platform features** (multi-server profiles + subfunction-level governance).

This is not a defect or a failed approach — all 13 existing epics are `done` and remain valid. The change is purely **additive scope**, captured and design-resolved in the research doc before this proposal. Every cross-cutting design decision (profile model, governance cascade, config home, enforcement point, discovery resource) is already settled there.

**Selected scope:**
- **New tools (9):** `iris_default_settings_manage`, `iris_service_manage`, `iris_backup_manage`, `iris_process_manage`, `iris_ldap_manage`, `iris_x509_manage`, `iris_audit_manage`, `iris_database_action`, `iris_sql_analyze`.
- **Enhancements (3):** add/remove production config items; set arbitrary host/adapter settings (both on `iris_production_item`); column/schema-level SQL privileges (on `iris_resource_manage`).
- **Cross-cutting A — Governance:** subfunction-level enable/disable, two-layer cascade (global + per-profile), call-time enforcement, advisory MCP resource.
- **Cross-cutting B — Multi-server:** named server profiles, optional `server` param per tool, JSON-blob env-var config, backward compatible.

---

## 2. Impact Analysis

### Epic Impact
- **No existing epic invalidated, rolled back, or rescoped.** Epics 1–13 are `done`.
- **Four new epics appended (14–17),** following the established additive pattern used for Epics 9–13.
- **One hard sequencing constraint:** the platform foundation (Epic 14) must land before the tool epics (15–17), so every new tool is born profile-aware and governance-gated.

### Story Impact
- **20 new stories** across 4 epics. No existing story is touched.
- Foundation epic (14) carries the shared-core integration risk; tool epics (15–17) follow the proven per-server pattern with a single BOOTSTRAP_VERSION bump each.

### Artifact Conflicts
| Artifact | Impact | Nature |
|---|---|---|
| **PRD** | Add FR111–FR126; no existing FR changed | Additive |
| **Architecture** | 4 sections extended (see §4.2); no decision reversed | Additive |
| **UX** | N/A — headless MCP server suite | None |
| **README + `docs/client-config/*`** | New multi-server + governance config docs | Additive (in-scope deliverable) |
| **`bootstrap-classes.ts`** | Regenerate for new ObjectScript handlers (Epics 15–17) | Generated output — regen per Rule #18 |
| **`sprint-status.yaml`** | Add epic-14…17 + stories as `backlog` | Additive |
| **CHANGELOG** | New entries per epic | Additive |

### Technical Impact
- **`@iris-mcp/shared`** is the highest-touch component: new profile-resolution in the connection layer, governance policy engine + call-time gate in the registration framework, and a **net-new `resources` server capability** (the suite is tools-only today). This is the most material architectural change.
- **Every server** gains an optional `server` parameter on every tool and routes calls through the governance gate.
- **New ObjectScript REST handlers** (Security.Services, LDAP, X509, Audit, Backup, Process, Database actions, Ens.Config.DefaultSettings, production-item editing) → **3 BOOTSTRAP_VERSION bumps** (one per tool epic).
- **Security-sensitive surface:** `iris_service_manage`, `iris_audit_manage`, `iris_x509_manage`, `iris_ldap_manage` touch authentication/audit/certs — exactly why governance defaults their write actions to **disabled**.

---

## 3. Recommended Approach

**Option 1 — Direct Adjustment.** Append four new epics within the existing plan; no rollback, no MVP reduction.

**Rationale:** The existing suite is stable and published; this is purely new capability. The per-server epic structure (Epics 2–7) and the additive course-correction pattern (Epics 9–13) are both proven. Splitting foundation-first then one epic per server-domain isolates the integration risk (shared core) into Epic 14 and keeps each tool epic to a single bootstrap bump.

- **Effort:** High (20 stories; substantial shared-core work).
- **Risk:** Medium — concentrated in Epic 14's shared-core changes. Mitigation: land Epic 14 first with cross-server integration tests; keep governance/profiles strictly backward-compatible (absent config = today's behavior).
- **Timeline/sequencing:** Epic 14 → then 15, 16, 17 (the three tool epics are mutually independent and may run in any order, or in parallel if capacity allows, once 14 is done).

---

## 4. Detailed Change Proposals

> Additive change — these are new content blocks for `epics.md`, `prd.md`, `architecture.md`, and `sprint-status.yaml`. No before/after diffs (nothing existing is modified).

### 4.1 PRD additions (append to Functional Requirements)

**Epic 14 — Platform Foundation**
- **FR111:** Operator can define multiple named IRIS server profiles (host, port, username, password, namespace, HTTPS) via an `IRIS_PROFILES` JSON environment variable. The existing `IRIS_*` variables define the **default** profile, preserving backward compatibility (no `IRIS_PROFILES` set → single default server, today's behavior).
- **FR112:** AI client can target a specific server profile per tool call via an optional `server` parameter present on every tool; omitting it uses the default profile. No tool call leaks credentials — `server` carries only the profile **name**.
- **FR113:** Operator can govern tool availability at the subfunction (action) level via an `IRIS_GOVERNANCE` JSON environment variable, resolved as a two-layer cascade `profile.explicit ?? global.explicit ?? defaultSeed`. The default seed enables all existing actions and all new **read** actions, and disables all new **write/change** actions.
- **FR114:** Server enforces governance at **call time**, rejecting a disabled action with a structured error identifying the action and the target profile. All tools remain advertised (enforcement is per-call because the governing profile is selected per-call).
- **FR115:** AI client can read the effective governance policy for a given profile via an MCP **resource** (`iris-governance://{profile}`), advisory only — enforcement does not depend on the client reading it.

**Epic 15 — Security & Admin Tools**
- **FR116:** Administrator can list IRIS services, enable/disable them, and configure their authentication settings (`Security.Services`).
- **FR117:** Administrator can list, get, create, modify, delete, and test LDAP configurations (`Security.LDAPConfigs`).
- **FR118:** Administrator can list, get, import, and delete X.509 certificate credentials (`%SYS.X509Credentials`).
- **FR119:** Administrator can enable/disable auditing, configure audit events, and view/purge/export the audit log (`Security.Events` + `%SYS.Audit`).
- **FR120:** Administrator can grant and revoke column-level and schema-level SQL privileges (`iris_resource_manage` enhancement).

**Epic 16 — Operations Tools**
- **FR121:** Operator can inspect process detail (stack/variables) and terminate/suspend/resume processes (`%SYS.ProcessQuery` + `SYS.Process`).
- **FR122:** Operator can mount/dismount databases and run compact/defragment/truncate/expand-volume operations (`SYS.Database`).
- **FR123:** Operator can run full/incremental/cumulative backups, freeze/thaw the system for external backup, and list backup history (`Backup.General`).

**Epic 17 — Interop & Dev Tools**
- **FR124:** Integration engineer can list/get/set/delete Interoperability System Default Settings (`Ens.Config.DefaultSettings`).
- **FR125:** Integration engineer can add and remove production config items and set arbitrary host/adapter settings (`iris_production_item` enhancement).
- **FR126:** Developer can analyze SQL — show execution plan, runtime statistics, index usage, and list currently-running statements (`iris_sql_analyze`).

### 4.2 Architecture additions (extend existing sections)

- **§ HTTP Client & Connection Architecture** — add **multi-profile connection resolution**: `IRIS_PROFILES` parsed at startup into a profile registry; default profile sourced from `IRIS_*` vars; the per-call `server` param selects which profile's connection the `IrisHttpClient` uses for that call. Connection pooling/session is keyed per profile.
- **§ Authentication & Security** — per-profile credentials held server-side (never on the wire); governance cascade defined here as the authorization layer over tool actions; security-sensitive new tools default to disabled write actions.
- **§ MCP Server Registration Pattern** — add (a) per-action **`mutates: read|write`** classification metadata on tool registration; (b) the **call-time governance gate** wrapping every handler; (c) the net-new **`resources` capability** (`resources/list`, `resources/read`, `resources/templates/list`) serving `iris-governance://{profile}`.
- **§ Error Handling Strategy** — add the **governance-denied error shape**: structured, names the action + target profile, distinct from IRIS errors.

### 4.3 New Epics

---

## Epic 14: Platform Foundation — Multi-Server Profiles & Tool Governance (cross-cutting)

**Goal**: Give the suite two new platform capabilities — address multiple IRIS instances from one running server via named profiles, and govern tool availability at the action level — without breaking any existing single-server, ungoverned configuration.

**Scope**: Shared-core work in `@iris-mcp/shared` (connection resolution, governance engine, `resources` capability) plus a uniform `server` parameter across all five servers. **TypeScript-only — no new ObjectScript classes, so `BOOTSTRAP_VERSION` is unchanged.** Configuration is supplied as JSON blobs in environment variables (`IRIS_PROFILES`, `IRIS_GOVERNANCE`); absence of both = today's exact behavior.

**Functional Requirements (new)**: FR111, FR112, FR113, FR114, FR115.

**Stories**:
- 14.1 Multi-server profiles — config model + connection resolution (shared)
- 14.2 `server` parameter across all tool schemas (all 5 servers)
- 14.3 Governance policy model, action classification & cascade resolution (shared)
- 14.4 Call-time governance enforcement & structured denial error
- 14.5 Governance discovery resource + `resources` capability
- 14.6 Documentation rollup — README + client-config + per-package

**Out of scope (deferred)**:
- Raw per-call connection overrides (url/port/user/pass as params) — deferred unless an ad-hoc unconfigured-target need emerges; named profiles cover the requirement.
- Server-side (IRIS) governance enforcement — enforcement is at the MCP server layer only.
- Profile/policy hot-reload — config read at startup; restart to change.

### Story 14.1: Multi-Server Profiles — Config Model & Connection Resolution

**As an** operator running the MCP suite against more than one IRIS instance,
**I want** to define named server profiles and have the connection layer resolve the right one per call,
**so that** one running server process can target prod, staging, or dev without separate processes — while my existing single-server setup keeps working untouched.

**Acceptance Criteria**:
- **AC 14.1.1** — `@iris-mcp/shared` parses an `IRIS_PROFILES` env var (JSON object: `{ "<name>": { host, port, username, password, namespace, https } }`) at startup into a profile registry. Malformed JSON fails fast with a clear startup error naming the offending var.
- **AC 14.1.2** — The **default profile** is synthesized from the existing `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE`/`IRIS_HTTPS` vars and registered under a reserved name (`default`). When `IRIS_PROFILES` is absent, only the default profile exists — **byte-for-byte today's behavior**.
- **AC 14.1.3** — A profile in `IRIS_PROFILES` may omit fields; omitted fields inherit from the default profile (so a profile can override just `host`).
- **AC 14.1.4** — `IrisHttpClient` resolves connection config by profile name; sessions/cookies are cached **per profile** (no cross-profile session bleed).
- **AC 14.1.5** — A `resolveProfile(name?)` helper returns the named profile or the default when `name` is undefined; an unknown profile name throws a structured error listing valid profile names.
- **AC 14.1.6** — Unit tests: default-only (no `IRIS_PROFILES`), multi-profile parse, field inheritance, unknown-profile error, per-profile session isolation, malformed-JSON startup failure.

**Implementation Notes**:
- Default profile name `default` is reserved; if `IRIS_PROFILES` defines `default`, it overrides the `IRIS_*`-derived one (with a startup warning).
- Credentials never leave the server process — the `server` param (Story 14.2) carries only the profile name.

### Story 14.2: `server` Parameter Across All Tool Schemas

**As an** AI client told to "use the prod server",
**I want** every tool to accept an optional `server` profile-name parameter,
**so that** I can target a profile per call without any other change, and omitting it transparently uses the default.

**Acceptance Criteria**:
- **AC 14.2.1** — Every tool in all five servers gains an optional `server` (string) parameter: "Named server profile to target for this call (from `IRIS_PROFILES`). Omit to use the default server."
- **AC 14.2.2** — The shared tool-registration helper injects `server` into each tool's Zod schema centrally (not hand-added per tool), so coverage is uniform and future tools inherit it.
- **AC 14.2.3** — `server` resolves via `resolveProfile` (14.1) and selects the connection for that call; concurrent calls with different `server` values do not interfere (analogous to the existing per-call `namespace` override, FR7b/FR7c).
- **AC 14.2.4** — Omitting `server` → default profile. Existing clients that never send `server` are unaffected.
- **AC 14.2.5** — Precedence with `namespace`: `server` selects the instance/profile; `namespace` still overrides the namespace within that profile. Both may be combined.
- **AC 14.2.6** — Tests confirm `server` is present on a representative tool per server, resolution works, unknown-profile errors surface cleanly, and concurrent mixed-profile calls stay isolated.

**Implementation Notes**:
- Inject centrally where tool annotations are applied in `@iris-mcp/shared` registration. Avoid touching each tool file.

### Story 14.3: Governance Policy Model, Action Classification & Cascade Resolution

**As an** operator protecting an instance from unwanted mutations,
**I want** a policy model that enables/disables tool actions with a global baseline and per-profile overrides,
**so that** I can lock down writes globally and tune exceptions per environment, with safe defaults.

**Acceptance Criteria**:
- **AC 14.3.1** — Each tool action carries `mutates: 'read' | 'write'` classification metadata declared at registration.
- **AC 14.3.2** — `@iris-mcp/shared` parses `IRIS_GOVERNANCE` (JSON: `{ "global": { "<tool|tool:action>": true|false }, "profiles": { "<name>": { ... } } }`) at startup; malformed JSON fails fast with a clear error.
- **AC 14.3.3** — The **default seed**: existing actions = enabled; new `read` actions = enabled; new `write` actions = **disabled**. (New tools/actions are tagged so the seed can distinguish them.)
- **AC 14.3.4** — Effective resolution implements `effective(action, profile) = profile.explicit(action) ?? global.explicit(action) ?? defaultSeed(action)`. A profile override may enable or disable, in either direction.
- **AC 14.3.5** — Resolution is unit-tested across: default-seed only, global-enable of a new write action, profile override down (disable globally-enabled), profile override up (re-enable globally-disabled), silent-profile-inherits-global, and unknown-action handling.
- **AC 14.3.6** — A `getEffectivePolicy(profile)` API returns the full enabled/disabled action map for a profile (consumed by 14.4 enforcement and 14.5 resource).

**Implementation Notes**:
- Keep classification co-located with tool registration so it can't drift from the tool set.
- The "new vs existing" distinction for the seed: tag actions added in Epics 14–17 as `since: 'epic14+'` (or a boolean `isNew`) so existing-tool behavior is provably unchanged.

### Story 14.4: Call-Time Governance Enforcement & Structured Denial Error

**As an** operator,
**I want** disabled actions rejected when invoked,
**so that** the policy is actually enforced regardless of which profile a call targets.

**Acceptance Criteria**:
- **AC 14.4.1** — Every tool invocation passes through a governance gate that evaluates `getEffectivePolicy(resolvedProfile)` for the call's resolved `server` profile **before** reaching the handler.
- **AC 14.4.2** — A disabled action returns a structured error (e.g. `action 'iris_backup_manage:run' is disabled by governance policy for server 'prod'`) with a machine-readable code; the IRIS handler is never called.
- **AC 14.4.3** — Enforcement is **call-time** (not advertise-time): all tools remain in `tools/list`. Rationale documented inline — the governing profile is per-call.
- **AC 14.4.4** — Read actions and all existing actions are unaffected when no governance config is present (default seed).
- **AC 14.4.5** — Tests: denied write action blocked + correct error; same action allowed under a profile that re-enables it; existing action always allowed under empty config; gate runs after profile resolution.

**Implementation Notes**:
- Implement as a wrapper in the shared registration framework so all servers inherit it uniformly.

### Story 14.5: Governance Discovery Resource & `resources` Capability

**As an** AI client,
**I want** to read the effective governance policy for a profile,
**so that** I can avoid attempting blocked actions — without the resource being a security dependency.

**Acceptance Criteria**:
- **AC 14.5.1** — Each server declares the MCP **`resources` capability** in its initialize response (net-new — suite is tools-only today).
- **AC 14.5.2** — Implements `resources/list` (a default/global policy resource) and `resources/templates/list` exposing `iris-governance://{profile}`.
- **AC 14.5.3** — `resources/read` of `iris-governance://{profile}` returns the effective enabled/disabled action map for that profile (from `getEffectivePolicy`), as JSON; unknown profile → structured error.
- **AC 14.5.4** — The resource is **advisory** — the call-time gate (14.4) remains the authoritative boundary; a client that never reads the resource still gets correct enforcement.
- **AC 14.5.5** — Tests: capability advertised, list/templates/read shapes, per-profile policy correctness, unknown-profile error.

**Implementation Notes**:
- Add resource plumbing to the shared server base so all five servers expose it consistently.
- Reference: project MCP spec ref (2025-11-25) confirms `resources/templates/list` and the `resources` capability.

### Story 14.6: Documentation Rollup — Multi-Server & Governance

**As a** user configuring the suite,
**I want** clear docs for profiles and governance,
**so that** I can set them up correctly with copy-pasteable, correctly-escaped examples.

**Acceptance Criteria**:
- **AC 14.6.1** — Root `README.md`: extend the *Set Environment Variables* table with `IRIS_PROFILES` / `IRIS_GOVERNANCE`; add a *Multiple Servers & Governance* subsection under *Configure Your MCP Client* with worked examples.
- **AC 14.6.2** — `docs/client-config/claude-code.md`, `claude-desktop.md`, `cursor.md`: add profile + governance config blocks per client, with **correctly-escaped JSON-in-env** examples that copy-paste without breaking the client config.
- **AC 14.6.3** — Each per-package README (`iris-dev`, `iris-admin`, `iris-interop`, `iris-ops`, `iris-data`) + `iris-mcp-all`: note the `server` param and link to the shared profile/governance docs.
- **AC 14.6.4** — A worked governance example (enable `iris_backup_manage:run` globally, disable it for the `prod` profile) is shown end-to-end.
- **AC 14.6.5** — Backward-compat statement: "existing single-server `IRIS_*` setups require no changes."
- **AC 14.6.6** — CHANGELOG entry for the foundation feature.

---

## Epic 15: Security & Admin Tools (iris-admin-mcp)

**Goal**: Close the largest security-management gaps in the portal surface — service toggling, LDAP, X.509 certs, audit, and column/schema SQL privileges — all governed (write actions default-disabled).

**Scope**: New ObjectScript REST handler methods (namespace `%SYS` per Rule #3) for `Security.Services`, `Security.LDAPConfigs`, `%SYS.X509Credentials`, `Security.Events`/`%SYS.Audit`; SQL GRANT/REVOKE for privileges; new TypeScript tools in `@iris-mcp/admin`. **One `BOOTSTRAP_VERSION` bump** at the closing story covers all Epic-15 ObjectScript. Built on the Epic 14 foundation (each tool ships with `server` param + governance classification).

**Functional Requirements (new)**: FR116, FR117, FR118, FR119, FR120.

**Stories**:
- 15.1 `iris_service_manage` — Security.Services
- 15.2 `iris_ldap_manage` — Security.LDAPConfigs
- 15.3 `iris_x509_manage` — %SYS.X509Credentials
- 15.4 `iris_audit_manage` — Security.Events + %SYS.Audit
- 15.5 `iris_resource_manage` — column/schema SQL privilege enhancement
- 15.6 BOOTSTRAP_VERSION bump + live verification + documentation rollup

**Out of scope (deferred)**: encryption key management, phone providers (2FA), authentication-method wizards — deferred per research doc Tier 3.

### Story 15.1: `iris_service_manage` — IRIS Service Configuration
**As an** administrator, **I want** to list and toggle IRIS services and their auth settings, **so that** I can harden an instance (e.g. disable `%Service_Telnet`) via the agent.
**Acceptance Criteria**:
- **AC 15.1.1** — Tool `iris_service_manage` in `@iris-mcp/admin`. Actions: `list`, `get`, `enable`, `disable`, `set`. Annotations: `list`/`get` `readOnlyHint:true`; `enable`/`disable`/`set` `readOnlyHint:false`.
- **AC 15.1.2** — Governance: `enable`/`disable`/`set` classified `mutates:write` → **default-disabled**; `list`/`get` `read` → enabled.
- **AC 15.1.3** — Backed by a `%SYS` handler method reading/writing `Security.Services` (`List`, `Get`, `Modify`); namespace save/restore per Rule (no `New $NAMESPACE`).
- **AC 15.1.4** — Input: `action`, `name` (service, e.g. `%Service_SQL`), `settings` (for `set`/auth), `server` (profile), `namespace`. Output: service list/properties or a structured result.
- **AC 15.1.5** — Errors propagate via `SanitizeError` (Rule #9); `%Status` text preserved.
- **AC 15.1.6** — Unit tests: list, get, enable/disable round-trip (mocked), governance-disabled-by-default assertion.

**Implementation Notes**: Read `Security.Services` source in `irislib`/`irissys` first (Rule #2). Handler likely in a new `ExecuteMCPv2.REST.Security`-adjacent method or a new `Services` handler class.

### Story 15.2: `iris_ldap_manage` — LDAP Configurations
**As an** administrator, **I want** to manage and test LDAP configs, **so that** I can configure delegated auth via the agent.
**Acceptance Criteria**:
- **AC 15.2.1** — Tool with actions `list`, `get`, `create`, `modify`, `delete`, `test`. Read actions read-only; mutating actions default-disabled by governance.
- **AC 15.2.2** — Backed by `Security.LDAPConfigs` (%SYS); `test` exercises a connection check.
- **AC 15.2.3** — Input: `action`, `name`, `settings`, `server`, `namespace`. Output: config(s) / test result.
- **AC 15.2.4** — Sensitive fields (bind password) redacted in output per Rule #9 redaction guidance.
- **AC 15.2.5** — Unit tests cover each action + governance defaults.

**Implementation Notes**: Verify `Security.LDAPConfigs` query/property shape against source (Rule #2). Confirm a test-connection API exists; if not, scope `test` to a config-validity check and note it.

### Story 15.3: `iris_x509_manage` — X.509 Certificate Credentials
**As an** administrator, **I want** to manage X.509 credentials, **so that** I can administer certs used by SSL configs and services.
**Acceptance Criteria**:
- **AC 15.3.1** — Tool with actions `list`, `get`, `import`, `delete`. Read actions read-only; `import`/`delete` default-disabled.
- **AC 15.3.2** — Backed by `%SYS.X509Credentials`.
- **AC 15.3.3** — `import` accepts a certificate (path or base64 per handler capability — determine during impl); `get`/`list` never return private-key material.
- **AC 15.3.4** — Input: `action`, `alias`, cert payload, `server`, `namespace`. Output: credential metadata.
- **AC 15.3.5** — Unit tests + governance defaults.

**Implementation Notes**: Read `%SYS.X509Credentials` source (Rule #2). Confirm import signature/field names via live probe (Rule #16).

### Story 15.4: `iris_audit_manage` — Audit Configuration & Log
**As an** administrator, **I want** to configure auditing and manage the audit log, **so that** I can run compliance operations via the agent.
**Acceptance Criteria**:
- **AC 15.4.1** — Tool actions: `status`, `enable`, `disable`, `configureEvent`, `view`, `purge`, `export`. `status`/`view` read-only; the rest default-disabled.
- **AC 15.4.2** — Backed by `Security.Events` (event config) + `%SYS.Audit` / `$SYSTEM.Security.Audit` (enable/disable, view/purge/export). Complements the read-only ops `audit_events` — note the relationship in the tool description.
- **AC 15.4.3** — `view` supports filtering (event, user, time, max rows); `purge` and `export` are clearly destructive/output operations.
- **AC 15.4.4** — Input: `action`, filter/config params, `server`, `namespace`. Output: status / events / purge count / export location.
- **AC 15.4.5** — Unit tests + governance defaults; `purge` carries `destructiveHint:true`.

**Implementation Notes**: Distinguish instance audit (`%SYS.Audit`) from the Ensemble event log (already covered by `iris_production_logs`). Read sources first (Rule #2).

### Story 15.5: `iris_resource_manage` — Column/Schema SQL Privilege Enhancement
**As an** administrator, **I want** to grant/revoke column- and schema-level SQL privileges, **so that** I can manage fine-grained SQL access (parity with the SMP privilege dialogs).
**Acceptance Criteria**:
- **AC 15.5.1** — Extend `iris_resource_manage` (or add a focused capability) with `grant`/`revoke` for schema- and column-level SQL privileges. New mutating actions default-disabled.
- **AC 15.5.2** — Implemented via SQL `GRANT`/`REVOKE` / `$SYSTEM.SQL.Security` (verify API per Rule #16); mirrors `%CSP.UI.Portal.Dialog.ColumnPriv` / `SchemaPriv` semantics.
- **AC 15.5.3** — Input: target (schema/table/column), privilege (SELECT/INSERT/UPDATE/DELETE/REFERENCES), grantee (user/role), `server`, `namespace`.
- **AC 15.5.4** — Read path lists current grants for a target.
- **AC 15.5.5** — Unit tests + governance defaults.

**Implementation Notes**: Decide placement (extend `resource_manage` vs new `iris_sql_privilege`) during impl — research doc flags this as an open placement question; recommend extending `resource_manage` to keep the tool count lean.

### Story 15.6: BOOTSTRAP Bump + Live Verification + Documentation Rollup
**Acceptance Criteria**:
- **AC 15.6.1** — Single `BOOTSTRAP_VERSION` bump covering all Epic-15 ObjectScript; regenerate `bootstrap-classes.ts` via `pnpm run gen:bootstrap` (Rule #18 — never hand-edit).
- **AC 15.6.2** — Live-verify each tool on HSCUSTOM (Rule #16): a non-destructive call per tool (e.g. `list`/`get`/`status`).
- **AC 15.6.3** — Per-package README (`iris-admin`) + `tool_support.md` + `iris-mcp-all` + CHANGELOG updated for the 4 new tools + privilege enhancement; tool counts rolled up.
- **AC 15.6.4** — Deploy via glob-prefixed `iris_doc_load` path (Rule #17).

---

## Epic 16: Operations Tools (iris-ops-mcp)

**Goal**: Add the operational control-plane the ops server is missing — process control, database actions, and backups.

**Scope**: New `%SYS` ObjectScript handlers for `%SYS.ProcessQuery`/`SYS.Process`, `SYS.Database`/`%SYS.DatabaseCompact`/`%SYS.DatabaseDefragment`, `Backup.General`; new tools in `@iris-mcp/ops`. **One `BOOTSTRAP_VERSION` bump** at the closing story. Built on Epic 14 (governed; write actions default-disabled).

**Functional Requirements (new)**: FR121, FR122, FR123.

**Stories**:
- 16.1 `iris_process_manage` — process detail + terminate/suspend/resume
- 16.2 `iris_database_action` — mount/dismount/compact/defragment/truncate/expand
- 16.3 `iris_backup_manage` — run/freeze/thaw/list (restore: verify-first)
- 16.4 BOOTSTRAP_VERSION bump + live verification + documentation rollup

**Out of scope (deferred)**: CSP session management, transaction listing, ECP config — Tier 3.

### Story 16.1: `iris_process_manage` — Process Detail & Control
**As an** operator, **I want** process detail and the ability to terminate/suspend/resume, **so that** I can manage runaway or stuck processes (extends read-only `jobs_list`).
**Acceptance Criteria**:
- **AC 16.1.1** — Actions: `get` (detail incl. stack/state/routine/namespace via `%SYS.ProcessQuery`), `terminate`, `suspend`, `resume` (via `SYS.Process`). `get` read-only; control actions default-disabled.
- **AC 16.1.2** — `terminate` carries `destructiveHint:true`.
- **AC 16.1.3** — Input: `action`, `pid`, `server`, `namespace`. Output: process detail / action result.
- **AC 16.1.4** — Guard against terminating the calling process / critical system jobs with a clear refusal.
- **AC 16.1.5** — Unit tests + governance defaults.

**Implementation Notes**: Read `%SYS.ProcessQuery` + `SYS.Process` sources (Rule #2); `$SYSTEM.Process.Terminate` semantics.

### Story 16.2: `iris_database_action` — Database Operations
**As an** operator, **I want** to mount/dismount and compact/defragment/truncate/expand databases, **so that** I can run maintenance the admin create/delete tool doesn't cover.
**Acceptance Criteria**:
- **AC 16.2.1** — Actions: `mount`, `dismount`, `compact`, `defragment`, `truncate`, `expandVolume`. All default-disabled (all mutate).
- **AC 16.2.2** — Backed by `SYS.Database`, `%SYS.DatabaseCompact`, `%SYS.DatabaseDefragment`, volume APIs (Config/SYS split per Rule #3).
- **AC 16.2.3** — Input: `action`, `directory` (db), action-specific params, `server`, `namespace`. Output: operation result/status.
- **AC 16.2.4** — Long-running operations return a started/queued status with a way to check progress (or run synchronously with a clear duration note — determine per API during impl).
- **AC 16.2.5** — Unit tests + governance defaults; `truncate`/`dismount` `destructiveHint:true`.

**Implementation Notes**: Read `SYS.Database` + compaction/defrag class sources (Rule #2). Verify mount/dismount API (Config.Databases vs SYS.Database) via live probe (Rule #16).

### Story 16.3: `iris_backup_manage` — Backups
**As an** operator, **I want** to run backups and freeze/thaw the system, **so that** I can perform and audit backups via the agent.
**Acceptance Criteria**:
- **AC 16.3.1** — Actions: `run` (full/incremental/cumulative), `freeze`, `thaw`, `listHistory`. `listHistory` read-only; the rest default-disabled.
- **AC 16.3.2** — Backed by `Backup.General` (+ `^BACKUP`/`^DBREST` where applicable).
- **AC 16.3.3** — **⚠️ Restore path verify-first (Rule #16):** confirm whether `restore` is cleanly scriptable via `Backup.General` or is `^DBREST`-bound; if not cleanly scriptable, **defer `restore`** to a follow-up and document the limitation rather than shipping a half-working action.
- **AC 16.3.4** — Input: `action`, backup type/device/target, `server`, `namespace`. Output: backup result + history.
- **AC 16.3.5** — Unit tests + governance defaults; `run`/`freeze` carry appropriate hints.

**Implementation Notes**: Read `Backup.General` source (Rule #2); probe the restore path live before committing to it (Rule #16).

### Story 16.4: BOOTSTRAP Bump + Live Verification + Documentation Rollup
**Acceptance Criteria**:
- **AC 16.4.1** — Single `BOOTSTRAP_VERSION` bump covering Epic-16 ObjectScript; regenerate `bootstrap-classes.ts` (Rule #18).
- **AC 16.4.2** — Live-verify each tool on HSCUSTOM with a safe call (`get`/`listHistory`); validate counters/monotonicity where relevant (Rule #5).
- **AC 16.4.3** — `iris-ops` README + `tool_support.md` + `iris-mcp-all` + CHANGELOG updated; counts rolled up.
- **AC 16.4.4** — Deploy via glob-prefixed `iris_doc_load` (Rule #17).

---

## Epic 17: Interop & Dev Tools (iris-interop-mcp + iris-dev-mcp)

**Goal**: Add the remaining selected tools — Interoperability System Default Settings, production-item editing depth, and SQL analysis — across the interop and dev servers.

**Scope**: New `Ens.Config.DefaultSettings` handler + `iris_production_item` handler enhancement (interop, `BOOTSTRAP_VERSION` bump); `iris_sql_analyze` (dev — determine Atelier/SQL-only vs handler-needed during impl). **One `BOOTSTRAP_VERSION` bump** at the closing story (covers interop ObjectScript; dev `sql_analyze` only if it needs a handler). Built on Epic 14.

**Functional Requirements (new)**: FR124, FR125, FR126.

**Stories**:
- 17.1 `iris_default_settings_manage` — Ens.Config.DefaultSettings
- 17.2 `iris_production_item` enhancement — add/remove items + arbitrary settings
- 17.3 `iris_sql_analyze` — plan/stats/index/running
- 17.4 BOOTSTRAP_VERSION bump + live verification + documentation rollup

**Out of scope (deferred)**: rule write/test, pub/sub, workflow, business partners, deployment, archive — all deferred per research doc §5.6 (future epics).

### Story 17.1: `iris_default_settings_manage` — System Default Settings
**As an** integration engineer, **I want** to manage Interoperability System Default Settings, **so that** I can configure the production-portable settings override layer via the agent.
**Acceptance Criteria**:
- **AC 17.1.1** — Tool in `@iris-mcp/interop`. Actions: `list`, `get`, `set`, `delete`. `list`/`get` read-only; `set`/`delete` default-disabled.
- **AC 17.1.2** — Backed by `Ens.Config.DefaultSettings` (production/item/host/setting/value tuple model — verify shape per Rule #2/#16).
- **AC 17.1.3** — Input: `action`, settings key tuple (production, item, host, setting), `value`, `server`, `namespace`. Output: settings list/result.
- **AC 17.1.4** — Unit tests + governance defaults.

**Implementation Notes**: Read `Ens.Config.DefaultSettings` source (Rule #2); confirm the API for enumerating + upserting default settings.

### Story 17.2: `iris_production_item` — Add/Remove Items + Arbitrary Settings
**As an** integration engineer, **I want** to add and remove production config items and set any host/adapter setting, **so that** I can edit a production fully (today's tool only toggles/sets 6 fixed keys).
**Acceptance Criteria**:
- **AC 17.2.1** — Extend `iris_production_item` with `add` and `remove` actions (create/delete a config item in the production). New mutating actions default-disabled.
- **AC 17.2.2** — Generalize the `settings` object to accept **arbitrary host and adapter setting names** (not just the 6 current keys), validated against the item's host/adapter where feasible.
- **AC 17.2.3** — Backed by `Ens.Config.Production` (item insert/remove) + `Ens.Config.Item`/`Ens.Config.Setting`; production updated/recompiled after edit.
- **AC 17.2.4** — Backward compatible: existing `enable`/`disable`/`get`/`set` behavior unchanged; the 6 known keys still work.
- **AC 17.2.5** — Unit tests for add/remove + arbitrary-setting set + back-compat of existing keys + governance defaults.

**Implementation Notes**: Read `Ens.Config.Production`/`Ens.Config.Item` sources (Rule #2). Confirm production-update/recompile step.

### Story 17.3: `iris_sql_analyze` — SQL Analysis
**As a** developer, **I want** show-plan, runtime stats, index usage, and running statements, **so that** I can diagnose SQL performance via the agent.
**Acceptance Criteria**:
- **AC 17.3.1** — Tool in `@iris-mcp/dev`. Actions: `explain` (show plan), `stats` (runtime statistics), `indexUsage`, `running` (current statements). All read-only → enabled by default.
- **AC 17.3.2** — Backed by `$SYSTEM.SQL.Explain` / `%SQL.Statement` (plan), `%SYS.PTools.*` (runtime stats), SQL statement index for `running`. Determine Atelier/SQL-only vs new handler during impl (affects whether this contributes to the bootstrap bump).
- **AC 17.3.3** — Input: `action`, `query` (for explain), filter params, `server`, `namespace`. Output: plan/stats/index/running rows.
- **AC 17.3.4** — Unit tests covering each action.

**Implementation Notes**: Prefer Atelier SQL execution where possible (no handler/bootstrap). Probe `$SYSTEM.SQL.Explain` + PTools shape live (Rule #16).

### Story 17.4: BOOTSTRAP Bump + Live Verification + Documentation Rollup
**Acceptance Criteria**:
- **AC 17.4.1** — Single `BOOTSTRAP_VERSION` bump covering Epic-17 ObjectScript (interop default-settings + production-item; dev only if `sql_analyze` needs a handler); regenerate `bootstrap-classes.ts` (Rule #18).
- **AC 17.4.2** — Live-verify each tool/enhancement on HSCUSTOM with safe calls (Rule #16).
- **AC 17.4.3** — `iris-interop` + `iris-dev` READMEs + `tool_support.md` + `iris-mcp-all` + CHANGELOG updated; counts rolled up.
- **AC 17.4.4** — Deploy via glob-prefixed `iris_doc_load` (Rule #17).

### 4.4 sprint-status.yaml additions (applied on approval)

```yaml
  # Epic 14: Platform Foundation — Multi-Server Profiles & Tool Governance
  # Added 2026-06-15 via bmad-correct-course. See sprint-change-proposal-2026-06-15.md.
  # TypeScript-only (shared + all servers). No BOOTSTRAP_VERSION bump. Must land before Epics 15-17.
  epic-14: backlog
  14-1-multi-server-profiles-config-and-resolution: backlog
  14-2-server-parameter-across-all-tools: backlog
  14-3-governance-policy-model-and-cascade: backlog
  14-4-call-time-governance-enforcement: backlog
  14-5-governance-resource-and-capability: backlog
  14-6-documentation-rollup: backlog

  # Epic 15: Security & Admin Tools (iris-admin-mcp)
  # Added 2026-06-15 via bmad-correct-course. One BOOTSTRAP_VERSION bump at Story 15.6.
  epic-15: backlog
  15-1-iris-service-manage: backlog
  15-2-iris-ldap-manage: backlog
  15-3-iris-x509-manage: backlog
  15-4-iris-audit-manage: backlog
  15-5-resource-manage-sql-privileges: backlog
  15-6-bootstrap-bump-verification-and-docs: backlog

  # Epic 16: Operations Tools (iris-ops-mcp)
  # Added 2026-06-15 via bmad-correct-course. One BOOTSTRAP_VERSION bump at Story 16.4.
  epic-16: backlog
  16-1-iris-process-manage: backlog
  16-2-iris-database-action: backlog
  16-3-iris-backup-manage: backlog
  16-4-bootstrap-bump-verification-and-docs: backlog

  # Epic 17: Interop & Dev Tools (iris-interop-mcp + iris-dev-mcp)
  # Added 2026-06-15 via bmad-correct-course. One BOOTSTRAP_VERSION bump at Story 17.4.
  epic-17: backlog
  17-1-iris-default-settings-manage: backlog
  17-2-production-item-add-remove-and-settings: backlog
  17-3-iris-sql-analyze: backlog
  17-4-bootstrap-bump-verification-and-docs: backlog
```

---

## 5. Implementation Handoff

**Scope classification: Major** — new platform capability (multi-server + governance + `resources`) touching the shared core every server depends on, plus architect-level additions to 4 architecture sections.

**Routing:**
1. **Architect (Winston)** — confirm the Epic 14 shared-core design before dev: profile registry + per-profile session keying, governance cascade engine + call-time gate placement in the registration framework, and the new `resources` capability surface. This is the integration-risk concentration.
2. **Scrum Master (Bob)** — once Epic 14 design is confirmed, run epic-cycle: create stories from this proposal, sequence **Epic 14 first**, then 15/16/17 (independent; parallelizable).
3. **Dev (Amelia)** — implement per story; honor the project rules called out below.
4. **QA (Quinn/Murat)** — cross-server integration tests for profiles + governance (the highest-risk area).

**Sequencing & dependencies:**
- **Epic 14 is a hard prerequisite** for 15–17 (the `server` param + governance classification + gate must exist before tools are built on them).
- Epics 15, 16, 17 are mutually independent — any order, or parallel.
- **BOOTSTRAP_VERSION:** no bump in Epic 14; exactly one bump per tool epic (15.6, 16.4, 17.4). Never hand-edit `bootstrap-classes.ts` (Rule #18).

**Guardrails (project rules the dev/review agents must apply):**
- **Rule #2 / #16:** read each IRIS system class source (`irislib`/`irissys`) and/or live-probe before wrapping — especially `Backup.General` restore (16.3), `Security.LDAPConfigs` test (15.2), `%SYS.X509Credentials` import (15.3), `Ens.Config.DefaultSettings` (17.1), mount/dismount API (16.2).
- **Rule #3:** Config / SYS / Security class separation; `%SYS` namespace for Security.* and SYS.* operations.
- **Rule #7 / #8 / #9:** REST handler I/O + single-dispatch, error sanitization (strip prefixes, no double-wrap), don't swallow `%Status`.
- **Rule #17:** glob-prefixed `iris_doc_load` paths on deploy.
- **No breaking changes — additive only (hard constraint, all four epics including governance):** the suite has live users; every change MUST be strictly additive. With no `IRIS_PROFILES` / `IRIS_GOVERNANCE` set, behavior must be byte-for-byte identical to today (default profile = `IRIS_*` vars; governance default seed leaves **every** existing action enabled). New `server` params are optional; new tools and new write actions are opt-in. No existing tool name, parameter, default, output shape, or behavior may change. The two enhancement stories (15.5 `resource_manage`, 17.2 `production_item`) must preserve their existing surface exactly. Any breaking change is a defect and a release blocker.

**Success criteria:**
- All 16 new FRs (FR111–FR126) demonstrably satisfied.
- Existing single-server, ungoverned configs unaffected (regression-verified).
- New write actions default-disabled and rejected at call time unless explicitly enabled; read actions available by default.
- `iris-governance://{profile}` resource returns correct effective policy.
- Each tool live-verified on HSCUSTOM; full test suite green; 3 bootstrap bumps applied and regenerated, not hand-edited.

**Open items carried into implementation (non-blocking):**
- `iris_sql_analyze` Atelier-only vs handler-backed (17.3) — affects whether Epic 17 dev side contributes to the bump.
- `iris_backup_manage` restore path (16.3) — verify-first; defer if not cleanly scriptable.
- SQL-privilege placement (15.5) — extend `resource_manage` (recommended) vs new tool.
