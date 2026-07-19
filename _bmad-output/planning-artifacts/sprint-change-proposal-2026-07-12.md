# Sprint Change Proposal — 2026-07-12

**Trigger:** Stakeholder directive to add the **Tool Visibility Presets** feature ("Add the tool visibility feature that we've been designing") — the feature designed and approved earlier the same session:
binding spec [research/feature-specs/11-tool-visibility-presets.md](./research/feature-specs/11-tool-visibility-presets.md)
(§2.5 preset rosters explicitly stakeholder-approved 2026-07-12).
**Mode:** Batch (directive pre-authorizes; the substance — spec + rosters — was co-designed and approved by the stakeholder earlier this session; 2026-07-07 precedent).
**Prepared by:** Scrum Master (bmad-correct-course workflow)
**Change scope classification:** **Moderate** — backlog reorganization (1 new epic appended); no in-flight work disrupted; no rollback; MVP unaffected.

---

## Section 1: Issue Summary

Not a defect — a **planned scope addition** closing a gap the project's own research documents. The
2026-04-05 MCP best-practices research ([technical-mcp-server-best-practices-research-2026-04-05.md](./research/technical-mcp-server-best-practices-research-2026-04-05.md))
recommends **5–15 tools per server** with a selection-accuracy **cliff at ~20** (GitHub Copilot
evidence: 40 → 13 tools = 2–5% benchmark gain + 400ms latency cut). The product brief promised
"9–22 tools per server." After Epics 10–29 the shipped suite is **104 package / 109 runtime tools**:
dev 29 and admin 27 runtime — past the cliff; interop 23 and ops 22 — at it. Weaker clients
(Haiku-class, local LLMs) pay twice: tool-selection accuracy and per-turn context tokens.

The 2026-07-12 analysis (this session) wargamed five options — do-nothing/client-side filtering,
server-side visibility presets, tool consolidation, progressive-disclosure meta-tools, runtime
SDK toggling — and selected **server-side advertise-time visibility with named presets**, written
up as **spec 11** (the spec's §1 carries the full evidence table). Key architectural fact: today's
governance layer deliberately does NOT help — disabled actions stay visible in `tools/list` and are
refused at call time. Visibility is the missing, orthogonal, **advertise-time** layer: a hidden tool
is never registered with the MCP SDK (absent from `tools/list`, standard unknown-tool error on call,
zero context cost).

**Evidence base:** research citations above; live tool counts derived from each package's
`tools/index.ts`; the spec's five-option wargame; stakeholder approval of the §2.5 rosters
(2026-07-12, recorded in the spec header).

## Section 2: Impact Analysis

### Epic impact

- **Current epics:** Epics 1–29 are ALL `done` (sprint-status.yaml verified 2026-07-12; Wave 1
  merged to main at `77a0635`). Nothing in flight; no triggering story — net-new scope through the
  front door.
- **Required change:** append **1 new epic (30)** with 4 stories mirroring spec 11 §3. No existing
  epic is modified, resequenced, invalidated, or rolled back.
- **Deferred-work ledger:** cleared to zero carried-open at Story 29.3 (Rule #37 burn-down).
  Epic-29-own review items, if any, are triaged by the standard Epic 30 kickoff retro-review gate —
  they must not block kickoff (re-deferral count restarts post-burn-down).

### Artifact impact

| Artifact | Impact | Action (applied) |
|---|---|---|
| **PRD** ([prd.md](./prd.md)) | No conflict — extends the PRD's own "suite architecture / 5–15 tools per server" principle (PRD line ~188) and its tool-selection-accuracy validation approach. MVP untouched. | Added **FR138** (new "Epic 30" block after FR137). |
| **Epics** ([epics.md](./epics.md)) | Additive. | Appended **Epic 30** (Goal / Binding spec / Scope / FR138 / Stories 30.0–30.3 with ACs / Out of scope) after Epic 29; spec 11 declared **binding**, rosters marked approved-as-written. |
| **Architecture** ([architecture.md](./architecture.md)) | No structural conflict — a pre-registration filter at the `McpServerBase` constructor loop (the same choke point as the D1 `server`-param injection), layered in FRONT of the D5 call-time governance gate; E1/D6 surfacing extended. | Appended decision records **I1–I2** ("Tool Visibility Presets (Epic 30)") after H6, per the layered-record convention (D→E→F→G→H→I). |
| **UX** | N/A — no UI surface. | None. |
| **Secondary artifacts** | Root README, `tool_support.md`, 3 client-config guides, per-server READMEs, CHANGELOG, new `scripts/measure-tools-payload.mjs`, prompt-pack sweep. | Handled inside Story 30.3 (+30.2 for the script) per conventions §5 / Rule #30. Spec 11 was already indexed in [research/feature-specs/README.md](./research/feature-specs/README.md) earlier this session. |

### Technical impact

- **Tool counts: ZERO change** (Rule #31). No new tools, no removed tools; package `tools[]` arrays
  and every existing count assertion stay byte-for-byte. Visibility filters *registration*, not the
  arrays.
- **Governance: ZERO engine change, zero new keys.** Frozen baseline `1e62c5ad5bf7` untouched
  (Rules #23/#25); `gen:governance-baseline:check` must stay exit 0. Interaction is surfacing-only:
  the effective-policy report/resource omit hidden tools' keys; `IRIS_GOVERNANCE` keys naming hidden
  tools are legal and inert.
- **ObjectScript / BOOTSTRAP_VERSION: none.** Pure TS epic — no bootstrap bump (Rule #24 n/a).
- **New config surface:** `IRIS_TOOLS_PRESET` (`full` default | `core` | `developer`),
  `IRIS_TOOLS_DISABLE`, `IRIS_TOOLS_ENABLE` (comma lists, trailing-`*` wildcards; resolution
  `ENABLE > DISABLE > preset > default-visible`; fail-fast on unknown preset / literal disable of
  the reserved `iris_server_profiles`; warn-only on unknown names — env shared across 5 servers).
- **Back-compat (release gate):** strictly additive — unset env vars ⇒ byte-for-byte today's
  `tools/list` on all 5 servers, proven by Rule #19 mechanical snapshots in the DEFAULT suite +
  a default-launch live smoke (Rule #22/#26 shape adapted: the "guarded path" here is the
  hidden-tool call returning the SDK unknown-tool error).
- **Rot-proofing (the #1 long-term risk):** every future tool must carry an explicit per-preset
  include/exclude disposition — `assertPresetCoverage` throws at construction (Rule #28 analog),
  per-package set-equality tests, `TOOL_PAIRS` co-visibility guard. This constraint binds ALL
  future epics that add tools (recorded in architecture I2 and the epics.md scope).
- **No second-instance prerequisite, no live-IRIS-dependent risk:** the feature is client-facing
  advertisement; smokes run against the built dist.

## Section 3: Recommended Approach — Direct Adjustment

**Selected: Option 1 — Direct Adjustment** (append one epic within the existing plan structure).
Rollback (Option 2) is meaningless — nothing to revert. MVP review (Option 3) unnecessary — MVP
shipped long ago; this extends the post-MVP roadmap without changing goals.

**Epic-shaping decision: ONE epic, four stories (30.0–30.3), matching spec 11 §3 one-to-one.**
The wave-1 one-epic-per-spec pattern applies; this is a single spec with tight internal coupling
(engine → rosters → surfacing → docs), so one epic with the spec's own story seams is correct.
The 0-indexed story convention is kept; **no Story-0 probe is needed** — no IRIS API is involved
(the seam is the shared TS constructor loop; Rule #16 has nothing unverified to probe; the one
external behavior relied on — SDK unknown-tool error for unregistered names — is asserted by the
live smoke).

| Epic | Feature | Stories | Effort | Dependencies |
|---|---|---|---|---|
| 30 | Tool Visibility Presets & Per-Tool Enable/Disable | 4 | ~4 | none (Epics 1–29 all done) |

Risk assessment: **LOW** — pure TS at an established seam, mechanically-proven off-state, no
governance/bootstrap surface. The two real risks are design-level and already mitigated in the
spec: preset-roster rot (registration-time coverage assert) and support confusion from hidden
tools (`toolVisibility` counts block on `iris_server_profiles` + startup log line). Timeline
impact on other work: none — nothing else is planned.

## Section 4: Detailed Change Proposals (all applied)

### 4.1 epics.md — append Epic 30

New section after Epic 29 following the established format. Structure: Goal (count-cliff evidence +
advertise-time framing); **binding spec 11** with §2.5 rosters approved-as-written; Scope (env
family, resolution order, constructor-seam filter, reserved discovery tool, `toolVisibility`
counts-not-names, hidden-key omission, coverage/pairs guards, core ≤13 runtime per server,
Rule #19 off-state); FR138; Out of scope (per-action visibility, runtime toggling, per-profile
visibility, `operator` preset, tool consolidation → future major, audit session-start record).
Stories:

- **30.0 Visibility Engine (shared):** env parsing + fail-fast/warn semantics; resolution +
  wildcard; constructor filter (+`addTools`); hidden ⇒ absent from `tools/list` + SDK unknown-tool
  error; `assertPresetCoverage`; startup log line; **Rule #19 snapshot capstone across all 5
  servers in the DEFAULT suite**.
- **30.1 Preset Rosters (×5 packages):** `presets.ts` exactly per approved §2.5 (core 12/12/9/9/7,
  developer 28/10/22/9/7; data-mcp full-inclusion declared explicitly); coverage tests;
  `TOOL_PAIRS` co-visibility; package arrays + count assertions untouched (Rule #31); core ≤13
  runtime asserted.
- **30.2 Surfacing + Payload Measurement:** `toolVisibility {preset, visibleTools, hiddenTools}`
  (never hidden names); governance report + `iris-governance://` resource omit hidden keys;
  `scripts/measure-tools-payload.mjs` (count/bytes/~tokens per server × preset) with the table
  recorded in README + story notes.
- **30.3 Docs + Live Smokes:** Rule #30 rollup incl. a "Tool Visibility Presets" README section
  (rosters, visibility-vs-governance layering, measurement table) + client-config guides +
  prompt-pack sweep; four live dist smokes (default-identical, core-exact + hidden-call refusal,
  wildcard disable + enable hole-punch, invalid-preset fail-fast); spec §4 ACs 1–11.

### 4.2 prd.md — add FR138

New "Epic 30 — Tool Visibility Presets (added 2026-07-12)" block after FR137: advertise-time
visibility layer orthogonal to call-time governance; presets + enable/disable lists + wildcards;
never-registered semantics; per-tool granularity; reserved discovery tool with counts-only
reporting; construction-time roster coverage enforcement; fail-fast/warn split; unset ⇒
byte-for-byte (Rule #19); rosters approved 2026-07-12; binding spec feature-specs/11.

### 4.3 architecture.md — decision records I1–I2

"Tool Visibility Presets (Epic 30 — added 2026-07-12)" appended after H6:

- **I1 — Advertise-time visibility layer in front of the D5 gate:** constructor-loop filter (same
  choke point as the D1 `server`-param injection); orthogonality contract (visibility = per-tool
  ergonomics; governance = per-action safety; `read-only` safety stays `IRIS_GOVERNANCE_PRESET`);
  E1 reserved + `toolVisibility` counts; E1/D6 hidden-key omission; per-profile visibility
  impossible by protocol; runtime `RegisteredTool.enable/disable` toggling explicitly deferred.
- **I2 — Package-owned rosters with registration-time coverage enforcement:** explicit
  include/exclude dispositions; `assertPresetCoverage` (Rule #28 analog); `TOOL_PAIRS`; recorded
  roster intents (core = count cliff ≤13 runtime; developer = persona relevance); payload
  measurement script as the first measured evidence for the PRD's validation approach.

### 4.4 sprint-status.yaml — seed Epic 30

`epic-30` block appended after `epic-29-retrospective` in `backlog` status with story keys
`30-0-visibility-engine`, `30-1-preset-rosters`, `30-2-surfacing-and-measurement`,
`30-3-visibility-docs-and-smokes` (all `backlog`) and `epic-30-retrospective: optional`, plus the
standard epic comment header (binding spec, approved rosters, key invariants). Header
`# last_updated` log entry prepended; prior entry demoted to `# prior last_updated`.

## Section 5: Implementation Handoff

**Scope classification: Moderate** — backlog reorganization; no fundamental replan (the approved
spec constitutes the plan; architecture extends established patterns).

| Role | Responsibility |
|---|---|
| **Scrum Master / epic-cycle** | Kick off via `/epic-cycle 30`. Standard kickoff retro-review gate (triage any Epic-29-own deferred items; ledger was cleared at 29.3). At story creation: pull binding spec 11 + `00-conventions.md` into each story file. Note for the epics 30.1/30.3 stories: rosters are approved-as-written — any dev-time roster change must be re-flagged to the stakeholder, not silently adjusted. |
| **Development team** | Execute stories against the binding spec. Non-negotiables restated: rosters exactly per §2.5; package `tools[]` arrays and count tests untouched (Rule #31); frozen baseline untouched, `gen:governance-baseline:check` exit 0 (Rules #23/#25); mechanical off-state snapshots (Rule #19) in the DEFAULT suite (Rule #21); live smokes incl. the hidden-call refusal + fail-fast paths (Rules #22/#26); no `mutates` changes anywhere; disposable smoke scripts deleted before staging. |
| **Project Lead (stakeholder)** | No open decisions — rosters approved 2026-07-12 (spec §2.5). Remaining: per-story lead smokes as usual; review the Story 30.2 measurement table (it quantifies the feature's value and belongs in release notes). |

**Success criteria for this change:**
1. Epic 30 exists in epics.md with FR138 traceable in prd.md and I1/I2 in architecture.md;
   sprint-status.yaml seeded — `/epic-cycle 30` can start with zero additional planning.
2. Epic 30 closes with spec 11 §4 ACs 1–11 + conventions §6 met (0 HIGH; default config
   byte-for-byte; frozen baseline clean; no tool-count movement).
3. After Epic 30: one env var (`IRIS_TOOLS_PRESET=core`) brings every server to ≤13 runtime tools
   — inside the researched 5–15 window — with measured payload numbers published, and the default
   configuration still byte-for-byte backward compatible.

## Checklist Execution Record

| Item | Status | Notes |
|---|---|---|
| 1.1 Triggering story | **N/A** | No triggering story — stakeholder-directed scope addition off an approved spec. |
| 1.2 Core problem defined | **Done** | Issue type: *new requirement from stakeholders* (tool-count drift past the project's own researched ceiling; weak-model usability). |
| 1.3 Evidence gathered | **Done** | Research citations (5–15 / cliff ~20 / GitHub 40→13), live per-server counts, five-option wargame in spec 11 §1 + session analysis. |
| 2.1 Current epic evaluable | **N/A** | Epics 1–29 all done; nothing in flight. |
| 2.2 Epic-level changes | **Done** | Add Epic 30; no modification/removal of existing epics. |
| 2.3 Future epic review | **Done** | None planned beyond 29; constraint FORWARD: every future tool-adding epic must supply preset dispositions (enforced mechanically by `assertPresetCoverage`). |
| 2.4 Invalidations / new epics | **Done** | Nothing invalidated; 1 new epic needed. |
| 2.5 Order/priority | **Done** | Single epic, next in sequence; stories in spec order 30.0→30.3 (engine before rosters before surfacing before docs). |
| 3.1 PRD conflicts | **Done** | No conflicts — implements the PRD's own 5–15 principle; FR138 added; MVP untouched. |
| 3.2 Architecture conflicts | **Done** | None — pre-registration filter at an established choke point; I1–I2 recorded. |
| 3.3 UI/UX conflicts | **N/A** | No UI surface. |
| 3.4 Other artifacts | **Done** | README/tool_support/client-config/per-server/CHANGELOG per Rule #30 inside Story 30.3; new measurement script in 30.2; spec-index row pre-applied same session. |
| 4.1 Direct adjustment | **Viable — SELECTED** | Effort: Medium-low (4 stories). Risk: Low (TS-only, mechanical off-state proofs). |
| 4.2 Rollback | **Not viable** | Nothing to roll back. |
| 4.3 MVP review | **Not viable/needed** | MVP shipped; goals unchanged. |
| 4.4 Path selected | **Done** | Option 1, one epic / four stories (rationale §3). |
| 5.1–5.5 Proposal components | **Done** | This document. |
| 6.1 Checklist review | **Done** | All sections addressed. |
| 6.2 Proposal accuracy | **Done** | Cross-checked against spec 11, epics.md tail (Epic 29 + 30), prd.md FR tail, architecture.md H6→I1/I2, sprint-status.yaml tail. |
| 6.3 Explicit approval | **Done (pre-authorized)** | Stakeholder directive: "Add the tool visibility feature that we've been designing" — the feature spec and its §2.5 rosters were explicitly approved by the stakeholder earlier the same session. Batch precedent 2026-07-07; artifacts applied; revisions on request. |
| 6.4 sprint-status.yaml updated | **Done** | Epic 30 + 4 stories seeded `backlog`; retro `optional`; header log entry added. |
| 6.5 Handoff confirmed | **Done** | §5 above; next action `/epic-cycle 30`. |
