# Sprint Change Proposal — 2026-07-07

**Trigger:** Stakeholder directive to implement **Features 1–7** from the feature-differentiation research
([research/feature-differentiation-research-2026-07-07.md](./research/feature-differentiation-research-2026-07-07.md))
using the implementation-ready specs in
[research/feature-specs/](./research/feature-specs/) (specs **01–07**).
**Mode:** Batch (unattended session; directive pre-authorizes creation of the course correction).
**Prepared by:** Scrum Master (bmad-correct-course workflow)
**Change scope classification:** **Moderate** — backlog reorganization (7 new epics appended); no in-flight work disrupted; no rollback; MVP unaffected.

---

## Section 1: Issue Summary

This is not a defect — it is a **planned strategic scope addition**. The 2026-07-07 feature-differentiation
research (market + competitive wargame, 10 ideas scored for value vs. risk) concluded the suite should evolve
from "the most tools" (100 across 5 servers) to "the most *trustworthy and opinionated* AI operator for IRIS."
The stakeholder reviewed the research and its 10 accompanying implementation-ready specs and directed:
**implement Features 1–7** (specs 01–07, the recommended build order):

| # | Feature | Spec | Server home | Wargame verdict |
|---|---------|------|-------------|-----------------|
| 1 | `iris_health_check` composite health diagnostic | [01](./research/feature-specs/01-health-check.md) | ops | 🟢 Quick win (rank 1) |
| 2 | `IRIS_GOVERNANCE_PRESET` safety presets + SQL caps | [02](./research/feature-specs/02-governance-presets.md) | shared | 🟢 Quick win (rank 2) |
| 3 | MCP prompts capability + agent skills pack | [03](./research/feature-specs/03-skills-prompts-pack.md) | shared + all | 🟢 Quick win (rank 3) |
| 4 | `iris_message_resend` resend/replay | [04](./research/feature-specs/04-message-resend.md) | interop | 🔵 Strategic (rank 4) |
| 5 | `iris_env_diff` / `iris_env_promote` | [05](./research/feature-specs/05-env-diff-promotion.md) | dev + shared | 🔵 Strategic (rank 5) |
| 6 | `iris_sql_analyze` `advise` action | [06](./research/feature-specs/06-sql-performance-advisor.md) | dev | 🔵 Strategic (rank 6) |
| 7 | Tool-call audit log (`IRIS_AUDIT_LOG`) | [07](./research/feature-specs/07-observability-audit-log.md) | shared | 🔵 Second wave (rank 7) |

Features 8–10 (embedded Python, semantic search, FHIR server) are explicitly **not** in scope of this change
(semantic search is gated on 8; FHIR is a separate initiative).

**Evidence base:** the research doc's competitive analysis (iris-agentic-dev skills, Postgres MCP Pro health
check / index advisor / read-only mode, InterSystems AI Hub "auditable" positioning) plus the PRD's own
Post-MVP list (audit logging is PRD Post-MVP verbatim). Each spec was wargamed from four adversarial angles
and sized in stories.

## Section 2: Impact Analysis

### Epic impact

- **Current epics:** Epics 1–22 are ALL `done` (sprint-status.yaml verified 2026-07-07). No in-flight story
  is affected. There is no "triggering story" — this is net-new scope arriving through the front door.
- **Required change:** append **7 new epics (23–29)**, one per spec, in wargame-rank order. No existing epic
  is modified, resequenced, invalidated, or rolled back.
- **Deferred-work ledger:** at zero carried-open (Epic 22 burn-down); only Epic-22's own 5 LOW items remain
  (CR 22.0-D1/-D2, CR 22.1-1/-2/-3). The Epic 23 kickoff retro-review gate triages them per the standard
  /epic-cycle process — they are unrelated to these features and must not block kickoff (Rule #37 cadence:
  re-deferral count starts at zero after the Epic 22 terminal-disposition burn-down).

### Artifact impact

| Artifact | Impact | Action |
|---|---|---|
| **PRD** ([prd.md](./prd.md)) | No conflict with goals — these ARE the PRD's differentiation/Post-MVP direction (audit logging is named Post-MVP; presets extend the FR113 governance model; resend completes PRD Journey 3; health check collapses Journey 5). | Add **FR131–FR137** (one per feature) after FR130. |
| **Epics** ([epics.md](./epics.md)) | Additive. | Append Epics 23–29 with story breakdowns; each epic names its feature spec as the **binding spec** (Epic 22 precedent: binding research doc + ratified decisions). |
| **Architecture** ([architecture.md](./architecture.md)) | No structural conflict. Every feature extends an established extension point: governance cascade (Epic 14/20 `defaultSeed`/`defaultEnabledWrites` pattern → `presetSeed`), MCP capability wiring (resources pattern → prompts), `handleToolCall` single choke point (governance gate → audit interceptor), per-profile client pool (D2 `server` param → `resolveProfileClient`), Dispatch/handler pattern (new `/monitor/health`, `/interop/message/resend`, `/dev/doc/hashes`, `/dev/sql/advise-data` routes). | Decision record **H1–H6** appended to Core Architectural Decisions ("Feature Differentiation Wave 1 (Epics 23–29)") per the layered-record convention (Epic 14 D1–D8 → 19 E1 → 20 F1–F2 → 21 G1–G3). Tool-count/tree refreshes still land in each epic's docs-rollup story (Epic 15 pattern). |
| **UX** | N/A — no UI surface in this suite. | None. |
| **Secondary artifacts** | `tool_support.md`, READMEs, CHANGELOG, client-config guides, `scripts/` (3 new generators/validators: `baseline-classifications` artifact, `gen-skills.mjs`, `validate-prompts.mjs`). | Handled inside each epic's stories per conventions §5 / Rule #30. |

### Technical impact

- **Tool counts (package arrays):** ops 20→21 (`iris_health_check`), interop 21→22 (`iris_message_resend`),
  dev 26→28 (`iris_env_diff`, `iris_env_promote`); admin/data unchanged. Package total 100→104.
  Epics 24/25/29 add **zero** tools (framework/config/content surfaces — Rule #31 counting discipline applies).
- **ObjectScript / BOOTSTRAP_VERSION:** Epics **23, 26, 27, 28** touch ObjectScript → bootstrap regen +
  version bump per ObjectScript-touching story (Rule #24). Epics **24, 25, 29** are TS/content-only → no bump.
- **Governance:** every new key classified per Rule #28; new writes default-disabled
  (`iris_message_resend:resend|resendFiltered`, `iris_env_promote:execute`) — none uses `defaultEnabled`
  (spec 04 explicitly rules it out for resend). Frozen baseline `1e62c5ad5bf7` untouched everywhere
  (Rules #23/#25); spec 02's classification sweep lands in a NEW generated artifact
  (`baseline-classifications.ts`), never in the frozen file.
- **Back-compat (release gate, PRD NFR):** all seven features are strictly additive with mechanical off-state
  proofs required by the specs (unset preset / unset audit log / empty prompt pack / omitted params ⇒
  byte-for-byte today's behavior — Rule #19; capstones in the DEFAULT suite — Rule #21).
- **Test environment prerequisite (Epic 27 only):** meaningful env-diff testing needs `IRIS_PROFILES` with
  **≥2 reachable IRIS instances**. Fallback: two profiles pointing at the same instance with different default
  namespaces exercises the full code path with an explicit residual-risk note (Rule #34 spirit). **Flag: decide
  before Epic 27 kickoff whether to stand up a second instance.**

## Section 3: Recommended Approach — Direct Adjustment

**Selected: Option 1 — Direct Adjustment** (add new epics within the existing plan structure).
Rollback (Option 2) is meaningless — nothing to revert. MVP review (Option 3) is unnecessary — the MVP
shipped through Epic 22; this extends the post-MVP roadmap without changing goals.

**Epic-shaping decision: 7 focused epics (one per spec), NOT 3 bundled epics.** The research doc sketched
bundling the quick wins into one "Trust & Triage" epic. Rejected in favor of one-epic-per-spec because:

1. **Isolation of risk surfaces.** Specs 01/04/05/06 each carry their own bootstrap bumps and probe stories;
   02/03/07 are pure-TS framework changes with their own back-compat capstones. Bundling an ops tool, a
   governance-engine change, and a new MCP capability into one epic muddies review focus and the per-epic
   retro signal.
2. **Project cadence.** Epics 19–22 validated the small-focused-epic pattern (1–2 stories each closed at
   0 HIGH). The /epic-cycle machinery (kickoff branch, retro-review gate, per-story lead smoke, retro) is
   per-epic; small epics keep each gate meaningful.
3. **Independent shippability.** Each spec is independently valuable and independently demo-able; a stall in
   one (e.g., Epic 27's second-instance prerequisite) must not hold the others hostage.

**Sequencing (recommended execution order = epic number order):**

| Epic | Feature | Stories | Effort | Dependencies |
|---|---|---|---|---|
| 23 | Composite Health Check | 3 | ~2.5 | none |
| 24 | Governance Presets + SQL caps | 3 | ~3 | none |
| 25 | Prompts & Skills Pack | 3 | ~2.5–3 | soft: `check-system-health` prompt best after Epic 23 (spec has a fallback sequence if not) |
| 26 | Message Resend/Replay | 4 | ~3.5 | soft: Story 26.3 ships the gated `resend-failed-messages` prompt → needs Epic 25's framework |
| 27 | Env Diff & Promotion | 5 | ~5 | **prereq: 2 live profiles/instances for smokes**; framework `resolveProfileClient` |
| 28 | SQL Performance Advisor | 4 | ~4 | none (may run before/parallel to 27 if the second instance isn't ready) |
| 29 | Observability & Audit Log | 3 | ~3 | soft: `presetApplied` field populated because Epic 24 shipped (no hard dependency per spec) |

~24 stories total. Risk assessment: LOW for 23/24/25/29 (mostly reuse + TS-layer), MEDIUM for 26/27/28
(probe-gated IRIS APIs, write blast radius — all contained by mandatory Story-0 probes (Rule #16), dry-run/
confirm double-gates (Epic 20 pattern), default-disabled governance, and live rejection smokes (Rule #26)).
Timeline impact on other work: none — nothing else is planned.

## Section 4: Detailed Change Proposals

### 4.1 epics.md — append Epics 23–29

Seven new epic sections appended after Epic 22, each following the established format (Goal / Scope /
Functional Requirements / Stories with ACs / Out of scope) and declaring its feature spec **binding** —
story-level acceptance criteria in epics.md are distilled; the spec (plus
[00-conventions.md](./research/feature-specs/00-conventions.md)) is the authoritative work order at
story-creation time. Full text is in [epics.md](./epics.md) §Epics 23–29. Summary of story structure:

- **Epic 23 — Composite Health Check (`iris_health_check`, ops):** 23.0 probe & thresholds (fills every
  `[PROBE]` in spec 01 §3); 23.1 ObjectScript `/monitor/health` endpoint + `%UnitTest` + bootstrap bump;
  23.2 TS tool + threshold/verdict engine + docs + live smokes (second namespace, Rule #34).
- **Epic 24 — Governance Safety Presets & SQL Resource Caps (shared):** 24.0 `baseline-classifications.ts`
  generated artifact + completeness test (exact frozen-key-set parity); 24.1 preset engine (cascade gains
  `presetSeed`; read-only blocks `defaultEnabled` writes; fail-fast on unknown preset; `iris_server_profiles` +
  resource + `presetApplied` surfacing) + both capstones in default suite; 24.2 SQL caps
  (`IRIS_SQL_MAX_ROWS`/`IRIS_SQL_TIMEOUT`) + docs + live read-only rejection/re-enable smokes.
- **Epic 25 — MCP Prompts Capability & Agent Skills Pack (shared + all):** 25.0 framework `prompts/list`+`get`
  plumbing + capability-absent back-compat snapshot; 25.1 seven v1 prompts + `gen-skills.mjs` (+`--check`) +
  `validate-prompts.mjs` wired into the default suite; 25.2 docs + live MCP-client smoke incl. one end-to-end
  workflow. Tool counts unchanged everywhere (asserted).
- **Epic 26 — Message Resend/Replay (`iris_message_resend`, interop):** 26.0 MANDATORY API probe
  (`EnsPortal.MessageResend` → `Ens.MessageHeader` family, scratch production, semantics matrix); 26.1
  ObjectScript routes/handlers/guards + bootstrap bump; 26.2 TS tool + governance wiring; 26.3 docs +
  live smokes (single resend + four live refusals, no-write verified) + the gated `resend-failed-messages`
  prompt added to the Epic 25 pack.
- **Epic 27 — Environment Diff & Promotion (`iris_env_diff`/`iris_env_promote`, dev + shared):** 27.0
  framework `resolveProfileClient` + `/dev/doc/hashes` ObjectScript endpoint (SHA probe) + documents-domain
  diff; 27.1 remaining domains (mappings/SDS/webapps/config) + secret redaction; 27.2 `promote:plan`
  (ordered, warnings-not-deletions, plan hash); 27.3 `promote:execute` (allowlist + confirm + stale-plan +
  target-profile governance gates, halt-on-error); 27.4 docs + full seeded-drift round-trip capstone +
  rejection smokes.
- **Epic 28 — SQL Performance Advisor (`iris_sql_analyze:advise`, dev):** 28.0 MANDATORY probe matrix (plan
  markers verbatim, dictionary/tune/statement surfaces on 2023.1+); 28.1 `/dev/sql/advise-data` ObjectScript
  endpoint + bootstrap bump; 28.2 TS heuristic engine + reference-captured fixtures (Rule #36); 28.3 `advise`
  action wiring + existing-actions byte-for-byte snapshot + docs (advisory disclaimer) + smokes.
- **Epic 29 — Tool-Call Observability & Session Audit Log (shared):** 29.0 interceptor + JSONL writer +
  redaction + fail-fast/rotation + unset-⇒-no-op proof; 29.1 outcome fidelity (ok/error/denied +
  `denyReason`/`presetApplied`, seq/session ordering under concurrency, shutdown flush); 29.2 docs
  ("Compliance & Auditability" README section) + live 3-outcome smoke + zero-secrets grep + rotation check.

### 4.2 prd.md — add FR131–FR137

Appended after FR130 (full text in [prd.md](./prd.md)):

- **FR131** (Epic 23) — one-call composite health verdict tool, read/enabled.
- **FR132** (Epic 24) — one-word governance presets + SQL resource caps; unset ⇒ byte-for-byte today.
- **FR133** (Epic 25) — MCP `prompts` capability on all 5 servers + generated installable `skills/` pack.
- **FR134** (Epic 26) — message resend by header IDs / bounded filter; writes default-disabled.
- **FR135** (Epic 27) — cross-profile drift report + gated ordered promotion; `execute` default-disabled.
- **FR136** (Epic 28) — advisory SQL performance findings with evidence/confidence; read/enabled.
- **FR137** (Epic 29) — opt-in secrets-free JSONL audit trail of every tool call; unset ⇒ no-op.

### 4.3 sprint-status.yaml — seed Epics 23–29

`epic-23`…`epic-29` blocks appended in `backlog` status with all 24 story keys (`backlog`) and
`epic-NN-retrospective: optional` entries, per the Epic 20/21/22 seeding precedent. `last_updated` refreshed.

## Section 5: Implementation Handoff

**Scope classification: Moderate** — backlog reorganization; no fundamental replan (the specs already
constitute the PM/analyst-level plan; architecture extends established patterns).

| Role | Responsibility |
|---|---|
| **Scrum Master / epic-cycle** | Kick off epics in order via `/epic-cycle 23` … `/epic-cycle 29`. At each kickoff: standard retro-review gate (Epic 23's gate triages the 5 Epic-22 LOW deferred items). At story creation: pull the binding spec + `00-conventions.md` into the story file; apply Rule #16 story-creation probes where specs mark `[PROBE]`. |
| **Development team** | Execute stories against the binding specs. Non-negotiables restated: probe-before-build (Rule #16), governance classification (Rule #28) with writes default-disabled, frozen baseline untouched (Rules #23/#25), bootstrap regen per ObjectScript story (Rule #24), mechanical back-compat proofs (Rule #19), live rejection smokes (Rule #26), second-namespace smokes (Rule #34), reference-pinned fixtures for the advisor (Rule #36), scope-filter + timeout discipline (Rule #38). |
| **Project Lead (stakeholder)** | ~~Two decisions were flagged~~ **Both RESOLVED same-session — see Addendum below**: (1) Epic 27 smokes run on two profiles on the single dev instance; (2) v1 prompt list approved and expanded to 9 (+2 gated). Remaining: per-story lead smokes as usual. |

**Success criteria for this change:**
1. Epics 23–29 exist in epics.md with FR131–FR137 traceable in prd.md; sprint-status.yaml seeded — `/epic-cycle 23` can start with zero additional planning.
2. Each epic closes with its spec's acceptance criteria + conventions §6 definition-of-done met (0 HIGH, additive proofs green, frozen baseline clean).
3. After Epic 29: the positioning sentence from the research holds — one-command health verdicts, one-word read-only safety, packaged expert workflows, governed message resend, cross-environment drift detection, and a compliance-grade audit trail — with the 100→104-tool suite still byte-for-byte backward compatible in its default configuration.

## Checklist Execution Record

| Item | Status | Notes |
|---|---|---|
| 1.1 Triggering story | **N/A** | No triggering story — stakeholder-directed scope addition off completed research. |
| 1.2 Core problem defined | **Done** | Issue type: *new requirement from stakeholders* (strategic differentiation). |
| 1.3 Evidence gathered | **Done** | Research doc + 10 specs + competitive citations; wargame scores. |
| 2.1 Current epic evaluable | **N/A** | All epics 1–22 done; nothing in flight. |
| 2.2 Epic-level changes | **Done** | Add Epics 23–29; no modification/removal of existing epics. |
| 2.3 Future epic review | **Done** | None planned beyond 22; features 8–10 remain unscheduled (research: defer/gate/separate initiative). |
| 2.4 Invalidations / new epics | **Done** | Nothing invalidated; 7 new epics needed. |
| 2.5 Order/priority | **Done** | Wargame-rank order 23→29; 28 may swap ahead of 27 if the second instance isn't ready. |
| 3.1 PRD conflicts | **Done** | No conflicts; FR131–FR137 added; MVP untouched. |
| 3.2 Architecture conflicts | **Done** | None — extends established extension points; counts refresh per docs stories. |
| 3.3 UI/UX conflicts | **N/A** | No UI surface. |
| 3.4 Other artifacts | **Done** | tool_support/READMEs/CHANGELOG per Rule #30 in-epic; 3 new scripts land with Epics 24/25. |
| 4.1 Direct adjustment | **Viable — SELECTED** | Effort: Medium (24 stories). Risk: Low–Medium (probe- and gate-contained). |
| 4.2 Rollback | **Not viable** | Nothing to roll back. |
| 4.3 MVP review | **Not viable/needed** | MVP shipped; goals unchanged. |
| 4.4 Path selected | **Done** | Option 1 with 7-epic shaping (rationale §3). |
| 5.1–5.5 Proposal components | **Done** | This document. |
| 6.1 Checklist review | **Done** | All sections addressed. |
| 6.2 Proposal accuracy | **Done** | Cross-checked against specs 00–07, sprint-status.yaml, prd.md FR tail, epics.md tail. |
| 6.3 Explicit approval | **Done (pre-authorized)** | User directive: "I want to implement Features 1-7. Create the course correction for 1 or more epics to complete these changes." Unattended session — artifacts applied; revisions on request. |
| 6.4 sprint-status.yaml updated | **Done** | Epics 23–29 + 24 stories seeded `backlog`; retros `optional`. |
| 6.5 Handoff confirmed | **Done** | §5 above; next action `/epic-cycle 23`. |

---

## Addendum — Stakeholder Decisions (2026-07-07, same session)

Both open decisions from §5 were resolved by the stakeholder immediately after the proposal was applied:

**Decision 1 — Epic 27 test environment: two profiles on the one instance, accepted.**
The Story 27.4 capstone runs with `IRIS_PROFILES` defining two profiles against the single dev instance
(same host/port, **different default namespaces**). This exercises the full code path — profile
resolution, `resolveProfileClient`, per-domain diff, promotion gates — with one accepted residual risk,
which Story 27.4 must record explicitly: no cross-instance / cross-IRIS-version drift coverage
(version-skew normalization is exercised logically, not against real skew). If a second instance exists
by 27.4, it is preferred. Consequence: the "28 may run before 27" sequencing hedge is moot — recommended
order stands at 23→29. *Applied to:* spec 05 prereqs (amended in place), epics.md Epic 27 scope +
AC 27.4.2, sprint-status.yaml epic-27 block.

**Decision 2 — v1 prompt list approved, with delegated-judgment additions.**
The proposed 7 prompts are approved. Under the delegated judgment, the SM added two non-gated prompts —
both encode the suite's most footgun-prone operational workflows using only tools that exist today —
plus one more gated prompt:

- **`recover-stuck-production`** (interop, non-gated): status → summary/queues → logs →
  `iris_production_control:recover` FIRST → only-if-still-wedged `clean` → NEVER `killAppData` without
  explicit data-loss acceptance. Packages the Epic-20 escalation ladder already in the server
  `instructions` field.
- **`run-external-backup`** (ops, non-gated): `iris_journal_info` pre-check → `iris_backup_manage`
  freeze → pause for external snapshot → **thaw ALWAYS, even on failure** → verify journaling resumed →
  history. Encodes the never-end-frozen guarantee.
- **`promote-environment-change`** (dev, **GATED on Epic 27**, ships in Story 27.4 — mirrors the
  `resend-failed-messages`/Epic 26 pattern): scoped diff → user-reviewed plan → explicit allowlist →
  confirmed execute → re-diff verify.

Considered and skipped (thin or single-tool workflows; revisit post-wave from real usage):
lock-contention investigation, bulk export, scheduled-task creation, LOC reporting.

Net: Epic 25 ships **9** non-gated prompts; the pack reaches **11** after Epics 26/27. AC 25.1.4's
sign-off is satisfied by this decision — any change to the list during dev is re-flagged. *Applied to:*
spec 03 (§preamble, §3 table +3 rows, §5, §7), epics.md Epic 25 scope + ACs 25.1.1/25.1.4 and Epic 27
scope + new AC 27.4.4, prd.md FR133, sprint-status.yaml epic-25/epic-27 blocks.
