# Story 32.3: Deferred-Work Ledger Burn-Down (Rule #37)

Status: ready-for-dev

## Story

As a Project Lead,
I want every carried-open item in `deferred-work.md` driven to a terminal disposition,
so that the ledger enters Epic 32's feature work at zero carried items and the Rule #37 threshold is discharged.

**This story EXECUTES FIRST in Epic 32**, before Stories 32.0/32.1/32.2 — binding mandate from the Epic 31 phase-1 retro action #1 and phase-2 retro action #1, and from Rule #37 (the Epic-30-own batch is at re-deferral count 2 entering this gate; a further carry is its 3rd consecutive re-deferral).

## Acceptance Criteria

1. **AC 32.3.1** — TERMINAL disposition for EVERY carried-open item in `deferred-work.md` (44 items, enumerated in the Ledger Disposition Plan below): each lands in exactly one of **resolved / closed-with-evidence / closed-by-decision**. Re-deferral is NOT an allowed outcome for any carried item — only Epic-32's OWN new review findings may remain open (the AC-22.1.7/26.4.3 shape). Items already moot (e.g. `31-4-9`, closed by the 2026-07-26 GUI smoke 6/6) are closed-with-evidence citing that record — verify, do not assume mootness for any other item.
2. **AC 32.3.2** — Rule #48 bar on every "resolved" code fix: prove it LIVE on the real surface or MUTATION-verify (revert → red → restore). A green suite is not evidence — these items were deferred precisely because the suite was blind there. (Epic 26: a burn-down "resolved" fix was itself defective; only live HTTP caught it.)
3. **AC 32.3.3** — Rule #16 probe-first: any item whose suggested resolution embeds an unverified API claim (e.g. `31-4-5`'s session-scope keying, `31-7-1`'s `X-CSRF-Token` expectation) is probed against the real system/docs before disposition; disposable probe artifacts are deleted before commit.
4. **AC 32.3.4** — Paired questions decided ONCE, not patched per-side: `31-3-1` + `31-4-4` (reserved name `default`, one policy across both sides of the process boundary) and `31-3-3` + `31-1-2` (the precedence/rescue question) each get a single recorded decision applied uniformly.
5. **AC 32.3.5** — The full disposition table is mirrored into `deferred-work.md` with per-item evidence references; every summary tally is derived MECHANICALLY (grep/awk over the disposition column) and cross-checked against any prose count before close (Rule #51 — Story 29.3's off-by-6 hand-count is the standing counterexample).
6. **AC 32.3.6** — Back-compat gates green at close: `pnpm turbo run build test lint type-check` all green; `pnpm gen:governance-baseline:check` (the `:check` ONLY, Rule #25) exit 0 with the frozen baseline `1e62c5ad5bf7` byte-unchanged (Rules #23/#25); no tool count moves (Rule #31); extension suite (`extensions/iris-mcp-launcher`) green. No `bootstrap-classes.ts` / `BOOTSTRAP_VERSION` / `src/ExecuteMCPv2/**` change is expected — if any item's resolution genuinely requires ObjectScript, HALT and surface to the lead before proceeding.

## Integration ACs

No consumers in this story — this is a cleanup/defect-disposition story (not service-introducing). Where a resolution adds a new exported helper (e.g. `KeyringPort.exists`), its first consumer is the code path the item itself names, exercised by the item's own regression test.

## Retro-review gate triage table (Epic 31 → Epic 32 burn-down; 2026-07-26)

Sources: `epic-31-retro-phase2-2026-07-26.md` (latest by mtime; phase-1 `epic-31-retro-2026-07-26.md` action items folded in via its §5/§8) and `deferred-work.md`. Triage covers Epic 31.

| Item | Source | Triage Decision |
|---|---|---|
| Epic 31 phase-1 retro action #1 — Epic 32 opens with dedicated burn-down story | retro (phase 1) | **INCLUDE** — this story |
| Epic 31 phase-1 retro action #2 — AC 31.4.4 manual smoke blocks Epic 32 | retro (phase 1) | **CLOSED-WITH-EVIDENCE pre-gate** — GUI smoke 6/6 ran 2026-07-26 (commit `b7a27a1`), cancel path confirmed; unblocks this epic |
| Epic 31 phase-1 retro action #3 — no rules codified (file at 53) | retro (phase 1) | **DROP** — superseded by phase 2 (rules #54–#56 codified) |
| Epic 31 phase-2 retro action #1 — burn-down story, now ~47 items | retro (phase 2) | **INCLUDE** — this story |
| Epic 31 phase-2 retro action #2 — publish decision for `@iris-mcp/*` | retro (phase 2) | **DEFER** — Project Lead decision, not code; re-surface at end-of-epic merge gate (also gates `31-4-7`'s publish-time decisions) |
| Epic 31 phase-2 retro action #3 — find a Copilot user for the AC 31.4.4 residual | retro (phase 2) | **DEFER** — external dependency (no Copilot user on the project); recorded residual risk, not actionable in code |
| Epic 31 phase-2 retro action #4 — triage `31-7-1` (CSRF preflight warning) | retro (phase 2) | **INCLUDE** — item `31-7-1` in this story |
| 44 carried-open ledger items (below) | deferred-work.md | **INCLUDE — ALL** (Rule #37: re-deferral not an allowed outcome) |

**Triage tally (mechanical):** 4 items INCLUDE-as-story/retro · 44 items INCLUDE-as-ledger · 2 DEFER · 1 DROP · 1 closed-with-evidence pre-gate.

## Ledger disposition plan (the 44 items)

Item text is abbreviated; `deferred-work.md` is the authoritative source for each item's full finding, location, and suggested resolution. Counts in parentheses = re-deferral count entering this story.

### Cluster A — Epic-30-own, tool visibility (4 items, count 2) — `packages/shared/src/tool-visibility*.ts`, `server-base.ts`

| # | Item | Guidance |
|---|---|---|
| 30-0-1 | `addTools()` dynamic-add bypasses named-preset roster curation | Likely closed-by-decision (zero production callers, `assertPresetCoverage` structurally forbids bad rosters) or a small guard; decide explicitly |
| 30-0-3 | AC 30.0.4 back-compat capstone snapshot transcribed from spec §2.5, not source-derived | Re-derive the snapshot from SOURCE (Rule #36 oracle discipline) or close-with-evidence that the per-leaf gates already cover the property |
| 30-0-4 | Spec §2.2 "config hiding EVERY package tool ⇒ startup warning" not implemented | Implement the warning + test, or close-by-decision amending the spec |
| 30-2-1 | Hidden-name leak assertions use substring matching | Mechanical fix to exact-match assertions (test-only) or close-by-decision with collision-proof argument |

### Cluster B — Server Manager source & profiles (13 items) — `packages/shared/src/server-manager-source.ts`, `profiles.ts`

| # | Item | Count | Guidance |
|---|---|---|---|
| 31-0-5 | `pathPrefix` not validated for `?`/`#`/`//`/`:`/missing leading slash — malformed authority possible | 2 | Warn-and-ignore invalid prefixes + fixture rows (per item's suggested resolution) |
| 31-1-2 | "Rescue" may change the connection TARGET (host/port/username wholesale) | 2 | **Decide ONCE with 31-3-3** (AC 32.3.4): drop the rescue (first-file-wins) or restrict to matching targets; fixture proving the chosen rule |
| 31-1-3 | No aggregate startup budget for credential helper (10s × N profiles, blocks event loop) | 2 | Aggregate budget or closed-by-decision (documented cost, opt-in feature, `IRIS_SM_SERVERS` mitigation) |
| 31-1-5 | Pending-resolution debug line counts pre-filter entries | 2 | Move summary post-filter into `loadProfileRegistry` or reword; small fix |
| 31-3-1 | `required` starts with zero SM profiles when all discarded by NAME COLLISION | 1 (MED) | **Decide ONCE with 31-4-4** (AC 32.3.4): (a) post-filter empty ⇒ throw, or (b) document collisions out of scope; amend AC 31.0.3 to match |
| 31-3-2 | Parser-level silent drops (non-object, no `webServer`, blank host) invisible to `required` | 1 (MED) | `fileLabel` param + per-entry `logger.warn` naming file+server+reason; fixture per drop reason |
| 31-3-3 | Terminal `"invalid"` on first sighting never reconsidered; escalates to hard failure under `required` | 1 | **Decide ONCE with 31-1-2**: soften message or allow valid-definition rescue with warning |
| 31-3-4 | `sourceFile` discloses OS account name / workspace dir to the MCP client | 1 | Keep-full-path decision already recorded + docs honest; likely **closed-by-decision** (opt-out only "if a user asks" — record that explicitly) |
| 31-3-5 | `sourceFile` relative when operator supplies relative paths | 1 | `path.resolve` candidates in `discoverSettingsFiles`; update fixtures |
| 31-3-6 | `IRIS_SM_SERVERS` set-but-empty means import-ALL (widest possible) | 1 | Convention decision: distinguish unset vs set-empty + warn, or closed-by-decision matching suite-wide empty-string convention |
| 31-3-7 | `webServer.host` with URL userinfo lands verbatim in `baseUrl`/roster | 1 | Reject `@`/`/`/whitespace in `mergeProfile` host validation — **Rule #19 surface** (touches `IRIS_PROFILES` contract + error text); back-compat proof required |
| 31-3-8 | Epic capstone not re-runnable in default suite | 1 | Keychain-free process-level gate in `packages/iris-mcp-all` (Rule #45): launch built server with settings fixture, assert roster gains/loses SM profile with the switch |
| 31-3-9 | `packages/shared/README.md` zero mentions of IRIS_SERVER_MANAGER/CLI + CWD-opt-in decision | 1 | Docs section + record the CWD-opt-in decision (Epic 32 planning owns it per the item; `IRIS_GOVERNANCE_FILE` raises the same trust question in Story 32.0) |

### Cluster C — credentials CLI (6 items, count 2) — `packages/shared/src/cli/credentials.ts`

| # | Item | Guidance |
|---|---|---|
| 31-2-1 | `test --connect` validates the registry password, not the chain-resolved credential | Surface `connect.credentialSource`, or amend AC 31.2.1 to probe the chain-resolved credential; fixture where env and keychain differ |
| 31-2-2 | `redactSecret` exact-substring only (no base64/URL-encoded variants) | Conditional on error-shape change that doesn't exist — likely **closed-by-decision** (no live reproducing path; adding variants risks over-redaction) |
| 31-2-3 | `connect.ok: false` conflates "probe failed" and "probe never ran" | Make `ok` nullable + set `attempted` from actual stage; update the three payload assertions together |
| 31-2-4 | `set` prints same message for create vs silent replace | `KeyringPort.exists(): boolean` (no value read) + "Replaced the existing password" message |
| 31-2-5 | `readStdinPassword` unbounded allocation on misdirected pipe | 64 KiB cap + exit 2 naming the cap; fixture past the cap |
| 31-2-6 | UTF-16LE stdin stored NUL-interleaved, reported as success | Reject on U+0000 with exit 2 naming UTF-16 as likely cause (reject, don't transcode); UTF-16LE fixtures ±BOM |

### Cluster D — extension `extensions/iris-mcp-launcher/` (20 items)

| # | Item | Count | Guidance |
|---|---|---|---|
| 31-4-1 | Concurrent `getSession` calls not coalesced (stacked modal prompts) | 0 (MED) | In-flight promise cache keyed by server, evicted on settle; `Promise.all` test asserting single `getSession`. First check the GUI smoke record / VS Code prompt serialization (AC 32.3.3) |
| 31-4-2 | No refresh mechanism (`onDidChangeMcpServerDefinitions` etc.) | 0 (MED) | **Decide with 31-5-4**: either the refresh story (EventEmitter + config listener + password flush) or close-by-decision keeping documented reload semantics |
| 31-4-3 | Empty username passed straight through (takes down all profiles under `combineProfiles`) | 0 (MED) | Decide (a) refuse-with-message vs (b) documented passthrough; test per branch |
| 31-4-4 | `default`-named server under `combineProfiles` silently shadows reserved default | 0 (MED) | **Decide ONCE with 31-3-1** (AC 32.3.4); cheapest honest: detect + warn naming shadowing + remedy, mirroring the suite-side notice |
| 31-4-5 | Auth scope array `[serverName, spec.username ?? ""]` may miss cached sessions | 0 (MED) | **AC 32.3.3 empirical**: check the GUI smoke record for the no-username case; only change scopes with evidence |
| 31-4-6 | `CancellationToken` ignored in both provider callbacks | 0 | Accept token, check at loop tops, return undefined silently; fold with 31-4-1 (same call path) |
| 31-4-7 | No `cwd` + unpinned `npx -y` (shadowing + version drift) | 0 | Publish-time pair of decisions (relates to retro action #2); minimum: neutral `cwd` + `packageVersion` setting, or closed-by-decision documented |
| 31-4-8 | `extension.exports` cached without shape validation | 0 | Duck-type before caching, no-cache on mismatch + dedicated message |
| 31-5-1 | No Extension-Host (`@vscode/test-electron`) tier — Rule 3 real-runtime gap | 0 (HIGH→reduced) | Compensating control SATISFIED per the 2026-07-26 GUI smoke record + 31-6's real-runtime test; terminal options: stand up the tier (own effort) or **closed-by-decision** naming the two compensating controls |
| 31-5-2 | Status bar counts raw `settings.servers.length`, not registered definitions | 0 | Product decision (raw vs effective) + update pinning test; decide alongside 31-5-3 |
| 31-5-3 | Uncheck-all writes `[]` = expose ALL (inverse of gesture) | 0 | Confirm-before-empty or explicit "expose none" representation; settings-contract decision with 31-5-2 |
| 31-5-4 | `onDidChangeMcpServerDefinitions` never fired (reload required) | 0 | AC 31.5.6 deliberately specifies reload semantics — amend the AC first (skill Rule 5) or **close-by-decision**; decide with 31-4-2 |
| 31-5-5 | `$(…)` in server names renders as theme icon in QuickPick | 0 | AC 32.3.3: verify empirically whether an escape is honored before escaping; else closed-by-decision (cosmetic, own-config names) |
| 31-5-6 | Both source-file rosters non-recursive (future `src/sub/` invisible to guards) | 0 | Mechanical: `readdirSync({recursive:true, withFileTypes:true})` excluding `__tests__` + nested-file test |
| 31-6-1 | Two warnings re-fire on every `providePlannedDefinitions()` call | 0 (MED) | One dedupe set keyed by warning identity covering all three warnings; repeated-provide test |
| 31-6-2 | Synchronous `fs` validation blocks extension host on UNC/network paths (measured 1281 ms) | 0 (MED) | `fs/promises` + `Promise.all`; test asserting non-serial validation |
| 31-6-3 | `command: "node"` resolved from extension-host PATH, never validated | 0 (MED) | Amend AC 31.6.1 (skill Rule 5) then `process.execPath` + `ELECTRON_RUN_AS_NODE=1`, or explicit resolvability probe with reason string |
| 31-6-4 | Status bar tooltip claims dev mode even when zero definitions registered | 0 | Pass registered-count into `buildStatusBarState`; word dev-mode line from it |
| 31-6-5 | Live IRIS credentials hardcoded in committed `localSpawnIntegration.test.ts` | 0 | Read from `IRIS_TEST_*` env with current values as fallback; repo-wide `__tests__/` containment decision recorded |
| 31-6-6 | Extension unit tests hard-require monorepo `packages/` tree on disk | 0 | Keep disk oracle (Rule #51), narrow the README claim to build-time/runtime dependency |

### Cluster E — cross-cutting (1 item)

| # | Item | Guidance |
|---|---|---|
| 31-7-1 | CSRF preflight warning on every server start (pre-existing, blocks nothing) | **AC 32.3.3 probe-first, do NOT fix blind**: determine whether Atelier is expected to return `X-CSRF-Token` on this IRIS configuration (live probe + docs); then suppress-when-legitimately-absent, or explain the condition in the message, or close-with-evidence |

**Plan tally (mechanical):** 4 + 13 + 6 + 20 + 1 = **44 items**.

## Tasks / Subtasks

- [ ] Task 1: Confirm the authoritative open set (AC: 1, 5)
  - [ ] Re-derive the 44-item list from `deferred-work.md` mechanically (grep per-item IDs); reconcile against the clusters above; investigate and reconcile any mismatch before touching code (Rule #51)
  - [ ] Verify no item is already moot beyond `31-4-9` (check the two post-Epic-31 coverage-gap fix sections and the GUI-smoke section against each candidate)
- [ ] Task 2: Cluster A — Epic-30 tool-visibility items (AC: 1, 2)
- [ ] Task 3: Cluster B — Server Manager source & profiles, incl. the two paired decisions (AC: 1, 2, 4)
- [ ] Task 4: Cluster C — credentials CLI (AC: 1, 2)
- [ ] Task 5: Cluster D — extension items, incl. empirical checks from the GUI smoke record (AC: 1, 2, 3, 4)
- [ ] Task 6: Cluster E — `31-7-1` CSRF probe + disposition (AC: 1, 3)
- [ ] Task 7: Ledger mirror + mechanical tally (AC: 5)
  - [ ] Append the disposition table to `deferred-work.md` with per-item evidence references
  - [ ] Derive every tally by grep/awk over the disposition column; cross-check prose counts; state the derivation
- [ ] Task 8: Back-compat gates (AC: 6)
  - [ ] `pnpm turbo run build test lint type-check` green; extension `npx tsc --noEmit` + `npx vitest run` green
  - [ ] `pnpm gen:governance-baseline:check` exit 0, frozen `1e62c5ad5bf7` byte-unchanged; tool counts unmoved
  - [ ] `git diff --stat` shows no `bootstrap-classes.ts` / `src/ExecuteMCPv2/**` change and no binary/NUL-byte files (Rule #55 verification habit)

## Dev Notes

### Authoritative item list & discipline

- `deferred-work.md` sections "Epic 31 retro-review gate (2026-07-25)" through "Epic 31 GUI smoke (2026-07-26)" are the authoritative per-item records (lines ~1248–1646). Every disposition MUST cite the item's own suggested resolution or explain why a different terminal call is correct.
- **Rule #48 (higher bar)**: every "resolved" code fix is proven LIVE or mutation-verified (revert → red → restore), with the evidence named in the ledger entry. Epic 26 lesson: a burn-down "resolved" fix was itself defective — only live HTTP caught it.
- **Rule #16 probe-first**: `31-4-5` (VS Code authentication session scope keying — check the real `@types/vscode` declaration + the GUI smoke record), `31-7-1` (Atelier `X-CSRF-Token` expectation — live probe against the local instance + InterSystems docs), `31-5-5` (QuickPick `$(…)` escape — empirical only).
- **Rule #55**: write all ledger/story content with the file-writing tools, never shell heredocs; after any scripted generation, parse-check and `git diff --stat` verify.
- **Rule #36 oracle discipline**: expected test values come from RUNNING the real surface (e.g. 30-0-3's snapshot re-derivation), never from re-transcribing a spec.
- Closed-by-decision is a legitimate terminal disposition — but the DECISION must be recorded with its reasoning in the ledger entry, not implied.

### Constraints (all fixes)

- Strictly additive/back-compat: no governance key changes, no tool count changes (Rule #31), frozen baseline `1e62c5ad5bf7` untouched (Rules #23/#25 — run the `:check` ONLY, never the bare generator).
- `31-3-7` touches the `IRIS_PROFILES` contract (host validation error text) — a Rule #19 surface; the back-compat gate must be re-proven after that fix.
- AC amendments (31.0.3 for 31-3-1; 31.5.6 for 31-5-4; 31.6.1 for 31-6-3; possibly 31.2.1 for 31-2-1) follow skill Rule 5: amend `epics.md` IN PLACE with original wording + rationale + date — never work around an AC with code comments.
- The extension (`extensions/iris-mcp-launcher/`) is OUTSIDE the pnpm workspace — run its own `npx tsc --noEmit` / `npx vitest run`; root `pnpm turbo` does not cover it.
- No `bootstrap-classes.ts` / `BOOTSTRAP_VERSION` / `src/ExecuteMCPv2/**` change expected; HALT to the lead if one becomes necessary (AC 32.3.6).

### Previous-story intelligence (prior burn-downs 22.1 / 26.4 / 29.3)

- Story 29.3 burned down 41 items in one story — 44 is in precedent. Its defect: a hand-counted tally off by 6, caught by QA's mechanical recount → Rule #51. Derive, never hand-count.
- Story 26.4's own review found one of its "resolved" fixes defective (CR 26.4-R1) — mutation-verify or live-prove every fix (Rule #48), and expect the review to re-verify dispositions, not accept them.
- Batch by file, not by item ID, to avoid edit collisions: `server-manager-source.ts` (31-0-5, 31-1-2, 31-1-5, 31-3-2, 31-3-3, 31-3-5, 31-3-6), `profiles.ts` (31-3-1, 31-3-7), `credentials.ts` (31-2-1, 31-2-3..6), extension `serverDefinitionProvider.ts` / `extension.ts` / `credentials.ts` / `selectServers.ts` / `env.ts` clusters.

### Project Structure Notes

- Code surfaces: `packages/shared/src/server-manager-source.ts`, `packages/shared/src/profiles.ts`, `packages/shared/src/credential-chain.ts`, `packages/shared/src/cli/credentials.ts`, `packages/shared/src/tool-visibility.ts`, `packages/shared/src/server-base.ts`, `packages/iris-mcp-all/src/__tests__/` (31-3-8 gate), `extensions/iris-mcp-launcher/src/*.ts`, `packages/shared/README.md` (31-3-9).
- Doc surfaces: `deferred-work.md` (disposition mirror), `epics.md` (any AC amendments), READMEs per item.

### References

- [Source: _bmad-output/implementation-artifacts/deferred-work.md#Epic 31 retro-review gate through Epic 31 GUI smoke]
- [Source: _bmad-output/implementation-artifacts/epic-31-retro-phase2-2026-07-26.md#Action items]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 32.3]
- [Source: .claude/rules/project-rules.md#37 / #48 / #16 / #51 / #55]

## Dev Agent Record

### Agent Model Used

(pending)

### Debug Log References

### Completion Notes List

### File List
