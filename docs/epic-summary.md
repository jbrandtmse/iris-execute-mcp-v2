# IRIS MCP Server Suite — Epic History (Epics 1–30)

What each of the 30 development epics built, grouped into the three phases the project moved through. The suite today is **104 tools across 5 servers** (109 advertised with the framework `iris_server_profiles` tool), all merged to `main`.

Authoritative per-epic detail lives in [`_bmad-output/planning-artifacts/epics.md`](../_bmad-output/planning-artifacts/epics.md); release notes are in [`CHANGELOG.md`](../CHANGELOG.md).

---

## Phase 1 — Foundation: the five servers (Epics 1–9)

1. **Shared Infrastructure & Developer Connection** — the monorepo scaffold and the reusable core every server sits on: HTTP client, authentication, connection health + Atelier version negotiation, and the `McpServerBase` tool-registration framework.
2. **IRIS Development Tools (`iris-dev-mcp`)** — ObjectScript document CRUD, compilation with error feedback, code search, macros, SQL, and server/namespace info — all over the Atelier REST API.
3. **Custom REST Service, Auto-Bootstrap & Execution** — the IRIS-side `ExecuteMCPv2` REST dispatch that auto-deploys itself on first connect, enabling globals, command execution, class-method calls, and unit-test runs.
4. **IRIS Administration (`iris-admin-mcp`)** — provision whole environments: namespaces, databases, users, roles, resources, web apps, SSL, OAuth2 — no Management Portal needed.
5. **Interoperability Management (`iris-interop-mcp`)** — create/control/monitor/debug Ensemble productions, plus credentials, lookup tables, rules, transforms, REST APIs.
6. **Operations & Monitoring (`iris-ops-mcp`)** — system health, scheduled tasks, jobs/locks/journals/mirrors, audit queries, license/ECP status, config.
7. **Data & Analytics (`iris-data-mcp`)** — DocDB document databases, DeepSee/MDX analytics on cubes, REST API management.
8. **Documentation & Release Preparation** — suite README, per-package tool references, v1→v2 migration guide, MCP client-config examples.
9. **Tool Name Flattening** — renamed all ~85 tools from `iris.domain.verb` to `iris_domain_verb` (the Anthropic Messages API rejects dots, which broke Claude Desktop) + a regression guard so the pattern can't return.

## Phase 2 — Stabilization & platform foundation (Epics 10–18)

10. **Namespace Browsing & Bulk Export** — survey a namespace at package granularity and pull code to disk in bulk (`iris_package_list`, `iris_doc_export`).
11. **Post-Publish Bug Fix Batch** — fixed 16 defects from the 2026-04-21 test pass before first npm publish.
12. **Post-Epic-11 Bug Fixes & Gap Closure** — 8 bugs + 9 feature gaps, plus the new `iris_alerts_manage` tool.
13. **Macro-Expanded Routine Lookup** — `iris_routine_intermediate`: resolve a class to its compiled-intermediate (macro-expanded) form that error traces reference.
14. **Platform Foundation — Multi-Server Profiles & Tool Governance** — the big cross-cutting one: address multiple IRIS instances via named `IRIS_PROFILES`, and govern tool availability per-action via `IRIS_GOVERNANCE` — all strictly back-compatible.
15. **Security & Admin Tools** — service toggling, LDAP, X.509 certs, audit management, SQL privileges (all writes default-disabled under governance).
16. **Operations Tools** — the ops control-plane: process control, database actions, backups.
17. **Interop & Dev Tools** — System Default Settings, deeper production-item editing, and SQL analysis.
18. **Deferred-Work Cleanup & Hardening** — triage/resolve the accumulated deferred items from Epics 16–17 (a single cleanup story, no new tools).

## Phase 3 — Feature differentiation (Epics 19–30)

19. **Server & Governance Discovery** — `iris_server_profiles`: a callable, discover-first way to learn which profiles and what governance policy are in effect (no guessing from config files).
20. **Production Recovery / Clean** — a guarded `clean` action on `iris_production_control` to recover a production wedged in a non-running bad state.
21. **Message Trace Sequence Diagram** — `iris_message_diagram`: turn an interop message trace into a rendered Mermaid sequence diagram (sync/async arrows, error flags, loop compression).
22. **ObjectScript LOC Counter** — `iris_loc_count`: namespace lines-of-code metrics (blank/source/comment/test buckets + top-N) — plus a deferred-work ledger burn-down.
23. **Composite Health Check** — `iris_health_check`: one call → `healthy`/`warning`/`critical` verdict with per-area findings, collapsing the 6+-call diagnostic dance.
24. **Governance Safety Presets & SQL Caps** — `IRIS_GOVERNANCE_PRESET=read-only` (block every write suite-wide in one word) + `IRIS_SQL_MAX_ROWS`/`IRIS_SQL_TIMEOUT`. *"Point it at production in read-only mode with one environment variable."*
25. **MCP Prompts Capability & Agent Skills Pack** — protocol-discoverable parameterized workflow `prompts` on all 5 servers + a generated installable `skills/` directory (teaching clients the *sequences*, not just tools).
26. **Interop Message Resend / Replay** — `iris_message_resend`: complete the interop loop (find → diagnose → diagram → resend) with the strictest write discipline in the suite (duplication hazard, preview-before-execute, double-gated).
27. **Environment Diff & Promotion** — `iris_env_diff` / `iris_env_promote`: the "moat" feature — compare two profiles (e.g. stage vs prod) across code *and* the config surfaces that live outside git (mappings, System Default Settings, web apps, config), then generate a gated, no-deletions promotion plan.
28. **SQL Performance Advisor** — a new `advise` action on `iris_sql_analyze`: "why is this query slow and what do I do?" with evidence-cited, confidence-labeled findings. Strictly advisory — recommends, never applies.
29. **Tool-Call Observability & Session Audit Log** — `IRIS_AUDIT_LOG`: opt-in, secrets-free JSONL trail of every tool call across all 5 servers (governance denials become auditable events); server-side config an AI client can't switch off.
30. **Tool Visibility Presets & Per-Tool Enable/Disable** — `IRIS_TOOLS_PRESET` (`full`/`core`/`developer`) + `IRIS_TOOLS_DISABLE`/`IRIS_TOOLS_ENABLE`: an advertise-time layer that trims each server back inside the 5–15-tool window for small models (dev `core` = ~67% fewer `tools/list` tokens), while default `full` stays byte-for-byte unchanged.

---

**The arc:** Epics 1–9 built the five-server foundation; 10–18 stabilized it and added the multi-profile + governance platform; 19–30 layered on the differentiating capabilities (discovery, recovery, diagrams, health, read-only mode, prompts, resend, env promotion, SQL advice, audit, visibility).
