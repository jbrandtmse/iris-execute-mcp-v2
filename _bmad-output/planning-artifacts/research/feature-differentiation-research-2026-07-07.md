---
title: "Feature Differentiation Research: IRIS MCP Server Suite"
type: "market + product research"
status: "complete"
created: "2026-07-07"
author: "Mary (Business Analyst)"
inputs:
  - "README.md (suite overview, 100 tools / 5 servers)"
  - "_bmad-output/planning-artifacts/product-brief-iris-execute-mcp-v2.md"
  - "_bmad-output/planning-artifacts/prd.md (incl. Post-MVP & Vision sections)"
  - "packages/*/README.md (per-server tool catalogs)"
  - "tool_support.md, CHANGELOG.md, documention/deferred-work.md"
  - "Perplexity research: IRIS MCP competitive landscape (2026-07-07)"
  - "Perplexity research: database/platform MCP server differentiators (2026-07-07)"
  - "Web research: intersystems-community/iris-agentic-dev"
---

# Feature Differentiation Research — IRIS MCP Server Suite

## Executive Summary

The IRIS MCP Server Suite is, today, the **broadest** AI-controllability surface for InterSystems IRIS on the market: 100 tools across 5 domain servers, multi-instance profiles, per-action governance, and self-bootstrapping installation. No competitor comes close on breadth. The competitive risk is **not** coverage — it is that breadth alone is invisible in a demo, while competitors are differentiating on *intelligence* (Postgres MCP Pro's index advisor), *packaged expertise* (iris-agentic-dev's ObjectScript skills), and *enterprise trust* (read-only modes, OAuth, observability).

This document reviews the current feature baseline, maps the competitive landscape, proposes **10 new feature ideas**, wargames each for value vs. risk, and delivers **implementation plans** for every idea — with a clear recommendation to pursue three quick wins (Composite Health Check, Governance Safety Presets, Skills & Prompts Pack) and three strategic differentiators (Environment Diff & Promotion, Message Resend/Replay, SQL Performance Advisor) first.

**Bottom line:** the suite should evolve from "the most tools" to "the most *trustworthy and opinionated* AI operator for IRIS." That's the position no competitor can quickly copy, because it builds on the profile + governance foundation only this suite has.

---

## 1. Current Feature Baseline (What We Have)

Condensed from the README, per-package READMEs, and `tool_support.md`:

| Server | Tools | Coverage highlights |
|---|---:|---|
| `@iris-mcp/dev` | 26 | Document CRUD/bulk load/export, compile, code search/index/macros, `.int` intermediate code, SQL execute + `iris_sql_analyze` (explain/stats/indexUsage/running), globals, ObjectScript execution, unit tests, LOC metrics |
| `@iris-mcp/admin` | 26 | Namespaces, databases, mappings, users/roles/resources (+SQL privileges), web apps, SSL/TLS, OAuth2, services, LDAP, X.509, audit management |
| `@iris-mcp/interop` | 21 | Production lifecycle (incl. `clean` recovery), items, System Default Settings, logs/queues/messages, **message-trace Mermaid diagrams**, credentials, lookups, rules, transform test, REST apps |
| `@iris-mcp/ops` | 20 | Prometheus metrics, alerts, jobs/locks/processes, journals, mirrors, audit query, DB integrity + maintenance actions, backups (run/freeze/thaw), license, ECP, tasks, config |
| `@iris-mcp/data` | 7 | DocDB CRUD + Mongo-style find, DeepSee MDX + cube build, REST API management |

**Platform capabilities (the moat):**
- **`IRIS_PROFILES`** — one server process targets many IRIS instances; per-call `server` selection; credentials never on the wire.
- **`IRIS_GOVERNANCE`** — per-action allow/deny policy with global + per-profile cascade; frozen 141-key baseline; new writes default-disabled; `defaultEnabled` escape hatch for recovery writes; governance MCP resource + `iris_server_profiles` discovery tool.
- **Self-bootstrap** — auto-deploys and self-heals the IRIS-side REST service; graceful privilege degradation.
- **MCP spec v2025-11-25** — structured content, annotations, resources, stdio + Streamable HTTP.

**Documented gaps / deferred items worth mining:** no backup *restore*; alerts limited to `reset`; task create lacks schedule properties; config get reads ~11 hardcoded properties; PRD Post-MVP lists OAuth for the MCP servers, WebSocket debug/terminal, tool usage analytics, FHIR/HealthShare server, CI/CD integration, mirror failover automation, embedded Python.

---

## 2. Competitive Landscape (What Others Have)

### Direct competitors (IRIS-specific MCP)

| Offering | Nature | Strengths | Gaps vs. this suite |
|---|---|---|---|
| **`intersystems-community/mcp-server-iris`** (CaretDev, Open Exchange) | Community MCP server | SQL query, production inspection/recovery, monitoring | Explicitly **no code editing**; no admin surface; single instance |
| **`intersystems-community/iris-agentic-dev`** | **Official-community**, single-binary MCP for VS Code Copilot & Claude Code | Zero-install binary; SQL, production mgmt, monitoring; **ObjectScript "skills"** (e.g., a 205-word `objectscript-review` checklist) that work with or without the server | Dev-centric; no admin/ops/data breadth; no multi-instance or governance |
| **InterSystems AI Hub** (2026, Early Access) | Framework/SDK for building custom MCP servers *inside* IRIS | Governed, auditable, production-grade positioning; official backing | **Not a product** — you build your own tools; no out-of-box coverage |
| **iris-mcp-atelier** | Community server | Atelier read/write code access | Narrow (code only) |

**Key insight #1:** InterSystems itself has entered the arena on two fronts — a *developer convenience* front (iris-agentic-dev) and an *enterprise governance* front (AI Hub). The suite sits between them and beats both on breadth, but iris-agentic-dev's **skills** are an adoption lever this suite lacks, and AI Hub's **"secure, auditable"** story targets exactly the enterprise trust axis where this suite's governance layer already leads — but doesn't yet *demonstrate* (no audit trail of tool calls).

### The broader database-MCP state of the art

From the 2025–2026 landscape (Postgres MCP Pro, Supabase, Neon, MongoDB, multi-DB toolboxes):

- **Table stakes now:** read-only/restricted safety modes (the #1 stated reason reviewers pick Postgres MCP Pro), query timeouts/row caps, schema introspection + sampling, OAuth with scoped access for remote deployment.
- **Winning differentiators:** performance intelligence (EXPLAIN analysis + **index advisors**), one-shot health-check diagnostics with a structured verdict, schema-aware context injection / semantic search, tool-call observability & session replay (rare, high enterprise value), workflow/skills packaging, environment branching & migration workflows.

**Key insight #2:** the market rewards *opinionated intelligence layered on top of primitives*, not more primitives. The suite has 100 primitives; competitors with 8 tools win reviews because one of those tools says "here's *why* your query is slow and *what index to add*."

**Key insight #3 (the healthcare angle):** IRIS's core market is healthcare integration. Nothing in the competitive set addresses the integration engineer's *complete* troubleshooting loop (find failed message → diagnose → **fix → resend**) or compliance-grade auditability of AI actions. These are open lanes.

---

## 3. The Ten Feature Ideas

| # | Idea | One-liner | Server home |
|---|---|---|---|
| 1 | **`iris_health_check` — Composite Health Diagnostic** | One call returns a structured verdict (healthy/warning/critical) across CPU, memory, DB freespace, journal, mirror, locks, queues, license, alerts — with per-finding explanations | ops |
| 2 | **SQL Performance Advisor** | Extend `iris_sql_analyze` with an `advise` action: interprets query plans, flags missing/unused indexes, stale TuneTable stats, and recommends concrete fixes with evidence | dev |
| 3 | **Environment Diff & Promotion (`iris_env_diff` / `iris_env_promote`)** | Compare code, mappings, System Default Settings, and config between two configured profiles (e.g., `stage` vs `prod`); generate and optionally execute a promotion plan | dev + shared |
| 4 | **Semantic Code & Schema Search (`iris_semantic_search`)** | Vector-embedded search over classes, methods, and schema using IRIS's own native VECTOR support — "where is patient address handled?" without knowing names | dev |
| 5 | **Agent Skills & MCP Prompts Pack** | Ship persona workflow skills (diagnose-slow-query, trace-message-flow, provision-environment, objectscript-review) as MCP prompts + installable Claude/Copilot skills | all (framework) |
| 6 | **Message Resend / Replay (`iris_message_resend`)** | Resend or edit-and-resend failed interoperability messages by header ID or filtered batch — completing the troubleshooting loop the SMP offers but no MCP server does | interop |
| 7 | **Tool-Call Observability & Session Audit** | Structured audit trail of every MCP tool call (who, what, which instance, duration, outcome) persisted to IRIS and/or OTel export; session replay for compliance | shared (framework) |
| 8 | **Governance Safety Presets & Resource Caps** | `IRIS_GOVERNANCE_PRESET=read-only\|standard\|admin` one-word safety modes + per-call SQL row caps/timeouts surfaced in policy | shared (framework) |
| 9 | **`@iris-mcp/health` — FHIR/HealthShare Server** | Sixth server: FHIR repository CRUD/search, capability statement, HL7v2↔FHIR transformation testing for IRIS for Health | new package |
| 10 | **Embedded Python Execution (`iris_python_execute`)** | Execute embedded Python in IRIS, list/verify importable libraries — opening ML/data-science workflows | dev |

---

## 4. The Wargame

**Method.** Each idea was stress-tested from four adversarial angles:
- **Red team (technical):** what IRIS API landmine, version gate, or integration failure kills it? (Informed by project Rules #2/#16 — IRIS API claims are guilty until probed.)
- **Red team (market):** what competitor countermove or adoption failure neutralizes it?
- **Blue team (value):** who wakes up wanting this, and does it show up in a 2-minute demo?
- **Safety/gov team:** does it create a destructive path, and can the existing governance layer contain it?

Scores: **Value** 1–5 (user impact × differentiation × market fit), **Risk** 1–5 (effort × API uncertainty × safety exposure × maintenance). Best = high value, low risk.

### Idea 1 — `iris_health_check` (Composite Health Diagnostic)

- **Blue team:** Chen's journey (PRD Journey 5) currently takes 6 tool calls to answer "is this instance healthy?" — this makes it one. Postgres MCP Pro proves health checks are a *purchase-deciding* feature. Perfect demo: "check the health of prod" → structured verdict in seconds. Also the natural first call for any AI diagnostic session, multiplying use of the other 19 ops tools.
- **Red team (technical):** almost everything needed is already probed by existing tools (metrics, mirror, journal, locks, license, alerts, DB freespace). Risk is threshold tuning ("92% journal full" — warning or critical?) producing false alarms. Mitigate with conservative defaults + configurable thresholds + always returning raw values alongside verdicts.
- **Red team (market):** trivially copyable in concept — but a copy without 20 ops tools underneath has nothing to compose. First-mover on IRIS wins the review sentence.
- **Safety:** pure read. Zero destructive surface. Governance: `mutates:"read"` (Rule #28), enabled by default.
- **Verdict:** **Value 4.5 / Risk 1.5 — QUICK WIN.** Highest value-per-effort in the set.

### Idea 2 — SQL Performance Advisor

- **Blue team:** the single most-praised differentiator in the entire DB-MCP market (Postgres MCP Pro's raison d'être). `iris_sql_analyze` already fetches plans, index usage, and stats — the primitives exist; the *interpretation* doesn't. "Why is this query slow?" is the #1 recurring DBA question, and IRIS query plans are notoriously opaque to non-experts.
- **Red team (technical):** IRIS has **no native index advisor** — recommendations must be heuristic (scan plan for full-table reads, cross-check `%SYS.PTools`/SQL runtime stats, flag un-tuned tables via TuneTable metadata). Heuristics can recommend wrong indexes. Mitigate: advisory-only output ("evidence + suggestion", never auto-apply), confidence labels, and reference-pinning tests against known plans (Rule #36 discipline). API shapes (`%SQL_Diag`, `%SYS.PTools`, TuneTable metadata) must be live-probed before spec (Rule #16).
- **Red team (market):** if InterSystems ships an official advisor in AI Hub, ours must still win on "works out of the box against any 2023.1+ instance."
- **Safety:** read-only analysis; the optional "apply recommendation" (create index) action is a write → default-disabled by governance.
- **Verdict:** **Value 4.5 / Risk 3 — STRATEGIC DIFFERENTIATOR.** The suite's "signature feature" candidate.

### Idea 3 — Environment Diff & Promotion

- **Blue team:** this is the idea *only this suite can build* — it requires multi-instance profiles, which no competitor has. Every IRIS shop runs dev→test→prod, and "what's different between stage and prod?" is answered today by manual export/compare or expensive tooling. Diff of classes (by hash/timestamp), mappings, System Default Settings, web apps, and config between two profiles is a demo that makes admins gasp. Promotion (generate ordered plan → execute with per-step confirmation) turns the suite into a deployment tool.
- **Red team (technical):** cross-instance comparison is TS-layer orchestration over existing endpoints (doc list + hashes exist via Atelier; settings/config via existing handlers) — moderate complexity, minimal new ObjectScript. Version skew between instances (different IRIS versions) can produce noisy diffs; mitigate by diffing *source* not compiled artifacts and normalizing timestamps. Promotion is the risk concentrate: a bad promotion is a production incident. Mitigate: plan/execute separation, dry-run default, per-step governance (`iris_env_promote:execute` default-disabled), and item-level allowlists.
- **Red team (market):** git-based CI/CD purists will say "use source control." True for code — but mappings, SDS, credentials metadata, and web apps live *outside* git in most IRIS shops. Position as "environment drift detection + guided promotion," complementary to git.
- **Safety:** diff is read. Promote is a write with blast radius → strictest governance treatment in the suite; leans on Rule #26-style live rejection smokes.
- **Verdict:** **Value 5 / Risk 3 — STRATEGIC DIFFERENTIATOR (moat-builder).** Highest absolute value; risk contained by shipping diff first, promote later.

### Idea 4 — Semantic Code & Schema Search

- **Blue team:** "find where patient addresses are validated" without knowing class names is genuinely magical in 20-year-old healthcare codebases, and dogfooding IRIS's native VECTOR search is a marketing two-fer ("we search IRIS *with* IRIS").
- **Red team (technical):** the heaviest landmine field in the set. Requires IRIS 2024.1+ (VECTOR type) — the suite promises 2023.1+, so it must degrade gracefully. Requires an embedding source: local model download (heavy), external API (credentials, privacy — a hard sell in healthcare), or IRIS embedded Python (adds Idea-10's dependency). Index freshness after compiles needs invalidation plumbing. Namespace-scale indexing hits the Rule #38 timeout wall — needs background/task-based index builds. Project memory itself records vector datatype mismatch pitfalls (SQL error -259).
- **Red team (market):** client-side embedding (Claude Code's own code search) partially covers this for *exported* code; the differentiator is server-side search over *live* namespaces without export. Real but narrower than it looks.
- **Safety:** read (index build is a write to a scratch global — contained).
- **Verdict:** **Value 3.5 / Risk 4 — DEFER.** Flashy, but three stacked dependencies (IRIS version, embedding source, index lifecycle) make it the most likely to slip. Revisit after Embedded Python (Idea 10) lands, which removes one dependency.

### Idea 5 — Agent Skills & MCP Prompts Pack

- **Blue team:** iris-agentic-dev's skills are its most-cited feature — proof that *packaged expertise* drives adoption independent of tool count. This suite has 38 codified project rules and deep ObjectScript knowledge (`.claude/rules/`) that could be distilled into shippable skills; plus 100 tools that beg for orchestration recipes ("diagnose slow query" = 4-tool workflow; "provision project environment" = 6-tool workflow; "trace and fix a stuck message" = 5-tool workflow). MCP `prompts` capability is already spec-supported by the framework's SDK — the suite advertises resources today but exposes zero prompts.
- **Red team (technical):** near-zero API risk — these are markdown/prompt artifacts plus MCP `prompts/list` plumbing in `server-base.ts`. The real risk is *quality drift*: stale skills that reference renamed tools. Mitigate with a CI check that validates tool names referenced in skills against the live catalog (the generated-artifact discipline of Rules #18/#20 applies directly).
- **Red team (market):** iris-agentic-dev iterates fast on skills. Counter: our skills orchestrate a 100-tool surface theirs can't reach (admin, ops, interop workflows are uncontested).
- **Safety:** none — advisory content only.
- **Verdict:** **Value 4 / Risk 1 — QUICK WIN.** Cheapest credible answer to the strongest competitor's best feature.

### Idea 6 — Message Resend / Replay

- **Blue team:** completes Raj's journey (PRD Journey 3). Today the suite can find, trace, and *diagram* a failed message — then sends the engineer to the SMP to resend it. Resend-by-header-ID and filtered batch resend ("resend all messages that errored on HospitalB.TCPService since 3 AM") is the highest-frequency interop *write* operation in real production support. No MCP competitor offers it. In IRIS's core healthcare-integration market, this is the feature that converts interop teams.
- **Red team (technical):** the resend API must be live-probed (Rule #16): the SMP path runs through `EnsPortal.MessageResend` UI plumbing; the underlying callable is in `Ens.MessageHeader` (resend/resubmit family) — exact method names and edit-resend semantics need a probe class before spec. Batch resend needs bounded scope (Rule #38: no unbounded "resend everything") and idempotency care (double-resend duplicates clinical data — real harm). Mitigate: mandatory bounded filters, per-call caps, dry-run count first, `confirm:true` double-gate for batches (the `killAppData` pattern from Epic 20).
- **Red team (market):** CaretDev's server does production *recovery* but not message resend; if they add it without governance, our per-profile policy ("resend allowed on test, blocked on prod") is the trust story they can't match.
- **Safety:** write, destructive-adjacent (duplication risk) → default-disabled per governance seed; possibly `defaultEnabled` NOT appropriate here (unlike `clean`, resend isn't a recovery-of-last-resort; it changes clinical data flow).
- **Verdict:** **Value 4.5 / Risk 2.5 — STRATEGIC DIFFERENTIATOR (core-market).** Ship with the strictest write discipline in the interop server.

### Idea 7 — Tool-Call Observability & Session Audit

- **Blue team:** already on the PRD's own Post-MVP list ("tool usage analytics and audit logging"), and the market research flags observability/session replay as "extremely high value, rare in the market." For healthcare compliance ("what did the AI do to prod last Tuesday?"), an auditable trail of every MCP call — tool, action, profile, namespace, duration, outcome, governance decision — is the difference between a toy and a deployable system. It also *demonstrates* the governance layer: blocked calls become visible evidence of policy working. AI Hub markets "auditable" as its headline; this feature neutralizes that pitch.
- **Red team (technical):** TS-layer interception in `server-base.ts` `handleToolCall` (single choke point already exists — the governance gate lives there). Sink options: JSONL file (zero-dependency), IRIS global via existing REST (dogfooding, but adds write traffic to the monitored instance), OTel export (enterprise-friendly). Risks: log volume, secrets in parameters (must reuse the `SanitizeError`/redaction discipline — never log password fields), and performance overhead (async fire-and-forget writes). All manageable.
- **Red team (market):** MCP clients are adding their own logging. Counter: client logs don't know the *IRIS-side* context (profile, namespace, governance verdict) — server-side audit is complementary and compliance-ownable.
- **Safety:** additive; must itself be governable (an operator may *require* audit-on — consider a config flag rather than a tool).
- **Verdict:** **Value 4 / Risk 2 — HIGH-VALUE, SECOND WAVE.** Enterprise trust multiplier; pairs naturally with Idea 8.

### Idea 8 — Governance Safety Presets & Resource Caps

- **Blue team:** read-only-by-default is *the* stated reason reviewers choose Postgres MCP Pro; the suite's governance can express it today but only via hand-written JSON policy over 141+ keys. `IRIS_GOVERNANCE_PRESET=read-only` (one word: every write blocked, every read allowed) collapses the trust decision to a checkbox. Add `standard` (reads + non-destructive writes) and per-preset row caps/timeouts on `iris_sql_execute`, and the suite matches the market's #1 table-stakes demand with ~days of work. Also makes a killer README line: "point it at prod in read-only mode."
- **Red team (technical):** presets are seed-layer composition in `governance.ts` — the `mutates` classification already labels every action read/write, so a preset is a derived policy map. Landmine: pre-governance baseline actions aren't all classified read/write individually (the frozen 141-key baseline grandfathers them) — building `read-only` requires a one-time classification sweep of baseline actions. That sweep must NOT touch the frozen baseline file (Rule #23) — it's a new parallel map. Explicit `IRIS_GOVERNANCE` keys must still override the preset (cascade extension: explicit > preset > seed).
- **Red team (market):** none — absence is the risk.
- **Safety:** strictly safety-increasing.
- **Verdict:** **Value 4 / Risk 1.5 — QUICK WIN (trust table stakes).**

### Idea 9 — `@iris-mcp/health` (FHIR/HealthShare Server)

- **Blue team:** IRIS's dominant vertical is healthcare; a FHIR-native MCP server (resource CRUD/search, capability discovery, HL7v2↔FHIR transform testing) targets the single largest IRIS user population and is already the PRD's named Vision item. Nothing in the MCP ecosystem serves FHIR-on-IRIS.
- **Red team (technical):** biggest scope in the set — a sixth package, and the target platform forks (IRIS for Health vs. plain IRIS: must detect and degrade). FHIR server APIs (`HS.FHIRServer.*`) are a large, versioned surface requiring extensive Rule #16 probing; test environments need FHIR repos provisioned; PHI handling raises the safety bar on every tool. Realistic scope: multiple epics.
- **Red team (market):** InterSystems could ship official FHIR MCP tooling — this is the lane they're most likely to claim themselves (health is their revenue core). A community suite still wins on cross-server integration (dev+interop+health in one AI session).
- **Safety:** read tools fine; writes touch clinical data — strictest governance.
- **Verdict:** **Value 5 (for the segment) / Risk 4.5 — STRATEGIC BET, NOT A QUICK WIN.** Keep on the vision roadmap; start with a read-only MVP (search/read/capability) to cap risk. Not among the "lowest-risk/highest-value" winners.

### Idea 10 — Embedded Python Execution

- **Blue team:** already a PRD Vision item; opens ML/data-science workflows and is a prerequisite-remover for Idea 4 (embeddings). Modest, well-understood surface: execute Python code, list importable modules, report Python availability.
- **Red team (technical):** project rules already document the landmines (`%SYS.Python` availability detection is quirky — `GetPythonVersion()` only reports *loaded* Python). Python execution is arbitrary code execution — but so is `iris_execute_command`, so it adds no *new* class of risk; same governance treatment. Environments without embedded Python configured (common) need crisp degradation.
- **Red team (market):** iris-agentic-dev could add this easily; low moat. Value is enabling, not differentiating.
- **Safety:** write/execute → default-disabled.
- **Verdict:** **Value 3 / Risk 2.5 — WORTHWHILE FILLER.** Do when a story slot opens; not a headline.

---

## 5. Wargame Results — Rankings

| Rank | Idea | Value | Risk | Value−Risk posture | Classification |
|---:|---|:--:|:--:|---|---|
| 1 | **#1 Composite Health Check** | 4.5 | 1.5 | Best ratio in set | 🟢 Quick win |
| 2 | **#8 Governance Safety Presets** | 4.0 | 1.5 | Table-stakes trust, near-free | 🟢 Quick win |
| 3 | **#5 Skills & Prompts Pack** | 4.0 | 1.0 | Cheapest counter to top competitor | 🟢 Quick win |
| 4 | **#6 Message Resend/Replay** | 4.5 | 2.5 | Core-market conversion feature | 🔵 Strategic differentiator |
| 5 | **#3 Environment Diff & Promotion** | 5.0 | 3.0 | Only-we-can-build-it moat | 🔵 Strategic differentiator |
| 6 | **#2 SQL Performance Advisor** | 4.5 | 3.0 | Market-proven signature feature | 🔵 Strategic differentiator |
| 7 | **#7 Observability & Session Audit** | 4.0 | 2.0 | Enterprise trust multiplier | 🔵 Second wave |
| 8 | **#10 Embedded Python** | 3.0 | 2.5 | Enabler, not headline | ⚪ Opportunistic |
| 9 | **#4 Semantic Search** | 3.5 | 4.0 | Dependency stack too tall today | ⚪ Defer (revisit post-#10) |
| 10 | **#9 FHIR/Health Server** | 5.0* | 4.5 | Right idea, wrong sizing for "low risk" | 🟣 Strategic bet (separate initiative) |

\* segment-specific value

**Recommended sequencing (three epics' worth):**
1. **Epic A — "Trust & Triage" (quick wins):** Ideas #1 + #8 + #5. One epic, mostly TS-layer, immediately demo-able, directly answers the market's top table-stakes demands and the top competitor's best feature.
2. **Epic B — "Close the Loop" (interop core market):** Idea #6. Single-story-sized after probing; highest healthcare-market payoff per line of code.
3. **Epic C — "Only IRIS-MCP Can Do This":** Idea #3 (diff first, promote second) — the moat feature. Idea #2 can run as a parallel epic (dev-server-only, independent).
4. **Second wave:** #7, then #10, then reassess #4 and #9.

**Positioning after Epics A–C:** *"The only IRIS MCP suite with one-command health verdicts, one-word read-only safety, packaged expert workflows, message resend with per-environment policy, and cross-environment drift detection."* Every clause is uncopyable without first rebuilding the profile/governance foundation.

---

## 6. Implementation Plans

Plans follow project conventions: TS in the monorepo (`packages/*`, shared framework in `@iris-mcp/shared`), ObjectScript handlers under `src/ExecuteMCPv2/REST/*` (bootstrap regen + `BOOTSTRAP_VERSION` bump per ObjectScript story — Rule #24), governance classification mandatory for every new key (Rule #28, frozen baseline untouched per Rule #23), live-probe before spec for every asserted IRIS API (Rule #16), live-endpoint smokes incl. rejection paths for guarded writes (Rule #26), scope filters + timeout documentation for enumeration-heavy tools (Rule #38).

### Plan 1 — `iris_health_check` (ops) — 🟢 Rank 1

**Scope.** New read tool on `@iris-mcp/ops`: single call returns `{verdict: "healthy"|"warning"|"critical", findings: [{area, level, value, threshold, explanation}], raw: {...}}` across ~10 areas: CPU/memory (SYS.Stats), global buffer efficiency, DB freespace per database, journal space/status, mirror state, lock table pressure, queued interop alerts, license consumption, ECP state, recent severity-2+ alerts.

**Architecture.** One new ObjectScript composite endpoint (`/ops/health`) in `Monitor.cls` (or a new `Health.cls`) that gathers all probes server-side in a single round-trip — reusing the exact system-class calls the existing per-area handlers already make (Rule #5 discipline: instance-wide `SYS.Stats.*`, never `$ZU` per-process). TS tool maps thresholds → verdict; thresholds overridable via tool params (`thresholds: {journalPctWarn: 80, ...}`).

**Stories.**
1. Probe + threshold research: enumerate probe APIs from existing handlers; define default thresholds cross-checked against Management Portal dashboard semantics (live probe, Rule #16). (~0.5 story)
2. ObjectScript `/ops/health` handler + unit tests + bootstrap regen. (1 story)
3. TS tool + verdict logic + README/`tool_support.md` rollup (state read/default-enabled, Rule #30). Lead smoke: live call against HSCUSTOM **and a second namespace/instance** (Rule #34); degrade-gracefully test against a namespace without interop. (1 story)

**Governance.** `mutates:"read"`, enabled by default.
**Effort.** ~1 epic-lite (2–3 stories). **Dependencies.** None.
**Success metric.** "Is prod healthy?" answered in one tool call; verdict areas ≥ 9; false-critical rate ~0 on healthy dev instance.

### Plan 2 — Governance Safety Presets & Resource Caps (shared) — 🟢 Rank 2

**Scope.** `IRIS_GOVERNANCE_PRESET` env var: `read-only` (every write-classified action + all baseline writes blocked), `standard` (reads + non-destructive writes), `full` (today's default). Cascade: explicit `IRIS_GOVERNANCE` key > preset > default seed. Plus per-preset caps surfaced to `iris_sql_execute` (max rows, timeout) and documented in `iris_server_profiles` output.

**Architecture.** Pure TS in `@iris-mcp/shared` `governance.ts`: (a) one-time classification sweep producing a **new generated artifact** `baseline-classifications.ts` (read/write per frozen-baseline key — generated per Rule #20 with `--check` mode per Rule #25; the frozen `governance-baseline.ts` itself is never touched, Rule #23); (b) preset = derived policy map injected between explicit and seed layers; (c) `iris_server_profiles` reports active preset.

**Stories.**
1. Classification sweep generator + artifact + drift test (one-directional, Rule #23 shape). (1 story)
2. Preset layer in cascade + back-compat capstone: no preset ⇒ byte-for-byte current behavior (Rule #19 mechanical proof); `read-only` capstone: every write key blocked on a constructed server, every read enabled. (1 story)
3. SQL caps + docs rollup across README/client-config guides (the "point it at prod read-only" story). Lead smoke: built dist in real process (Rule #22), live governance rejection of a write under preset (Rule #26). (1 story)

**Governance.** Framework change; no new tool keys (except possibly none).
**Effort.** ~3 stories. **Dependencies.** None.
**Success metric.** One-line env config yields provable read-only mode; zero back-compat drift.

### Plan 3 — Agent Skills & MCP Prompts Pack (framework + repo artifacts) — 🟢 Rank 3

**Scope.** (a) MCP `prompts` capability on all 5 servers: 6–10 workflow prompts (`diagnose-slow-query`, `check-system-health`, `trace-message-flow`, `resend-failed-messages` [after Plan 4], `provision-project-environment`, `audit-security-posture`, `objectscript-review`, `deploy-and-test-class`). Each prompt = parameterized instruction sequence naming the exact tools and order, with safety notes. (b) Installable skills directory (`skills/`) in the repo mirroring the same content for Claude Code/Copilot skill loaders, à la iris-agentic-dev.

**Architecture.** `server-base.ts` gains `prompts/list` + `prompts/get` (SDK-supported); prompt definitions live per-package (`packages/*/src/prompts/`) + shared ones in the framework. A CI validation script cross-checks every tool name referenced in prompts/skills against the live tool catalog (generated-artifact discipline, Rules #18/#20) so renames can't silently rot the pack.

**Stories.**
1. Framework `prompts` plumbing + capability advertisement + count/docs updates (framework-tool counting rules, Rule #31 analog). (1 story)
2. Author prompt/skill content — distill from `.claude/rules/` ObjectScript knowledge + PRD journeys; validation script. (1 story)
3. Docs rollup + per-client "using skills" guide. Lead smoke: live `prompts/get` through a real MCP client; one full workflow executed end-to-end. (0.5–1 story)

**Governance.** Prompts are not tools; no keys. `prompts` capability is additive (back-compat gate per Rule #19).
**Effort.** ~3 stories. **Dependencies.** None (one prompt gated on Plan 4).
**Success metric.** A fresh Claude session completes "diagnose slow query" via the packaged prompt with zero user tool-coaching.

### Plan 4 — `iris_message_resend` (interop) — 🔵 Rank 4

**Scope.** New interop tool, actions: `resend` (by header ID list, ≤ N per call), `resendFiltered` (bounded filter: item + status + time window, with mandatory `dryRun` count first and `confirm:true` gate), `preview` (show message body/target before resend). Explicit non-goal in v1: edit-and-resend (follow-up).

**Architecture.** New branch in `Interop.cls` (or `MessageResend.cls`). **Story 0 is a mandatory probe** (Rule #16): disposable `ExecuteMCPv2.Temp` class exercising the `Ens.MessageHeader` resend/resubmit family against a live production to pin exact method names, target-queue semantics, and new-header linkage (the SMP's `EnsPortal.MessageResend` source in `irislib/` is the map). Batch path enumerates bounded header sets via existing message-query SQL (reusing `iris_production_messages` filter plumbing); hard cap per call (e.g., 500) + Rule #38 scope discipline.

**Stories.**
1. Story 0: API probe + spec amendment with pinned signatures. (0.5)
2. ObjectScript handler: single + batch resend, dry-run, caps, delimiter/input guards (Rule #29), sanitized errors (Rules #8/#33). Bootstrap bump. (1)
3. TS tool + governance wiring + tests. (1)
4. Docs + lead smoke: live resend of a disposable test message on a scratch production; **live rejection smokes** — unbounded filter refused, over-cap refused, missing `confirm` refused (Rule #26); second-namespace smoke (Rule #34). (1)

**Governance.** All resend actions `mutates:"write"` → **default-disabled** (deliberate: unlike `clean`, resend duplicates data flow; not a `defaultEnabled` candidate). `preview`/`dryRun` = read, enabled.
**Effort.** ~4 stories (1 epic). **Dependencies.** None.
**Success metric.** Raj's full loop — find, diagnose, fix, resend, verify — completes in one AI session; duplicate-resend guarded by confirm + caps.

### Plan 5 — Environment Diff & Promotion (dev + shared) — 🔵 Rank 5

**Scope.** Phase 1 `iris_env_diff`: compare two profiles across (a) documents in scoped packages (name, timestamp, content hash), (b) namespace mappings, (c) System Default Settings, (d) web apps, (e) selected config keys. Output: structured drift report (`onlyInA`, `onlyInB`, `differs` with detail). Phase 2 `iris_env_promote`: `plan` (ordered steps from a diff, read) and `execute` (per-step, itemized allowlist, `confirm:true`, write).

**Architecture.** Predominantly TS orchestration in `@iris-mcp/dev` using the profile-aware client (the D2 `server` param already lets one process query both instances). Content hashing may need a small ObjectScript helper endpoint (hash-per-document server-side to avoid bulk export — Rule #38: require package `spec`, document timeout risk for wide scopes). Promotion executes via existing tools' code paths (doc put/compile, mapping manage, SDS set) — reuse, don't reimplement.

**Stories.**
1. Diff engine: documents (scoped, hash-based) + report shape + cross-version normalization rules. Includes ObjectScript hash endpoint probe/impl. (1–1.5)
2. Diff coverage: mappings, SDS, web apps, config. (1)
3. `promote:plan` generator (read-only, ordered, dependency-aware: databases→mappings→docs→compile→SDS). (1)
4. `promote:execute` with per-step results, halt-on-error, itemized allowlist + confirm; governance default-disabled; rejection smokes (Rule #26). (1)
5. Docs + capstone: full stage→scratch promotion round-trip on live instances; back-compat capstone (no profiles configured ⇒ tool errors cleanly, everything else untouched — Rule #19). (1)

**Governance.** `iris_env_diff`, `promote:plan` = read/enabled; `promote:execute` = write/**default-disabled**.
**Effort.** ~5 stories (1 full epic; Phase 1 alone = 2–3 stories and already demo-able). **Dependencies.** Materially better with ≥2 live IRIS instances in the test environment (also satisfies Rule #34 naturally).
**Success metric.** Drift between two instances detected in one call; promotion plan executes a class+mapping+SDS change set with per-step audit.

### Plan 6 — SQL Performance Advisor (dev) — 🔵 Rank 6

**Scope.** New `advise` action on `iris_sql_analyze`: input = query (or "top N recent slow statements"); output = findings with evidence and confidence (`missing-index` [column(s), suggested index DDL], `stale-stats` [TuneTable age], `unused-index`, `full-scan`, `plan-anomaly`) — advisory-only. Optional follow-up action `applyIndex` (write, default-disabled).

**Architecture.** ObjectScript analysis in `SqlAnalyze` handler territory: parse `EXPLAIN` output (already retrieved), join SQL runtime statistics / `%SYS.PTools` where available, read TuneTable metadata (`%Dictionary`/extent stats). **Story 0 probe** (Rules #14/#16): pin exactly which statistics surfaces exist on 2023.1+ Community vs. licensed, and what plan-text markers reliably indicate full scans. Heuristics must be **reference-pinned** (Rule #36): fixture queries with known-correct advice, expected values captured from live plan output, not reasoned.

**Stories.**
1. Story 0: statistics/plan-marker probe matrix across available surfaces; heuristic spec. (1)
2. Plan-interpretation engine + `missing-index`/`full-scan` findings + fixtures. (1)
3. Stats findings (`stale-stats`, `unused-index` — builds on existing `indexUsage`) + confidence model. (1)
4. TS surface + docs (advisory disclaimer; Rule #30 default-state callout) + lead smoke on live slow query incl. second namespace (Rule #34). `applyIndex` deferred to a follow-up story/epic. (1)

**Governance.** `advise` = read/enabled; `applyIndex` (if/when) = write/default-disabled.
**Effort.** ~4 stories. **Dependencies.** None; benefits from populated namespaces for realistic plans.
**Success metric.** On a seeded slow-query fixture set, advisor flags the known missing index with correct DDL ≥ 90% of cases; zero recommendations without cited evidence.

### Plan 7 — Tool-Call Observability & Session Audit (shared) — 🔵 Second wave

**Scope.** Opt-in via `IRIS_AUDIT_LOG` (path or `iris://` sink): every tool call logged as structured JSONL — timestamp, session ID, tool, action, profile, namespace, duration, outcome (ok/error/`GOVERNANCE_DISABLED`), redacted-param digest. Companion read tool `iris_audit_sessions` (query/replay a session's call sequence). Optional OTel span export later.

**Architecture.** Interceptor at the existing single choke point (`server-base.ts handleToolCall`, where the governance gate already sits). Redaction reuses the field-name deny-list discipline (never log `password`/credential fields — Rule #9's redaction lesson). Async buffered writes; JSONL file sink first (zero deps), IRIS-global sink second (write to a *designated* audit instance, not necessarily the monitored one). Rotation/size caps.

**Stories.** 1) Interceptor + JSONL sink + redaction + back-compat proof (unset ⇒ zero behavior change, Rule #19). 2) `iris_audit_sessions` read tool + docs. 3) IRIS sink + optional OTel. (~3 stories)
**Governance.** Logging is config, not a tool (not bypassable via policy); `iris_audit_sessions` = read/enabled.
**Success metric.** A full AI session reconstructable from the log with zero secrets present; governance denials visible as auditable events.

### Plan 8 — Embedded Python Execution (dev) — ⚪ Opportunistic

**Scope.** `iris_python_execute` (run code, capture stdout/result), `iris_python_env` (availability, version, importable-module check). **Architecture.** ObjectScript handler using `%SYS.Python` with the project's documented detection quirk handled (import-then-`GetPythonVersion`, per `.claude/rules/`); same I/O-redirect + single-render discipline as `iris_execute_command` (Rule #7). **Stories.** 1) Probe + handler + bootstrap bump. 2) TS tool + governance + docs + smoke incl. Python-absent degradation. (~2 stories)
**Governance.** `execute` = write/**default-disabled**; `env` = read/enabled.
**Success metric.** numpy round-trip on a Python-enabled instance; crisp actionable error on a Python-less one.

### Plan 9 — Semantic Code & Schema Search (dev) — ⚪ Deferred

**Scope (when revisited).** `iris_semantic_index` (build/refresh embeddings for a scoped package — background task, Rule #38 scope discipline) + `iris_semantic_search` (query). **Architecture.** IRIS 2024.1+ VECTOR + `%Library.Embedding` (project memory: match embedding datatypes exactly — SQL -259 lesson); embeddings via embedded Python (hence sequenced after Plan 8); version-gate detection with graceful "requires 2024.1+" errors. **Prerequisites to un-defer:** Plan 8 shipped; a supported local embedding path validated; index-invalidation-on-compile design. (~1.5 epics when taken up.)

### Plan 10 — `@iris-mcp/health` FHIR Server — 🟣 Strategic bet (separate initiative)

**Scope (Phase 1, read-only MVP).** Sixth package: `iris_fhir_capability` (metadata/capability statement), `iris_fhir_search`, `iris_fhir_read` (+`vread`/`history`), `iris_fhir_endpoints` (discover configured FHIR endpoints). Writes (create/update/transaction) and HL7v2↔FHIR transform testing = Phase 2. **Architecture.** TS-first against the FHIR REST endpoints (standard HTTP — fits the web-port-only architecture perfectly); endpoint discovery via a small ObjectScript probe of `HS.FHIRServer` config (Rule #16 probe epic first); hard platform detection (IRIS for Health vs. plain IRIS) with graceful absence. PHI: default row caps, no response caching, audit-log integration (Plan 7 synergy). **Sizing.** Probe epic + read-MVP epic + write epic ≈ 3 epics. **Go/no-go trigger:** revisit after Epics A–C ship and if InterSystems' AI Hub roadmap hasn't claimed the lane.

---

## 7. Sources

**Repository:** [README.md](../../../README.md) · [product brief](../product-brief-iris-execute-mcp-v2.md) · [PRD (Post-MVP & Vision)](../prd.md) · per-package READMEs · `tool_support.md` · `CHANGELOG.md` · `documention/deferred-work.md` · `.claude/rules/project-rules.md`

**Competitive (retrieved 2026-07-07):**
- [intersystems-community/iris-agentic-dev](https://github.com/intersystems-community/iris-agentic-dev) — official-community single-binary MCP with ObjectScript skills
- [mcp-server-iris on Open Exchange](https://openexchange.intersystems.com/package/mcp-server-iris) · [CaretDev IRIS MCP (PulseMCP)](https://www.pulsemcp.com/servers/caretdev-iris)
- [InterSystems AI Hub Part 2: Custom MCP Servers](https://community.intersystems.com/post/introduction-ai-hub-part-2-custom-mcp-servers) · [MCP with IRIS: Zero to Hero](https://community.intersystems.com/post/model-context-protocol-mcp-intersystems-iris-zero-hero) · [Hey chat, what's up with my Interoperability](https://community.intersystems.com/post/hey-chat-whats-my-interoperability) · [AI-Powered System Management with IRIS Agent](https://community.intersystems.com/post/ai-powered-system-management-iris-agent)

**Market (retrieved 2026-07-07):**
- [Best MCP servers for databases (Dupple)](https://dupple.com/learn/best-mcp-servers-databases) — Postgres MCP Pro index tuning/health checks/restricted mode
- [Taskade: MCP servers review](https://www.taskade.com/blog/mcp-servers) — read-only defaults, timeout criticisms
- [InfoWorld: 10 MCP servers for databases](https://www.infoworld.com/article/4181843/10-mcp-servers-to-connect-llms-with-databases.html) · [DBVis: Best MCP servers 2025](https://www.dbvis.com/thetable/best-mcp-servers-for-database-management-of-2025/)
- [MCP ecosystem H1 2026 retrospective](https://www.digitalapplied.com/blog/mcp-ecosystem-h1-2026-retrospective-adoption-data-points) — OAuth/scoping as table stakes
- [K2view: Awesome MCP servers](https://www.k2view.com/blog/awesome-mcp-servers) — Supabase contextual-data streaming
