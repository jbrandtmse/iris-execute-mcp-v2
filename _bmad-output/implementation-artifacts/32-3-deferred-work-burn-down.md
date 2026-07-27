# Story 32.3: Deferred-Work Ledger Burn-Down (Rule #37)

Status: done

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

- [x] Task 1: Confirm the authoritative open set (AC: 1, 5)
  - [x] Re-derive the 44-item list from `deferred-work.md` mechanically (grep per-item IDs); reconcile against the clusters above; investigate and reconcile any mismatch before touching code (Rule #51)
  - [x] Verify no item is already moot beyond `31-4-9` (check the two post-Epic-31 coverage-gap fix sections and the GUI-smoke section against each candidate)
- [x] Task 2: Cluster A — Epic-30 tool-visibility items (AC: 1, 2)
- [x] Task 3: Cluster B — Server Manager source & profiles, incl. the two paired decisions (AC: 1, 2, 4)
- [x] Task 4: Cluster C — credentials CLI (AC: 1, 2)
- [x] Task 5: Cluster D — extension items, incl. empirical checks from the GUI smoke record (AC: 1, 2, 3, 4)
- [x] Task 6: Cluster E — `31-7-1` CSRF probe + disposition (AC: 1, 3)
- [x] Task 7: Ledger mirror + mechanical tally (AC: 5)
  - [x] Append the disposition table to `deferred-work.md` with per-item evidence references
  - [x] Derive every tally by grep/awk over the disposition column; cross-check prose counts; state the derivation
- [x] Task 8: Back-compat gates (AC: 6)
  - [x] `pnpm turbo run build test lint type-check` green; extension `npx tsc --noEmit` + `npx vitest run` green
  - [x] `pnpm gen:governance-baseline:check` exit 0, frozen `1e62c5ad5bf7` byte-unchanged; tool counts unmoved
  - [x] `git diff --stat` shows no `bootstrap-classes.ts` / `src/ExecuteMCPv2/**` change and no binary/NUL-byte files (Rule #55 verification habit)

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

claude-k3[1m] (BMAD dev-story skill, Epic Cycle dev stage)

### Debug Log References

- Rule #51 open-set derivation: `grep -oE '\b(30-0-[0-9]|30-2-1|31-[0-7]-[0-9])\b' deferred-work.md | sort -u` — 48 unique IDs; the 44-item plan reconciled exactly (clusters 4+13+6+20+1) plus 31-4-9 (beyond-the-44 sanctioned open AC, closed-with-evidence).
- Mechanical test-delta derivation: `git diff -U0 | grep -cE '^\+.*\bit\('` per test file (reported below).
- 31-7-1 live probe: `node -e "fetch('http://localhost:52773/api/atelier/', {method:'HEAD', headers:{Authorization}})"` — full header dump, `x-csrf-token` absent (IRIS 2026.1, 2026-07-26).
- 31-5-5 probe: VS Code source `vs/base/browser/ui/iconLabel/iconLabels.ts` (GitHub main) — the label regex captures a preceding backslash; escaped matches render as literal text.
- Mutation-verification log (revert → red → restore, per Rule #48): 30-0-3 (bogus snapshot name ⇒ drift gate red), 30-2-1 (`visibleGovernedKeys` leak ⇒ 5 red), Cluster C combined pre-fix revert (9 CLI tests red), 31-3-8 (unset-default off→auto ⇒ process-gate Run B red), extension batch of 9 mutations (20 red across all nine targets: 31-4-1/31-4-3×2/31-4-4/31-4-6/31-6-1×2/31-6-2/31-6-3/31-5-2/31-5-3×2/31-5-5/31-6-4), 31-4-8 delete-style revert + 31-5-6 flat-roster revert (2 guard pins red), 31-7-1 (new test red against HEAD http-client.ts). Everything else resolved was driven test-first (confirmed red before implementation).
- Notable mid-flight incidents (all caught by verification, none shipped): a stray literal NUL byte introduced into `cli/credentials.ts` during an edit was converted to the ASCII `""` escape and the file verified NUL-free + git-text (Rule #55); an over-broad string repair temporarily corrupted the extension test helper `buildPackage` (hardcoded `iris-dev-mcp`) — caught by 3 failing fs-validation tests and restored.

### Completion Notes List

- **AC 32.3.1 (terminal disposition for all 44):** ✅ 34 resolved · 10 closed-by-decision · 0 re-deferred, plus 31-4-9 closed-with-evidence (45 rows in the `deferred-work.md` mirror; tally derived mechanically and cross-checked — see the ledger section "Story 32.3 — Rule #37 BURN-DOWN").
- **AC 32.3.2 (Rule #48 bar):** ✅ every "resolved" fix names its evidence in the ledger — red-green test-first cycle or an explicit revert→red→restore mutation (log above); 31-3-8 and 31-6-3 carry LIVE evidence (real child process, real MCP handshake, live IRIS).
- **AC 32.3.3 (probe-first):** ✅ 31-4-5 (probed `@types/vscode@1.125.0` getSession declarations + the 2026-07-26 GUI smoke record — no no-username case exercised — + the mandated reference implementation; closed-by-decision keeping the reference-matching scopes, recorded), 31-5-5 (probed VS Code source — an escape IS honored; resolved with it), 31-7-1 (live HEAD probe + InterSystems docs — token legitimately absent on a stock Atelier endpoint; warn→debug with the condition named), 31-4-1 (GUI smoke record checked — the stacking case was not exercised; resolved on the unit test). No disposable probe artifacts remain (probes were one-shot node commands / web fetches / deleted scratch tests).
- **AC 32.3.4 (paired decisions ONCE):** ✅ PD-1 (31-1-2+31-3-3) first-file-wins uniformly; PD-2 (31-3-1+31-4-4) reserved-name never silently shadowed on either side of the process boundary; PD-3 (31-4-2+31-5-4) keep AC-31.5.6 reload semantics. Each recorded in the ledger AND at the code site.
- **AC 32.3.5 (ledger mirror + mechanical tally):** ✅ disposition table appended to `deferred-work.md` with per-item evidence; every tally derived by row-filter over the disposition column (34/10/0 + 1), cross-checked against the prose count.
- **AC 32.3.6 (back-compat gates):** ✅ `pnpm turbo run build test lint type-check` 25/25 green; extension `npx tsc --noEmit` clean + `npx vitest run` 228/228 across 12 files; `pnpm gen:governance-baseline:check` (`:check` ONLY) exit 0 with frozen `1e62c5ad5bf7` / 141 / 201 / 60 all unchanged and `governance-baseline.ts`/`baseline-classifications.ts`/`bootstrap-classes.ts` git-clean; no tool count moved (Rule #31); NO `bootstrap-classes.ts`/`BOOTSTRAP_VERSION`/`src/ExecuteMCPv2/**` change (no ObjectScript was needed — no HALT); `git diff --stat` shows text-only changes, no binary/NUL-byte files.
- **AC amendments (skill Rule 5):** epics.md amended IN PLACE with original wording + rationale + date: AC 31.0.3 (fourth `required` condition, for 31-3-1) and AC 31.6.1 (interpreter as implementation detail, for 31-6-3). AC 31.2.1 did NOT need amendment (the item's field-surfacing option was taken). AC 31.5.6 deliberately NOT amended (PD-3 keeps its semantics).
- **Test counts (mechanically derived):** `@iris-mcp/shared` 59 files / **1139** tests (was 1103 post-Epic-31-fixes, +36 net: 30 added `it(` blocks less 4 removed across 5 files + 5 new `it.each` table rows + runtime expansion of the two new `it.each`s); `@iris-mcp/all` 12 files / **84** (+2: the snapshot drift gate and the process-level gate); extension 12 files / **228** (was 162/11 at Story 31.5 close; +66 cumulative through Story 31.6 and this story — this story adds 25 net `it(` blocks across 5 files plus the nested-roster and packaging pins).
- **Behavior changes shipped:** first-file-wins precedence (the Story-31.1 rescue removed), `required` all-collided throw, `mergeProfile` host hardening, pathPrefix validation, parser-drop visibility, absolute `sourceFile` candidates, post-filter pending-resolution summary, CLI (`connect.credentialSource` + nullable `connect.ok` + create-vs-replace + 64 KiB stdin cap + UTF-16 rejection), extension (credential coalescing, cancellation token, empty-username refusal, reserved-name warning, effective status-bar count, confirm-before-empty, theme-icon escaping, warning dedupe, async fs validation, `process.execPath`+`ELECTRON_RUN_AS_NODE`, IRIS_TEST_* test credentials), and the CSRF warn→debug. A changeset (`.changeset/server-manager-first-file-wins.md`) records the suite-side behavior changes, mirroring the 31-0-2 precedent.

### File List

**Suite (packages/):**
- `packages/shared/src/server-manager-source.ts` (31-0-5, 31-1-2, 31-3-2, 31-3-3, 31-3-5, 31-1-5)
- `packages/shared/src/profiles.ts` (31-3-1, 31-3-7, 31-1-5)
- `packages/shared/src/server-base.ts` (30-0-1 doc decision, 30-0-4 warning)
- `packages/shared/src/cli/credentials.ts` (31-2-1, 31-2-3, 31-2-4, 31-2-5, 31-2-6)
- `packages/shared/src/http-client.ts` (31-7-1)
- `packages/shared/src/__tests__/pre-feature-tool-snapshot.ts` (NEW — 30-0-3 single-sourced snapshot)
- `packages/shared/src/__tests__/tool-visibility.test.ts` (30-0-4 tests)
- `packages/shared/src/__tests__/tool-visibility-backcompat.test.ts` (30-0-3 import)
- `packages/shared/src/__tests__/tool-visibility-surfacing.test.ts` (30-2-1 exact-match)
- `packages/shared/src/__tests__/server-manager-source.test.ts` (Cluster B tests)
- `packages/shared/src/__tests__/profiles.test.ts` (31-3-1, 31-3-7, 31-1-5 tests)
- `packages/shared/src/__tests__/credentials-cli.test.ts` (Cluster C tests)
- `packages/shared/src/__tests__/credentials-cli-chain-agreement.test.ts` (31-2-4 fake)
- `packages/shared/src/__tests__/http-client.test.ts` (31-7-1 test)
- `packages/shared/README.md` (31-3-9 section; 31-1-3/31-3-6 decision rows)
- `packages/iris-mcp-all/src/__tests__/tool-visibility-snapshot-drift.test.ts` (NEW — 30-0-3 drift gate)
- `packages/iris-mcp-all/src/__tests__/server-manager-process-gate.test.ts` (NEW — 31-3-8 process gate)
- `.changeset/server-manager-first-file-wins.md` (NEW — behavior-change record)

**Extension (`extensions/iris-mcp-launcher/`):**
- `src/serverDefinitionProvider.ts` (31-4-1, 31-4-4, 31-4-6, 31-6-1, 31-6-2, 31-6-3, 31-5-2 support)
- `src/credentials.ts` (31-4-3)
- `src/selectServers.ts` (31-5-2, 31-5-3, 31-5-5, 31-6-4)
- `src/extension.ts` (31-4-8, 31-4-6 threading, 31-5-2/31-5-3 wiring, 31-6-4 refresh)
- `src/types.ts` (CancellationTokenLike)
- `src/__tests__/serverDefinitionProvider.test.ts`, `src/__tests__/credentials.test.ts`, `src/__tests__/selectServers.test.ts`, `src/__tests__/packaging.test.ts`, `src/__tests__/containment.test.ts`, `src/__tests__/localSpawnIntegration.test.ts`
- `README.md` (31-6-6 narrowing; 31-6-3 doc accuracy)

**Planning/ledger artifacts:**
- `_bmad-output/implementation-artifacts/deferred-work.md` (disposition mirror)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status sync)
- `_bmad-output/planning-artifacts/epics.md` (AC 31.0.3 + AC 31.6.1 amendments)
- `_bmad-output/planning-artifacts/architecture.md` (J1 decision record)
- `_bmad-output/implementation-artifacts/32-3-deferred-work-burn-down.md` (this story record)

### Review Findings

Code review 2026-07-26 (bmad-code-review, reviewer-driven adversarial verification + 3 background layers). Reviewer independently re-verified the burn-down claims before actioning anything: mechanical recount of the ledger disposition column (45 rows = 34 RESOLVED + 10 CLOSED-BY-DECISION + 1 CLOSED-WITH-EVIDENCE; all 45 expected item IDs present exactly once; zero re-deferred); `pnpm gen:governance-baseline:check` (`:check` only) exit 0 with frozen `1e62c5ad5bf7` / 141 / 201 / 60 unchanged; NUL/binary scan over every changed file clean; no `bootstrap-classes.ts` / `BOOTSTRAP_VERSION` / `src/ExecuteMCPv2/**` change; epics.md amendments (AC 31.0.3, AC 31.6.1) confirmed in-place with original wording + rationale + date (skill Rule 5); architecture.md J1 confirmed consistent with the implemented CWD-discovery behavior; the Story-31.1 rescue confirmed REMOVED (no orphaned rescue code paths — remaining "rescue" mentions are historical comments) with the behavior change documented in `.changeset/server-manager-first-file-wins.md`; 31-3-7 host hardening confirmed to keep the source label (`IRIS_PROFILES`) in its error text and never echo the received value. One fix per cluster was mutation-verified BY THE REVIEWER (revert → red → restore): A (30-0-4 warning, 2 red), B (31-3-7 host regex, 5 red), C (31-2-5 64 KiB cap, 1 red), D (31-4-1 coalescing, 1 red), E (31-7-1 warn→debug, 1 red). Gates re-run post-patch: `pnpm turbo run build test lint type-check` 25/25; extension `npx tsc --noEmit` clean + full vitest green 4 consecutive runs (13 files / 235 tests).

**3-layer background review:** the Blind Hunter / Edge Case Hunter / Acceptance Auditor subagents were launched in parallel with the full assembled diff (5,929 lines incl. untracked files) but did not return findings within three follow-up windows (~60 min) — recorded as failed layers per the workflow. The reviewer-driven pass above covered each layer's mandate directly (blind: diff-only logic hunt; edge: branch/boundary walk + vscodeMock-vs-`@types/vscode@1.125.0` Rule #54 check; auditor: per-AC verification incl. the mechanical tally, Rule #48 mutation sampling, PD uniformity, Rule 5/Rule 5-adjacent planning-artifact checks).

**Patches APPLIED inline (all verified red→green or by targeted rerun; counts: 6 patched, 0 deferred, 0 dismissed, 0 decision-needed):**

- [x] [Review][Patch] **MEDIUM — `providePlannedDefinitions` api-unavailable + could-not-read-settings warnings bypassed the 31-6-1 dedupe** [`extensions/iris-mcp-launcher/src/serverDefinitionProvider.ts`] — 31-5-2's status-bar refresh replans on EVERY `onDidChangeConfiguration`, so a user without Server Manager (or with a broken settings read) got a fresh toast per config change and per MCP re-enumeration — the exact re-fire class 31-6-1 burned down ("one dedupe set … covering all three warnings" left these two out). Routed both through `warnOnce`; 2 new repeated-provide tests (56/56 green).
- [x] [Review][Patch] **MEDIUM — the 31-6-2 "both package probes in flight at once" test was flaky under full-suite parallel load** [`extensions/iris-mcp-launcher/src/__tests__/serverDefinitionProvider.test.ts`] — reproduced 2/9 full-suite failures (`expected 1 to be >= 2`): the "release-as-they-arrive behind a bounded 50-tick loop" formulation raced worker contention. Redesigned deterministically: repo-level stats pass straight through; per-package dist probes are HELD until the test releases them, so two unsettled probes at once is the fan-out proof by construction, with a 10s wall-clock bound that fails legibly (never hangs) on a serial implementation. Mutation-verified: serial `for…await` production ⇒ red.
- [x] [Review][Patch] **MEDIUM — the 31-5-6 nested-roster proof created its fixture inside the real `src/` tree, racing parallel test files' recursive `src/` scans** [`extensions/iris-mcp-launcher/src/__tests__/containment.test.ts`] — reproduced in-review: `packaging.test.ts`'s recursive `readdirSync` enumerated `src/tmp-31-5-6-nested/probe.ts` in a parallel worker and its `readFileSync` then hit ENOENT when containment's `finally` deleted it (TOCTOU). `enumerateSourceFiles` is now parameterized on the root; the recursion/`__tests__`-exclusion proof runs against a fixture tree in the OS temp dir; nothing writes under `src/` during tests. 4 consecutive full-suite runs green post-fix (observed pre-fix flake rate: 3 failing runs in 12 full-suite runs, each one of the two races).
- [x] [Review][Patch] **LOW — stale rescue-era comments contradicted PD-1** [`packages/shared/src/server-manager-source.ts`] — the `nameStates` field doc still said `"unresolved"` may be overwritten by a later, lower-precedence entry that resolves", and the counting comment referenced "the 31-0-1 rescue mechanism below" — both describing the removed behavior. Reworded to the first-file-wins semantics (source-only comments; 182/182 SM+profiles tests re-run green).
- [x] [Review][Patch] **LOW (Rule #54) — `vscodeMock.authentication.getSession` resolved `undefined` for ALL option shapes** [`extensions/iris-mcp-launcher/src/__tests__/vscodeMock.ts`] — with `createIfNone`/`forceNewSession` the real API resolves a session or REJECTS (user cancel); resolving `undefined` there is a shape the real API cannot produce — the exact Epic-31 31.4 HIGH pattern, and the mock's header claimed Rule #54 compliance. The mock now resolves `undefined` only for silent probes, rejects prompting shapes unless a test scripts `mockState.nextSession`, and documents the contract in its header. Latent only (no current test drives a prompting call through the mock — the 31-4-3 activation test asserts `getSession` never runs); fixed so the FIRST future prompting-path test cannot inherit the impossible shape. tsc clean; full suite green.
- [x] [Review][Patch] **LOW — CLI human surface said "connect FAILED" for a probe that never ran** [`packages/shared/src/cli/credentials.ts`] — a registry-mapping failure (`attempted:false, ok:null`) printed "connect FAILED — …", contradicting 31-2-3's "never ran is not failed" on the human surface (the JSON payload was already correct). Now prints "connect SKIPPED" when `attempted` is false; the one affected test updated; the genuine connect-stage failure keeps "connect FAILED". 84/84 CLI tests green.

**Reviewer notes (no action):** Rule 3 (real-runtime evidence) is satisfied — QA's `server-manager-precedence-gate`/`credentials-cli-process-gate`/`server-manager-process-gate` drive the BUILT servers through real MCP handshakes against live IRIS, and `localSpawnIntegration` spawns the real planned `process.execPath` command; all RAN (not skipped) in the reviewer runs. Rule 5 (NFR tripwire) — the two AC amendments are proper in-place amendments, not workarounds. Rule 6 (ADR) — no Accepted ADR constrains these ACs; J1 was verified consistent. Rule 1 (Integration ACs) — the "no consumers" declaration is truthful: the one new export (`KeyringPort.exists`) is consumed by `cmdSet` itself (the code path its item names) and exercised by its regression tests plus QA's built-dist seam test. Every defer-bucket caution honored: ZERO new deferred items from this review, so the 44 carried items stay terminally disposed.

### Change Log

| Date | Version | Description | Author |
|------|---------|-------------|--------|
| 2026-07-26 | 1.0 | Story created (Rule #37 burn-down executing first in Epic 32; 44 carried items + 31-4-9) | Bob (SM) |
| 2026-07-26 | 1.1 | Implemented: all 44 carried items at terminal disposition (34 resolved / 10 closed-by-decision / 0 re-deferred) + 31-4-9 closed-with-evidence. Three paired decisions recorded (PD-1 first-file-wins; PD-2 reserved-name on both process-boundary sides; PD-3 keep reload semantics). AC 31.0.3 + AC 31.6.1 amended in epics.md; architecture decision J1 recorded. Gates: turbo build/test/lint/type-check 25/25, extension tsc + 228/228 vitest, governance-baseline:check exit 0 (frozen 1e62c5ad5bf7 unchanged), no tool-count/bootstrap/ObjectScript change. Status → review. | Dev (claude-k3[1m]) |
