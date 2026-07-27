# Story 32.4: Late Review-Layer Findings Cleanup

Status: ready-for-dev

## Story

As a Project Lead,
I want every finding from the late-returning Epic 32 review layers driven to a terminal disposition,
so that Epic 32 does not close on unexamined MEDIUMs its own review process surfaced after the fact.

**This story EXECUTES LAST in Epic 32.** Origin: the adversarial review layers for Stories 32.3 and 32.1 failed to return before those reviews closed and committed, then delivered real findings hours later (32.2's layers did return, and its review deferred one item here). The lead triaged everything into `deferred-work.md`; this story is the terminal-handling pass.

## Acceptance Criteria

1. **AC 32.4.1** — TERMINAL disposition (resolved / closed-with-evidence / closed-by-decision) for all 22 items: `32-3-R1…R15`, `32-1-R1…R7`, `32-2-R1`. Verify-before-patch per Rules #16/#48 — blind-layer findings have produced false positives before: every "resolved" is live-proven or mutation-verified (revert → red → restore); every dismissed-as-false-positive cites disproving evidence. `32-1-R2` was already closed-with-evidence at triage (the committed 32.1 review patched exactly it) — verify, don't re-litigate. `32-3-R15` may already be closed by the committed 32.3 review's patch #5 (vscodeMock getSession) — verify on read.
2. **AC 32.4.2** — The 8 MEDIUMs are fixed or dispositioned with evidence, never waved through: `32-3-R1` (parser-drop terminality vs PD-1 — decide whether parser-drops set `nameStates` "invalid" like mergeProfile-invalid, then align code AND the check-3 message), `32-3-R2` (`toAbsolute` posix-absolute passthrough under win32 simulation), `32-3-R3` (`apiShapeWarningSink` dedupe + version-mismatch message attribution), `32-3-R4` (eager Server Manager activation at every window load — product decision recorded, or defer the replan), `32-3-R5` (zero-state status bar vs expose-all — decide raw vs effective in the `[]` state, align with the 31-5-2/31-6-4 decisions), `32-3-R6` (`IRIS_HOST` inherited-default host validation + `\`/`:` in the guard), `32-1-R1` (Case G child env hygiene — same scrubbed childEnv as Case I), `32-1-R3` (unknown top-level keys dropped on write — preserve + warn on layer-shaped typos, or document the drop with a fixture).
3. **AC 32.4.3** — Dispositions mirrored into `deferred-work.md` in place (per-item, with evidence references); every tally mechanically derived (grep/awk, Rule #51) and cross-checked against prose.
4. **AC 32.4.4** — Back-compat gates green at close: `pnpm turbo run build test lint type-check`; extension `npx tsc --noEmit` + `npx vitest run`; `pnpm gen:governance-baseline:check` (the `:check` ONLY, Rule #25) exit 0 with frozen `1e62c5ad5bf7` byte-unchanged; no tool count moves (Rule #31); no `bootstrap-classes.ts` / `BOOTSTRAP_VERSION` / `src/ExecuteMCPv2/**` change.

## Integration ACs

No consumers in this story — cleanup/defect-disposition of already-shipped surfaces; no new exported service. Any new regression test IS the consumer-proof of its fix.

## Tasks / Subtasks

- [ ] Task 1: Verify-then-disposition the possibly-stale items first (AC: 1)
  - [ ] `32-1-R2` (confirm the committed patch covers it), `32-3-R15` (vscodeMock getSession — check the committed 32.3 review patch #5), `32-3-R3`'s overlap with the committed 31-4-8/31-6-1 dedupe work
- [ ] Task 2: Suite-side MEDIUMs (AC: 2) — `packages/shared/src/`
  - [ ] `32-3-R1` parser-drop terminality (decide + align code + check-3 message + cross-file fixture both directions)
  - [ ] `32-3-R2` toAbsolute posix disjunct + passthrough test
  - [ ] `32-3-R6` mergeProfile host validation on the inherited-default path + `\`/`:` decision (Rule #19 surface — re-prove the back-compat gate)
  - [ ] `32-1-R1` Case G childEnv hygiene
  - [ ] `32-1-R3` unknown top-level keys: preserve-on-write + layer-typo warning + fixtures
- [ ] Task 3: Extension-side MEDIUMs (AC: 2) — `extensions/iris-mcp-launcher/src/`
  - [ ] `32-3-R3` apiShapeWarningSink dedupe + message attribution
  - [ ] `32-3-R4` eager activation product decision (record; change only if the decision is to change)
  - [ ] `32-3-R5` zero-state status bar decision (align with 31-5-2/31-6-4)
- [ ] Task 4: LOW items (AC: 1) — R7 warnOnce re-fire, R8 refreshStatusBar race, R9 gate env hygiene (overlaps 32-1-R1 — batch), R10 composite leak assertion, R11 dead afterEach, R12 changeset completeness, R13 credentials CLI TOCTOU/boundary, R14 coalesced-credential guards, 32-1-R4 help-check ordering, 32-1-R5 Case H header, 32-1-R6 symlink atomic write, 32-1-R7 rollback pre-image read, 32-2-R1 statSync async refactor
- [ ] Task 5: Ledger mirror + mechanical tally (AC: 3)
- [ ] Task 6: Back-compat gates (AC: 4)

## Dev Notes

### Authoritative item records

- `deferred-work.md` sections "Late-returning Story 32.3 review-layer findings (2026-07-27)" (32-3-R1…R15, with locations + layer attributions) and "Late-returning Story 32.1 review-layer findings (2026-07-27)" (32-1-R1…R7), plus 32-2-R1 in the 32.2 review section ("sync statSync async refactor" — the 31-6-2 class in `governanceEngine.ts`'s `defaultFileExists`).
- The layers' full write-ups also live in the teammate messages recapped in the cycle log; the ledger entries carry everything needed.

### Constraints

- **Verify before patch** (Rules #16/#48): these findings were written against diffs, some against PRE-patch trees (32-1-R2 was stale). For every item, first confirm it reproduces on the CURRENT tree; if it doesn't, close-with-evidence naming the commit that fixed it.
- **32-3-R1 is a PD-1 semantics question**, not a mechanical fix: parser-drops currently claim `seenNames` but not `nameStates`. Two coherent resolutions: (a) parser-drops are terminal like mergeProfile-invalid (set `nameStates`), or (b) parser-drops are reconsidered (fix the check-3 "NOT reconsidered" message + PD-1 text to match). The Story 32.3 paired decision (PD-1: fate decided at first sighting) argues for (a), but decide with the check-3 honest-message constraint in hand and pin with the cross-file fixture in BOTH directions.
- **32-3-R6 touches the `IRIS_PROFILES`/`IRIS_HOST` contract** (Rule #19 surface): the back-compat gate must be re-proven after any change; validation error text keeps naming the source label.
- **Extension headless limits**: R4 (eager activation) and R5 (zero-state) are product decisions with tests; do not claim GUI-observable outcomes.
- **Batch by file** to avoid edit collisions: `server-manager-source.ts` (R1, R2), `profiles.ts` (R6), `governance-file-process-gate.test.ts` (32-1-R1, R9, R11, 32-1-R5), `cli/governance.ts` (32-1-R3, R6, R7), `cli/governance-cli.ts` (32-1-R4), `cli/credentials.ts` (R13), extension `extension.ts` (R3, R4, R8), `selectServers.ts` (R5), `serverDefinitionProvider.ts` (R7, R14), `governanceEngine.ts` (32-2-R1), test files (R10), changeset (R12).
- **Rule #55**: file-writing tools only; NUL-scan. **Rule #51**: mechanical tallies. **Rule #25**: baseline `:check` only.
- Some items legitimately resolve as closed-by-decision (R4 is a product call; R13's TOCTOU is message-only; 32-1-R7 is negligible-in-practice) — record the decision + reasoning explicitly.

### Previous-story intelligence

- 32.3 (burn-down): the PD-1/PD-2/PD-3 decision records; the nameStates/seenNames machinery; the mergeProfile host-hardening (31-3-7) that R6 extends.
- 32.1: Case G/H/I process-gate structure; writeFileAtomic; cmdSet/cmdUnset pre-image handling; the help-check.
- 32.2: `defaultFileExists` in governanceEngine.ts (32-2-R1 target); the warnOnce dedupe pattern that R3 mirrors.

### Project Structure Notes

- Suite: `packages/shared/src/server-manager-source.ts`, `profiles.ts`, `cli/governance.ts`, `cli/governance-cli.ts`, `cli/credentials.ts`, `packages/iris-mcp-all/src/__tests__/`, `packages/shared/src/__tests__/`.
- Extension: `extensions/iris-mcp-launcher/src/extension.ts`, `selectServers.ts`, `serverDefinitionProvider.ts`, `governanceEngine.ts`, `__tests__/`.
- Docs: `deferred-work.md`, `.changeset/server-manager-first-file-wins.md` (R12).

### References

- [Source: _bmad-output/implementation-artifacts/deferred-work.md#Late-returning Story 32.3 / 32.1 sections]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 32.4]
- [Source: .claude/rules/project-rules.md#16 / #19 / #25 / #48 / #51 / #55]

## Dev Agent Record

### Agent Model Used

(pending)

### Debug Log References

### Completion Notes List

### File List
