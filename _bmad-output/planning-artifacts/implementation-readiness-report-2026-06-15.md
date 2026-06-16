---
date: '2026-06-15'
project_name: 'iris-execute-mcp-v2'
assessor: 'Winston (architect) via bmad-check-implementation-readiness'
scope: 'Epics 14-17 (Management Portal Tool Expansion) + cross-cutting foundation. Epics 1-13 are done and were validated in implementation-readiness-report-2026-04-05.md.'
documentsAssessed:
  - prd.md
  - architecture.md
  - epics.md
stepsCompleted: [1, 2, 3, 4, 5, 6]
---

# Implementation Readiness Assessment Report

**Date:** 2026-06-15
**Project:** iris-execute-mcp-v2
**Scope:** Epics 14–17 (Management Portal Tool Expansion) + cross-cutting platform foundation
**Assessor:** Winston (architect)

> Epics 1–13 are `done` and were validated in [implementation-readiness-report-2026-04-05.md](./implementation-readiness-report-2026-04-05.md). This assessment focuses on the newly-added scope.

## Step 1 — Document Inventory

| Type | File | Size | Notes |
|---|---|---|---|
| PRD | `prd.md` | ~57 KB | FR111–126 added (Epic 14–17 subsections) |
| Architecture | `architecture.md` | ~70 KB | Epic 14 Foundation ADR (D1–D8); `amendedAt: 2026-06-15` |
| Epics & Stories | `epics.md` | ~281 KB | Epics 14–17, 20 stories, backward-compat banner |
| UX Design | — | — | N/A — headless MCP server suite, no UI |

**Duplicates:** none (all whole documents; no sharded folders).
**Missing:** UX (expected — no user interface).
**Verdict:** Document set complete for assessment.

## Step 2 — PRD Analysis

### Functional Requirements (new scope)

FR1–FR110 were validated in the 2026-04-05 readiness report and are unchanged. The 16 new requirements:

**Epic 14 — Platform Foundation**
- FR111: Define multiple named IRIS server profiles via `IRIS_PROFILES` JSON env var; `IRIS_*` = default profile (back-compat).
- FR112: Optional `server` param on every tool selects a profile per call; omit → default; profile name only (no credentials on wire).
- FR113: Govern tool availability at action level via `IRIS_GOVERNANCE` JSON env var; cascade `profile.explicit ?? global.explicit ?? defaultSeed`; default seed = existing+new-reads on, new-writes off.
- FR114: Call-time enforcement; disabled action → structured error naming action + profile; all tools stay advertised.
- FR115: Read effective policy per profile via MCP resource `iris-governance://{profile}` (advisory).

**Epic 15 — Security & Admin** — FR116 services, FR117 LDAP, FR118 X.509, FR119 audit, FR120 column/schema SQL privileges.
**Epic 16 — Operations** — FR121 process detail+control, FR122 database actions, FR123 backups.
**Epic 17 — Interop & Dev** — FR124 default settings, FR125 production-item add/remove+arbitrary settings, FR126 SQL analysis.

**Total FRs: 126** (110 prior + 16 new). New FRs are concrete, testable, and each names its backing IRIS API.

### Non-Functional Requirements (new/relevant)

- **Backward compatibility (hard constraint):** all Epic 14–17 features strictly additive; no `IRIS_PROFILES`/`IRIS_GOVERNANCE` → byte-for-byte prior behavior; new params optional; new tools/write-actions opt-in; no existing tool name/param/default/output-shape change. **Release gate.**
- **Governance is additive:** only adds opt-in restriction + default-off for new write actions; never disables an existing capability.
- Existing NFRs unchanged: Performance (read tools < 2s, `tools/list` < 500ms), Security (credentials never logged/exposed; HTTPS; no privilege escalation beyond connected IRIS user).

### PRD Completeness Assessment

New FRs are well-formed and individually testable. Each maps to a named IRIS class/API (traceable to implementation). The backward-compat constraint is stated as a hard NFR and a release gate — strong. **One observation:** FR113/FR114 (governance cascade + enforcement) are dense; their testability depends on the architecture's `getEffectivePolicy` contract (D3/D5) — which exists, so traceable. No PRD gaps found in the new scope.

## Step 3 — Epic Coverage Validation

### Coverage Matrix (FR111–126 → Story)

| FR | Requirement | Story | Status |
|---|---|---|---|
| FR111 | Named server profiles | 14.1 | ✓ Covered |
| FR112 | `server` param per call | 14.2 (+14.1) | ✓ Covered |
| FR113 | Governance cascade model | 14.3 | ✓ Covered |
| FR114 | Call-time enforcement | 14.4 | ✓ Covered |
| FR115 | Governance resource | 14.5 | ✓ Covered |
| FR116 | Services (`Security.Services`) | 15.1 | ✓ Covered |
| FR117 | LDAP (`Security.LDAPConfigs`) | 15.2 | ✓ Covered |
| FR118 | X.509 (`%SYS.X509Credentials`) | 15.3 | ✓ Covered |
| FR119 | Audit (`Security.Events`/`%SYS.Audit`) | 15.4 | ✓ Covered |
| FR120 | Column/schema SQL privileges | 15.5 | ✓ Covered |
| FR121 | Process detail + control | 16.1 | ✓ Covered |
| FR122 | Database actions | 16.2 | ✓ Covered |
| FR123 | Backups (`Backup.General`) | 16.3 | ✓ Covered |
| FR124 | Default settings | 17.1 | ✓ Covered |
| FR125 | Production-item enhancement | 17.2 | ✓ Covered |
| FR126 | SQL analysis | 17.3 | ✓ Covered |

### Missing Requirements

None. Every new FR maps to exactly one tool/feature story.

### Orphan-Story Check (stories without an FR)

Four non-FR stories — 14.6 (docs rollup), 15.6 / 16.4 / 17.4 (BOOTSTRAP bump + live verification + docs) — are legitimate **enabler** stories, not orphans. They carry the documentation deliverable (FR-adjacent), the single per-epic bootstrap bump, and live HSCUSTOM verification. Expected and correct per the project's established epic pattern (cf. Epic 10/11/12/13).

### Coverage Statistics

- Total new PRD FRs (this scope): 16
- New FRs covered in epics: 16
- **Coverage: 100%**

## Step 4 — UX Alignment

**N/A — not applicable.** The IRIS MCP suite is a headless server suite (stdio / Streamable HTTP transport); it has no user interface, screens, or user flows. No UX specification exists or is required. No UX-alignment gaps possible. Marked complete and skipped.

## Step 5 — Epic Quality Review

Applied the create-epics-and-stories standards rigorously (user value, epic independence, no forward dependencies, story sizing, AC quality, dependency timing).

### 🔴 Critical Violations
**None.**

### 🟠 Major Issues
**None.** No forward dependencies (Epics 15/16/17 depend only on Epic 14, which *precedes* them — backward deps, allowed). No orphan stories. No epic-sized stories.

### 🟡 Minor Concerns (non-blocking)

**MINOR-1 — Epic 14 is a foundation epic.** Against pure greenfield "every epic = end-user value" dogma this is a yellow flag. *Justified, accept:* it exposes operator-facing capability (FR111–115 are demonstrable end-to-end — configure two profiles, route a call, disable an action), and it matches this project's own precedent (Epic 1 was "Shared Infrastructure & Developer Connection"). Each 14.x story is independently demonstrable. **No action required.**

**MINOR-2 — The governance baseline generator (arch D3) isn't an explicit story deliverable.** Architecture decision D3 makes back-compat *provable* via a generated `governance-baseline.ts` (a `gen-governance-baseline.mjs` script mirroring the bootstrap generator). This mechanism is currently implied inside Story 14.3 but not called out as a concrete deliverable. **Recommendation:** add an explicit AC (or sub-task) to Story 14.3 for the baseline generator + its check-in, so the provable-back-compat mechanism isn't lost in implementation. *Real gap between architecture and story ACs.*

**MINOR-3 — Cross-server integration-test ownership is implicit.** The two highest-risk behaviors are cross-cutting: per-profile session isolation (D1) and uniform gate behavior across all five servers (D5). Tests are folded into individual stories (AC 14.1.6 covers session isolation at unit level), but no story explicitly owns an end-to-end check across ≥2 servers. **Recommendation:** add a cross-server integration-test AC to Story 14.5 (or a small closing test story in Epic 14). *Strengthens the riskiest area.*

**MINOR-4 — ACs are declarative, not BDD Given/When/Then.** The generic IR standard prefers G/W/T; this project uses declarative checklist ACs throughout (Epics 1–13). House-style deviation, not a defect — the ACs are specific and testable. **Note only.**

### Best-Practices Compliance Checklist (Epics 14–17)
- [x] Epics deliver value (14 foundation-justified; 15/16/17 clear capability)
- [x] Epics independent / no forward dependencies (15/16/17 → 14 backward)
- [x] Stories appropriately sized (one tool / one concern each)
- [x] No forward story dependencies (within-epic ordering is backward-only)
- [x] "Tables when needed" → bootstrap handlers deployed per tool-epic (single bump at closing story)
- [x] Clear, testable acceptance criteria (declarative house style)
- [x] FR traceability maintained (100%)

## Summary and Recommendations

### Overall Readiness Status

**READY** — proceed to implementation. 0 critical, 0 major, 4 minor (2 are real arch↔story gaps worth a quick fix at story-creation; 2 are notes).

### Critical Issues Requiring Immediate Action
None.

### Recommended Next Steps
1. ✅ **MINOR-2 addressed (2026-06-15)** — Story 14.3 **AC 14.3.7** added: explicit `gen-governance-baseline.mjs` generator + checked-in `governance-baseline.ts`, with an empty-`IRIS_GOVERNANCE` test asserting every baseline action stays enabled.
2. ✅ **MINOR-3 addressed (2026-06-15)** — Story 14.5 **AC 14.5.6** added: cross-server end-to-end test of per-profile session isolation (D1) + uniform governance enforcement (D5).
3. **Proceed to `epic-cycle` starting with Epic 14** — it is the hard prerequisite for 15/16/17; the three tool epics can then run in any order / in parallel.

### Final Note
This assessment found **4 minor issues across 1 category (epic quality)** and **zero coverage or traceability gaps** — FR111–126 are 100% covered, the architecture (D1–D8) gives every story a technical home, and the backward-compat constraint is enforced structurally (all foundation work in `@iris-mcp/shared`, handlers untouched). The two arch↔story gaps (MINOR-2, MINOR-3) are cheap to close during story creation and harden the riskiest parts of the foundation. The plan may proceed as-is or with those two refinements folded in.
