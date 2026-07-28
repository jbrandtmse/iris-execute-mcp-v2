# Story 32.4: Late Review-Layer Findings Cleanup

Status: done

## Story

As a Project Lead,
I want every finding from the late-returning Epic 32 review layers driven to a terminal disposition,
so that Epic 32 does not close on unexamined MEDIUMs its own review process surfaced after the fact.

**This story EXECUTES LAST in Epic 32.** Origin: the adversarial review layers for Stories 32.3 and 32.1 failed to return before those reviews closed and committed, then delivered real findings hours later (32.2's layers did return, and its review deferred one item here). The lead triaged everything into `deferred-work.md`; this story is the terminal-handling pass.

## Acceptance Criteria

1. **AC 32.4.1** — TERMINAL disposition (resolved / closed-with-evidence / closed-by-decision) for all 23 items (amended 2026-07-27: originally read "22" — a hand-count error; the three ranges enumerate 23: 15 + 7 + 1, of which 32-1-R2 was already closed-with-evidence at triage, leaving 22 to disposition here): `32-3-R1…R15`, `32-1-R1…R7`, `32-2-R1`. Verify-before-patch per Rules #16/#48 — blind-layer findings have produced false positives before: every "resolved" is live-proven or mutation-verified (revert → red → restore); every dismissed-as-false-positive cites disproving evidence. `32-1-R2` was already closed-with-evidence at triage (the committed 32.1 review patched exactly it) — verify, don't re-litigate. `32-3-R15` may already be closed by the committed 32.3 review's patch #5 (vscodeMock getSession) — verify on read.
2. **AC 32.4.2** — The 8 MEDIUMs are fixed or dispositioned with evidence, never waved through: `32-3-R1` (parser-drop terminality vs PD-1 — decide whether parser-drops set `nameStates` "invalid" like mergeProfile-invalid, then align code AND the check-3 message), `32-3-R2` (`toAbsolute` posix-absolute passthrough under win32 simulation), `32-3-R3` (`apiShapeWarningSink` dedupe + version-mismatch message attribution), `32-3-R4` (eager Server Manager activation at every window load — product decision recorded, or defer the replan), `32-3-R5` (zero-state status bar vs expose-all — decide raw vs effective in the `[]` state, align with the 31-5-2/31-6-4 decisions), `32-3-R6` (`IRIS_HOST` inherited-default host validation + `\`/`:` in the guard), `32-1-R1` (Case G child env hygiene — same scrubbed childEnv as Case I), `32-1-R3` (unknown top-level keys dropped on write — preserve + warn on layer-shaped typos, or document the drop with a fixture).
3. **AC 32.4.3** — Dispositions mirrored into `deferred-work.md` in place (per-item, with evidence references); every tally mechanically derived (grep/awk, Rule #51) and cross-checked against prose.
4. **AC 32.4.4** — Back-compat gates green at close: `pnpm turbo run build test lint type-check`; extension `npx tsc --noEmit` + `npx vitest run`; `pnpm gen:governance-baseline:check` (the `:check` ONLY, Rule #25) exit 0 with frozen `1e62c5ad5bf7` byte-unchanged; no tool count moves (Rule #31); no `bootstrap-classes.ts` / `BOOTSTRAP_VERSION` / `src/ExecuteMCPv2/**` change.

## Integration ACs

No consumers in this story — cleanup/defect-disposition of already-shipped surfaces; no new exported service. Any new regression test IS the consumer-proof of its fix.

## Tasks / Subtasks

- [x] Task 1: Verify-then-disposition the possibly-stale items first (AC: 1)
  - [x] `32-1-R2` (confirm the committed patch covers it), `32-3-R15` (vscodeMock getSession — check the committed 32.3 review patch #5), `32-3-R3`'s overlap with the committed 31-4-8/31-6-1 dedupe work
- [x] Task 2: Suite-side MEDIUMs (AC: 2) — `packages/shared/src/`
  - [x] `32-3-R1` parser-drop terminality (decide + align code + check-3 message + cross-file fixture both directions)
  - [x] `32-3-R2` toAbsolute posix disjunct + passthrough test
  - [x] `32-3-R6` mergeProfile host validation on the inherited-default path + `\`/`:` decision (Rule #19 surface — re-prove the back-compat gate)
  - [x] `32-1-R1` Case G childEnv hygiene
  - [x] `32-1-R3` unknown top-level keys: preserve-on-write + layer-typo warning + fixtures
- [x] Task 3: Extension-side MEDIUMs (AC: 2) — `extensions/iris-mcp-launcher/src/`
  - [x] `32-3-R3` apiShapeWarningSink dedupe + message attribution
  - [x] `32-3-R4` eager activation product decision (record; change only if the decision is to change)
  - [x] `32-3-R5` zero-state status bar decision (align with 31-5-2/31-6-4)
- [x] Task 4: LOW items (AC: 1) — R7 warnOnce re-fire, R8 refreshStatusBar race, R9 gate env hygiene (overlaps 32-1-R1 — batch), R10 composite leak assertion, R11 dead afterEach, R12 changeset completeness, R13 credentials CLI TOCTOU/boundary, R14 coalesced-credential guards, 32-1-R4 help-check ordering, 32-1-R5 Case H header, 32-1-R6 symlink atomic write, 32-1-R7 rollback pre-image read, 32-2-R1 statSync async refactor
- [x] Task 5: Ledger mirror + mechanical tally (AC: 3)
- [x] Task 6: Back-compat gates (AC: 4)

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

### Review Findings

Code review 2026-07-27 (three layers — blind 8 / edge 9 / auditor 2 findings after merge; diff = uncommitted working tree since 78b32ba + 2 untracked test files). All patches applied and gate-verified in the same pass.

- [x] [Review][Patch] Bracketed IPv6 (`[::1]`) rejected by the extended host guard — a WORKING pre-guard configuration (`http://[::1]:52773` composes validly); the "IPv6 never usable" comment was false for the bracketed case [packages/shared/src/config.ts, packages/shared/src/profiles.ts] — MEDIUM, fixed: `:` rejection carved out for `/^\[[0-9a-fA-F:]+\]$/` at both layers, comments corrected, acceptance fixtures added; mutation-verified (carve-out neutered ⇒ red ⇒ restored)
- [x] [Review][Patch] `?`/`#` slip past the host guard and silently swallow the port in `deriveBaseUrl` (`http://example.com?x=1:52773` parses with empty port — every call 404s) [same files] — MEDIUM, fixed: charset extended, rejection fixtures added (it.each + loadConfig), mutation-verified
- [x] [Review][Patch] Changeset bullet + ledger 32-3-R12 row INVERTED what `test --connect` validates (code probes the REGISTRY profile's password; `connect.credentialSource` discloses which — verified against `cmdTest` + the 32.3 fixture) [.changeset/server-manager-first-file-wins.md, deferred-work.md] — MEDIUM, fixed: both reworded
- [x] [Review][Patch] Over-cap password WITH its newline still got the misdiagnosing file-pipe message [packages/shared/src/cli/credentials.ts] — fixed: stream-cap error names both causes
- [x] [Review][Patch] `apiShapeWarned` set BEFORE the sink check — a pre-activation mismatch call would consume the session's only warning without showing it [extensions/iris-mcp-launcher/src/extension.ts] — fixed: flag gated on sink presence + once-per-session-vs-rising-edge coherence comment (blind L4 answered in situ)
- [x] [Review][Patch] `refresh()`'s getSettings-failure early return left `emptyStateDescribeError` stale [extensions/iris-mcp-launcher/src/governancePanel.ts] — fixed: describe snapshot refreshed in the catch (guarded)
- [x] [Review][Patch] 32-3-R14 rejection containment swallowed the underlying error with no diagnostic [extensions/iris-mcp-launcher/src/serverDefinitionProvider.ts] — fixed: optional `logDiagnostic` dep (wired to the output channel, bounded content), crumb asserted in the R14 test
- [x] [Review][Patch] Coalesced 'unavailable' fallback not frozen (success branch was) [serverDefinitionProvider.ts] — fixed: `Object.freeze` + new freeze pin test
- [x] [Review][Patch] Broken-symlink disposition unrecorded (blind L7's leak mechanism disproven on read: rename never writes THROUGH a link, so no target can leak — the real gap was the unrecorded replace-the-link disposition) [packages/shared/src/cli/governance.ts] — fixed: disposition recorded in `resolveWriteTarget` doc comment
- [x] [Review][Patch] Two collapsed-line edit artifacts (Rule #55 shape) [tool-visibility-surfacing.test.ts, activationFlow.test.ts] — fixed
- [x] [Review][Patch] `effectiveZero` named its own inverse [selectServers.ts] — fixed: renamed `showEffectiveCount`
- [x] [Review][Patch] Preimage test header said "exactly ONE each" while asserting 2 [governance-cli-preimage.test.ts] — fixed: header states one pre-image read + one post-write re-validation read
- [x] [Review][Patch] Story record not reconciled after QA (File List omitted QA's host-guard gate + precedence Cases E/F + governance Case J; counts stale at 16/105) [this file] — fixed
- [x] [Review][Defer] `helpRequested`'s `valuedOptions` mirrors `parseArgs` by hand (edge L5 + blind L6) [packages/shared/src/cli/governance.ts] — deferred as 32-4-R1 in deferred-work.md: correct fix is a mechanical cross-check/derived pin, disproportionate inside the review pass
- Dismissed (2): blind L4 as a defect (once-per-session shape warning IS coherent — a recovered API is cached for the session, so fix-then-rebreak is unobservable in-session; recorded in a comment via the edge-L2 patch); auditor's transient shared-suite flake (1/1294, non-reproducing on two immediate identical re-runs — recorded, no action)

**Post-review gates (2026-07-27, all green):** shared 65 files/1299 tests; extension `tsc --noEmit` clean + 20 files/328 tests; iris-mcp-all 17 files/112 tests (live process gates incl. Case F mid-session Gate-4, host-guard A–D, Case J) against the rebuilt dist; `pnpm turbo run build lint type-check` 18/18; `pnpm turbo run test` 13/13; `pnpm gen:governance-baseline:check` exit 0, frozen baseline byte-untouched; P1 mutation-verified.

## Dev Agent Record

### Agent Model Used

Claude (k3[1m]) — single-session dev, 2026-07-27.

### Debug Log References

None — no IRIS debugging required. All evidence is in the ledger table (`deferred-work.md` "Story 32.4 — late review-layer findings: TERMINAL dispositions (2026-07-27)").

### Completion Notes List

- **AC 32.4.1 (all items terminal):** All 23 carried items dispositioned (the AC says "22" but the three ranges enumerate 23 — flagged in the ledger header, not harmonized): **20 RESOLVED · 2 CLOSED-WITH-EVIDENCE · 1 CLOSED-BY-DECISION** (32-3-R4; 32-3-R13's TOCTOU half is a second decision inside a resolved row). Verify-before-patch per Rules #16/#48: `32-1-R2` and `32-3-R15` confirmed already-fixed on the current tree (closed-with-evidence, no re-litigation); 32-3-R2's claimed mechanism disproven by a live node probe (`win32.isAbsolute("/x")` is true) — shipped as explicit-disjunct hardening + host-OS-independent pin instead of a "fix" for a non-bug. Every resolved code fix is mutation-verified (revert → red → restore, named per row in the ledger); 32-1-R5's Gate-4 mid-session case is proven LIVE against real IRIS (process gate 8/8).
- **AC 32.4.2 (8 MEDIUMs):** All eight dispositioned with evidence — R1 terminal (PD-1 option (a), decision recorded in code + ledger: parser-drops are terminal like mergeProfile-invalid; 31-0-2 stays the single documented exception and the check-3 message states both halves); R2 hardened+pinned; R3 dedupe + attribution via a new optional `getServerManagerApiFailureReason` dep; R4 closed-by-decision (eager activation predates 32.3 — `extensionDependencies` + AC 31.5.4); R5 resolved as a recorded behavior change (zero-state reports the effective count when known non-zero, aligned with 31-5-2/31-6-4; CHANGELOG entry per Rule #43); R6 guard extended to the final host (incl. inherited `IRIS_HOST` via `loadConfig` fail-fast) and to `\`/`:`; 32-1-R1 Case G scrubbed env; 32-1-R3 preserve-unknown-keys + layer-typo warning.
- **AC 32.4.3 (ledger + tally):** `deferred-work.md` mirrored in place with a 23-row disposition table; the tally is mechanically derived (awk/grep over the disposition column) and cross-checked against the prose: 23 rows · 20 RESOLVED · 2 CLOSED-WITH-EVIDENCE · 2 rows carrying CLOSED-BY-DECISION (one split) · 0 unmarked.
- **AC 32.4.4 (back-compat gates):** `pnpm turbo run build test lint type-check` — 6 builds, 13 test tasks (shared 65 files/1294 tests at dev close, 1299 after the review's R6 fixtures; iris-mcp-all 17 files/112 tests after QA's +7 — incl. rebuilt-dist live process gates), 18 lint/type-check tasks, all green; extension `npx tsc --noEmit` clean + 327/327 tests at dev close (328 after the review's freeze pin; the post-review re-run record is in Review Findings below); `pnpm gen:governance-baseline:check` (`:check` ONLY) exit 0 — frozen 141 keys / hash `1e62c5ad5bf7` byte-unchanged (verified untouched by git); no tool count moves (Rule #31 — test files and one new exported helper `parseGovernanceFileText` in shared, no new tools/actions); no `bootstrap-classes.ts`/`BOOTSTRAP_VERSION`/`src/ExecuteMCPv2/**` change; NUL-byte scan of the full diff clean (Rule #55; the one heredoc attempt was aborted before any write and redone with file tools).
- Notable incident during dev: an R3 mutation attempt left deliberate syntax damage that produced "no tests" instead of red — caught immediately, restored, and re-mutated cleanly at the call site. No lasting effect; the file tools were used for all content writes after that.

### File List

Modified:
- `.changeset/server-manager-first-file-wins.md` (R12 — CLI changes covered under the same bump)
- `_bmad-output/implementation-artifacts/deferred-work.md` (Story 32.4 disposition table + mechanical tally + gates record)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (story status)
- `extensions/iris-mcp-launcher/CHANGELOG.md` (Rule #43 — zero-state + warning-behavior entries)
- `extensions/iris-mcp-launcher/src/extension.ts` (R3 dedupe+attribution, R4 decision record, R8 seq guard, 32-2-R1 async engine host/fileExists)
- `extensions/iris-mcp-launcher/src/governanceEngine.ts` (32-2-R1 — async FileExistsProbe/resolveGovernanceCli)
- `extensions/iris-mcp-launcher/src/governancePanel.ts` (32-2-R1 — async describe/fileExists)
- `extensions/iris-mcp-launcher/src/selectServers.ts` (R3 suppression dep, R5 zero-state effective count)
- `extensions/iris-mcp-launcher/src/serverDefinitionProvider.ts` (R3 dep, R7 warnOnRisingEdge, R14 containment+freeze)
- `extensions/iris-mcp-launcher/src/types.ts` (ServerManagerApiFailureReason)
- `extensions/iris-mcp-launcher/src/__tests__/activationFlow.test.ts` (R3/R5/R8 wire tests)
- `extensions/iris-mcp-launcher/src/__tests__/selectServers.test.ts` (R5 unit tests)
- `extensions/iris-mcp-launcher/src/__tests__/serverDefinitionProvider.test.ts` (R7/R14 tests)
- `extensions/iris-mcp-launcher/src/__tests__/governanceEngine.test.ts` (32-2-R1 async conversion)
- `extensions/iris-mcp-launcher/src/__tests__/governanceEngineRealCli.test.ts` (32-2-R1 async conversion)
- `extensions/iris-mcp-launcher/src/__tests__/governancePanel.test.ts` (32-2-R1 async fakes)
- `extensions/iris-mcp-launcher/src/__tests__/governanceUiRoundTrip.test.ts` (32-2-R1 async conversion)
- `packages/iris-mcp-all/src/__tests__/governance-file-process-gate.test.ts` (32-1-R1 Case G env, 32-1-R5 Case F mid-session Gate-4 + Case H header, R9 case-insensitive scrub; QA: Case J — 32-1-R3 unknown-key preservation through the REAL bin)
- `packages/iris-mcp-all/src/__tests__/server-manager-process-gate.test.ts` (R9 env inheritance, R11 dead afterEach)
- `packages/iris-mcp-all/src/__tests__/server-manager-precedence-gate.test.ts` (R9 scrub + env inheritance; QA: Case E — 32-3-R1 parser-drop terminality at the wire + Case F — check-3 under `required`)
- `packages/shared/src/server-manager-source.ts` (R1 parser-drop terminality, R2 posix disjunct)
- `packages/shared/src/profiles.ts` (R6 final-host guard + `\`/`:`)
- `packages/shared/src/config.ts` (R6 loadConfig IRIS_HOST fail-fast)
- `packages/shared/src/governance.ts` (32-1-R7 — new export `parseGovernanceFileText`, loadGovernanceFile refactored onto it)
- `packages/shared/src/cli/governance.ts` (32-1-R3 preserve-unknown-keys + typo warning, 32-1-R4 helpRequested, 32-1-R6 resolveWriteTarget, 32-1-R7 read-once pre-image)
- `packages/shared/src/cli/credentials.ts` (R13 — newline-slack cap + post-strip measurement + TOCTOU decision record)
- `packages/shared/src/__tests__/server-manager-source.test.ts` (R1 cross-file fixtures both directions, R2 pin)
- `packages/shared/src/__tests__/profiles.test.ts` (R6 fixtures)
- `packages/shared/src/__tests__/governance-cli.test.ts` (32-1-R3/R4/R6 fixtures)
- `packages/shared/src/__tests__/credentials-cli.test.ts` (R13 boundary fixtures)
- `packages/shared/src/__tests__/tool-visibility-surfacing.test.ts` (R10 composite-value check + walker self-test)

New:
- `packages/shared/src/__tests__/governance-cli-preimage.test.ts` (32-1-R7 read-once fs-spy pin)
- `packages/iris-mcp-all/src/__tests__/host-guard-process-gate.test.ts` (QA — 32-3-R6 host-guard process gate, 4 cases: A/B/C dist-only startup refusals + D live byte-exact baseUrl handshake)

### Change Log

- 2026-07-27: Story 32.4 — terminal dispositions for all 23 late review-layer findings (32-3-R1…R15, 32-1-R1…R7, 32-2-R1): 20 resolved (all mutation-verified or live-proven), 2 closed-with-evidence, 1 closed-by-decision + 1 split decision. Ledger mirrored in `deferred-work.md` with a mechanically-derived tally; all back-compat gates green (turbo build/test/lint/type-check, extension tsc+vitest, governance-baseline `:check` exit 0, frozen baseline byte-unchanged, NUL-scan clean).
