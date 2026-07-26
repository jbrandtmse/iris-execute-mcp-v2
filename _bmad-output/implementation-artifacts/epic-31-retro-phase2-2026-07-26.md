# Epic 31 Retrospective — Phase 2 (post-retro re-open)

**Date:** 2026-07-26 · **Facilitator:** Bob (Scrum Master) · **Project Lead:** Developer

**Scope:** This is the SECOND retrospective for Epic 31. The first ([epic-31-retro-2026-07-26.md](epic-31-retro-2026-07-26.md)) covered Stories 31.0–31.4 and closed the epic. Epic 31 was then re-opened under Rule SC-5. This retro covers only what followed: Stories 31.5 and 31.6, two non-story coverage-gap fixes to `packages/shared`, the multi-client configuration docs, and the Project Lead's GUI smoke that closed AC 31.4.4 and AC 31.5.4.

---

## 1. Metrics

| | |
|---|---|
| Stories | 2 (31.5, 31.6) — both `done` |
| Non-story fixes | 2 coverage gaps in `packages/shared` (`.code-workspace`; XDG + Flatpak) |
| HIGH findings | **4** (31.5: 1 · 31.6: 3) |
| MEDIUM / LOW | 0 / 0 surviving |
| Rework loops | **0** — both stories one-pass through dev → QA → review |
| Tests | extension **107 → 208** (+101) · shared **1082 → 1103** (+21) |
| Smoke checks | **61/61** — 31.5: 32/32 · 31.6: 23/23 · GUI: 6/6 |
| Deferred opened | 13 (`31-5-1`…`31-5-6`, `31-6-1`…`31-6-6`, `31-7-1`) |
| Rules codified | 3 (**#54, #55, #56**) — `project-rules.md` 53 → 56 |

Zero rework loops alongside four HIGHs is the phase's defining shape: **review is catching defects reliably; specifications are not preventing them.**

---

## 2. What went well

- **Review caught every HIGH before it shipped**, and on 31.5 all three adversarial layers independently found the same one — evidence the layered design works rather than three agents agreeing by chance.
- **Story 31.6 delivered the extension's first real-runtime test.** `localSpawnIntegration.test.ts` spawns a real child process, completes a real MCP handshake and calls live IRIS. It **runs rather than skips** (~1.5s), which narrows the long-standing Rule 3 gap (`31-5-1`).
- **The dev agent declined to claim AC 31.5.4 rather than faking it.** It had no GUI, said so plainly, left the task box unchecked and deferred to the lead's smoke. Honest reporting under pressure to look complete is exactly the behavior the process depends on.
- **Lead smokes did independent work, not ceremony.** The 31.6 smoke re-ran the review's own mutation (`ops` → `iris-data-mcp`) and confirmed it now turns a test red where it previously left 200 green — verifying the fix rather than trusting the report.
- **Prior retro action item #2 was honored exactly as written.** The AC 31.4.4 smoke ran, and the cancel path — flagged in that retro as "not a formality" — was confirmed working on real infrastructure.

---

## 3. Challenges and patterns

### 3.1 The signature defect: a branch the real system cannot reach — 3 instances

| Story | Defect | How it hid |
|---|---|---|
| 31.4 | `getSession({createIfNone:true})` REJECTS on cancel | every test faked it resolving `undefined`; the AC-required warning was unreachable code |
| 31.5 | `workspaceFolder` config-write target | six tests pinned it correct using `inspect()` shapes an unscoped `WorkspaceConfiguration` cannot produce |
| 31.6 | package-key → directory map | disk check verified EXISTENCE, not CORRESPONDENCE — `ops` → `iris-data-mcp` kept **all 200 tests green** while silently serving the wrong server |

**→ Codified as Rule #54.**

### 3.2 Content mangling by shell tooling — 5 instances

NUL bytes making a `.ts` file binary; a Python heredoc parsing `\User` as a `\U` escape and aborting **while the chained `git commit` still succeeded**, silently dropping a ledger entry; bare apostrophes breaking `sprint-status.yaml`; two further heredoc quoting failures. Every one was caught by verification, never by the tooling.

**→ Codified as Rule #55.**

### 3.3 Both coverage gaps were found by the Project Lead, not by review

`.code-workspace` discovery and Linux `XDG_CONFIG_HOME`/Flatpak scope were both surfaced by the lead asking a question — *"aren't those valid?"*, *"does this work on all three OSes?"* Three adversarial layers had reviewed Story 31.0 and all verified the code did what the ACs said. **None asked whether the AC's own candidate list was complete.** Compounded by `auto` mode not failing on zero results, making each omission silent.

**→ Codified as Rule #56.**

### 3.4 Audience discovered late

Three stories of extension work (31.4–31.6) were built before establishing that the Project Lead does not use Copilot — the only client family the extension serves. The work is still correct and valuable for Copilot users, and the client-coverage boundary *was* documented in 31.4. But nobody asked "who here will actually use this?" until Phase 2 was nearly done. Not codified as a rule — it is a planning-conversation habit, not a mechanical check.

---

## 4. Rules codified

| # | Rule | Instances |
|---|---|---|
| **#54** | A branch the real system cannot reach is worse than a missing one | 3 |
| **#55** | Never generate file content through a shell heredoc | 5 |
| **#56** | Enumeration completeness is a review question, not an implementation detail | 2 |

`project-rules.md`: 53 → **56**. Next new rule: **#57**.

---

## 5. Previous retrospective follow-through

| Prior action item | Status |
|---|---|
| #2 — AC 31.4.4 manual smoke BLOCKS Epic 32 kickoff | ✅ **DONE.** 6/6 steps confirmed in real VS Code 1.128.0. The cancel path — the item that retro called "not a formality" — confirmed working. |
| #1 — Epic 32 opens with a dedicated deferred-work burn-down story | ⏳ **Carried forward, now larger.** The ledger grew by 13 this phase (~47 Epic-31-era items). Reaffirmed below. |
| #3 — no rules codified; file stays at 53 | Superseded — this phase produced three genuine class-preventing rules. |

---

## 6. Readiness assessment

| Dimension | Status |
|---|---|
| Stories | ✅ 7/7 done |
| Testing | ✅ extension 208, shared 1103, turbo 25/25, governance baseline exit 0 |
| Manual verification | ✅ GUI smoke 6/6 |
| Deployment | ⚠️ `@iris-mcp/*` **not published to npm** — extension usable only via `developmentRepoPath` |
| Residual risk | ⚠️ Copilot consumer hop unverified (no Copilot user on the project) |
| Known cosmetic issue | ⚠️ `31-7-1` — CSRF preflight warning on every server start (pre-existing, blocks nothing) |

---

## 7. Action items

| # | Action | Owner | Type |
|---|---|---|---|
| 1 | **Epic 32 opens with a deferred-work burn-down story (Story 32.0)** before any feature work. TERMINAL disposition for every carried item — resolved / closed-with-evidence / closed-by-decision; **re-deferral is not an allowed outcome** (Rule #37). Rule #48 bar on every "resolved": prove it live or mutation-verify. Ledger is ~47 items; several `31-x` entries may already be moot after 31.5/31.6 — verify, do not assume. | Project Lead / Epic 32 planning | process |
| 2 | **Publish decision for `@iris-mcp/*`.** Nothing is on npm, so `npx -y @iris-mcp/<pkg>` fails for everyone and the extension works only in development mode. Either publish, or document the local-path requirement as the supported path. Blocks any external user of the extension. | Project Lead | decision |
| 3 | **Find a Copilot user to close the AC 31.4.4 residual.** Registration into VS Code's MCP registry is confirmed; only the final hop inside Copilot's UI is unverified, and nobody on this project uses Copilot. | Project Lead | residual risk |
| 4 | **Triage `31-7-1`** (CSRF preflight warning). Determine whether Atelier is expected to return `X-CSRF-Token` on this configuration; then either suppress the warning when the token is legitimately absent, or explain the condition in the message. Do not fix blind. | Epic 32 burn-down | technical debt |

---

## 8. Key takeaways

1. **Three review layers verify that code matches its ACs; they do not question the ACs' completeness.** Rule #56 exists because the Project Lead found by inspection what no layer thought to ask.
2. **A green suite over an impossible branch is worse than an untested one** — it actively signals safety where none exists. Three instances in one epic; Rule #54.
3. **An agent saying "I could not verify this" is a feature.** The AC 31.5.4 deferral was correct behavior and led directly to a real verification instead of a false claim.
4. **Verification caught every tooling failure that the tooling itself missed** — including a `git commit` that succeeded after its own content-generation step had aborted.
