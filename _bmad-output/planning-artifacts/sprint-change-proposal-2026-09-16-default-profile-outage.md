# Sprint Change Proposal — 2026-09-16 (an unreachable `default` profile exits the server at startup)

**Trigger:** Second beta-feedback defect — verbal report relayed by the Project Lead 2026-09-16: "the MCP server fails to start if the default server is down but the other registered servers are up." Analyzed by source reading and an empirical run against a closed local port (the shared instance was not touched, per the Lead's instruction). Full record: `docs/bugs-2026-09-16.md`.
**Facilitator:** Mary (Business Analyst) → correct-course · **Project Lead:** Developer
**Mode:** Batch (the mode the 2026-09-10 session used; the Lead's decisions collected at approval) · **Scope classification:** **Moderate** (new single-story epic; PRD/architecture/epics/sprint-status updated; one recorded exception to Rule #37; no MVP change, no rollback)
**Approval:** APPROVED 2026-09-16 (Project Lead), with the §3 lead decisions resolved as follows — **L-1** `epic37` directly off `main` (identical tree to the wave-5 tip); **L-2** non-fatal everywhere, single-server included (option A as written); **L-3** no strictness knob; **L-4** discovery reachability field deferred; **L-5** **Epic 37 = Story 37.1 ONLY** — the 37.0 gate is skipped by Lead direction at kickoff and no burn-down runs in this epic (Rule #37 exception recorded in §2, §4.1, §4.2 and §4.7); `36-4-CR-1` stays deferred to its own pre-publish story; **L-6** `@iris-mcp/shared` patch. §4.1–§4.7 applied in-session; Story 37.1 file created with this session's source anchors and closed-port run as its lead pre-story probe section.

---

## 1. Issue Summary

`McpServerBase.start()` (`packages/shared/src/server-base.ts`) eagerly creates the reserved `default` profile's HTTP client (`:2023`), runs `checkHealth` against it (`:2026-2034`) and, on rejection, logs `IRIS health check failed: …` and calls **`process.exit(1)`** — before the MCP transport is connected at `:2090`. Profiles registered through `IRIS_PROFILES` or Server Manager are established lazily on their first tool call (`getOrCreateClient` `:2166` → `establishProfile` `:2220`) and are never consulted at startup. So when the `default` instance is down, the process dies before it can accept a single MCP request, regardless of how many other profiles are healthy. The MCP client sees a server process that exited with code 1: "the server fails to start."

**Confirmed empirically without touching the shared instance** (built `iris-dev-mcp` dist of 2026-09-11, `default` → `127.0.0.1:9`, plus an `IRIS_PROFILES` entry `other`): exit code **1**, stderr `[ERROR] IRIS health check failed: Failed to connect to IRIS at 127.0.0.1:9. …`, no `Connected via stdio transport` line, and `other` was never probed. The `Fatal:` catch in each entry point (`packages/iris-dev-mcp/src/index.ts:31-34`) is never reached; the path is framework-level, so all five servers behave identically.

**The desired semantics already exist — for every profile except `default`.** The lazy path health-checks and negotiates on first touch; on failure it `drop()`s the client (`profiles.ts:708`) so the next call retries cleanly (AC 14.2.8), and `handleToolCall` (`:1506-1531`) converts the throw into the structured result `Could not connect to server profile "<name>": …` with `isError: true`. The JSDoc states the asymmetry outright: "only the default profile's startup failure is fatal" (`:2141`).

**Provenance.** Epic 14 architecture decision D1 (`architecture.md:396`): "The **default** profile's client is created eagerly at startup, preserving today's bootstrap/health-check/negotiation exactly." Story 14.1 Dev Notes (`14-1-multi-server-profiles-config-and-resolution.md:134`): "only the default profile's startup failure stays fatal." Commit `213756b`. This is a carried-over single-server behavior — before Epic 14, "IRIS is down" and "nothing to serve" were the same condition. Nothing in the PRD or architecture argues that a multi-profile process should die with its anchor; the failure path was simply never re-examined. Rule #19 protected the success path and froze the failure path with it.

**Secondary consequence (single-server installs):** because the failure is fatal there is no recovery path — an IRIS restart requires an MCP-server restart, even though the lazy path is already retryable.

**Not affected in itself:** `iris_server_profiles` never connects (README `:472`) — but it is unreachable too, because the process is gone. The `iris-mcp-credentials test --connect` CLI reuses `checkHealth` and correctly throws (a diagnostic; unchanged). **Ledger:** no `deferred-work.md` row covers default-profile reachability; the nearest, "[14.1 / MED] Non-default first-touch health-check failure caches the client but records no meta" (`:253`), was resolved by AC 14.2.8 and concerns non-default profiles only. The Epic 36 retro does not mention this report.

**Issue type:** Technical limitation discovered in beta use (pre-existing since Story 14.1; first surfaced by a real multi-instance user with one instance down).

---

## 2. Impact Analysis

### Epic Impact

- **Epic 36 (closed, retro'd 2026-09-11, merged to `main` as `2ed83ff`)** — untouched.
- **New Epic 37 — Beta Feedback Remediation: Startup Resilience With an Unreachable Default Profile.** Direct Adjustment: **one story, 37.1** (the fix). Project Lead decision **L-5** (2026-09-16): no 37.0 gate and no burn-down in this epic, so the beta user's fix ships without other work in front of it.
- **Rule #37 — exception recorded (must never be silent; Epic 36 retro §3.3).** `deferred-work.md:2939` records the Epic 36 gate's forward obligation: **36 items (7 MEDIUM · 29 LOW)** — Story 34.6 batch 19 (`34-6-CR-9`, `-12…-20`, `34-6-CR2-7…-15`), Story 34.7 batch 10 (`34-7-QA-1`, `34-7-CR-1…-9`), Story 34.8 batch 7 (`34-8-CR-1…-7`) — reach Rule #37 count 2, so "at the Epic 37 retro-review gate a further re-deferral of any of them would be the third consecutive, so Rule #37 mandates a burn-down story." The epic-cycle creates the N.0 gate automatically whenever the prior retro exists or the ledger has open items (`.claude/commands/epic-cycle.md:270-274`, `:399` — both true); it can only be skipped by Lead direction at kickoff (precedent: Stories 10.0 and 11.0, April 2026 — both before Rule #37 was codified on 2026-07-04, `23fb2ac`). With the gate skipped, NO triage event occurs in Epic 37: no item's count moves, the batch stays at count 2, and the obligation transfers unchanged to the **Epic 38** gate — where the 37 Epic-35-era items at count 1 also reach count 2, so Epic 38 faces 73 items at count 2 rather than 36. Under the strict reading applied at the 36.0 gate (`35-0-CR-C`) this is a Lead-owned exception to Rule #37, taken deliberately and recorded in four places (this proposal; the Epic 37 preamble in `epics.md`; the `sprint-status.yaml` comment; one dated line at the end of `deferred-work.md`) so the Epic 38 gate cannot miss it.
- **Epic 36 retro carries** (npm publish #4 post-beta; `34-8-CR-1` trigger #5; Kimi/Copilot/re-certification external blockers; the `36-4-CR-1` HIGH deferred by decision to "a dedicated story in a future epic" with its interim mitigation) transfer unreviewed to the Epic 38 gate. `36-4-CR-1` was described to the Lead in this session (silent bootstrap DOWNGRADE on version skew: the probe treats any hash difference as `stale` and force-redeploys all 29 classes — an older build reinstalls the pre-36.4 `Global.cls`; fix = monotonic sequence beside the hash + a `newer` probe status that refuses to redeploy + a surfacing tool field; footprint `Setup.cls` + generator + `bootstrap.ts` + 28 test files referencing the version/probe + docs; `BOOTSTRAP_VERSION` moves; live downgrade proof needs a disposable namespace or second instance, never the shared one; effort Medium-High) and kept OUT by decision L-5.
- No future epic becomes obsolete.

### Story Impact

- **New:** 37.1 only — full ACs in §4.1. Because there is no gate, the gate's per-epic duties that matter to this story (branch confirmation, Rule #57 arming, baseline re-measurement) are folded into AC 37.1.12.
- **No existing story is modified.** Story 14.1's "default stays fatal" clause is superseded by architecture record M1 (§4.4), not by editing Story 14.1.

### Artifact Conflicts

- **PRD** — FR111 ("no `IRIS_PROFILES` set → single default server, today's behavior") and FR112 stand. Nothing states what happens when a configured instance is unreachable; the Reliability NFR covers connection-loss *detection* ("within 2 seconds … with error code, message, recovery suggestion") but not process survival. **Add FR145 + one Reliability bullet** (§4.3).
- **Architecture** — D1's eager-default clause is not invalidated (the eager attempt stays), but its implicit "fatal" consequence is. One dated decision record following the H1–L1 convention: **M1 — a configuration error fails startup fast; an unreachable peer never does** (§4.4).
- **Epics** — new Epic 37 section appended after Epic 36 (§4.1), carrying the Rule #37 exception in its preamble.
- **`sprint-status.yaml`** — new Epic 37 block with ONE story key + the retro key (§4.2). No `37-0-…` key: `check-epics-sync.mjs` treats a missing `N-0-epic-N-1-deferred-cleanup` key as expected-absent only when the KEY exists without a section; an absent key with an absent section is simply nothing — clean.
- **`_bmad/custom/branch-naming.yaml`** — ACTIVE-branch comment block updated (§4.5; comment-only).
- **Bug record** — `docs/bugs-2026-09-16.md` already exists (untracked; written by this session's analysis pass, house convention). It gains a disposition footer (§4.6) and is `git add`ed.
- **`deferred-work.md`** — ONE dated Lead-decision section appended (§4.7). This departs from the "correct-course never edits the ledger" precedent for one reason: with no 37.0 gate there is no other mechanical place where the Epic 38 gate would read the transferred obligation. No count moves.
- **UI/UX** — not applicable (backend MCP suite). The `iris-mcp-launcher` extension merely spawns the server; a server that no longer exits is a strict improvement there — Story 37.1 records a verdict (#56).
- **Other** — no CI/deploy/monitoring changes.

### Technical Impact

- **37.1 is pure TypeScript in `@iris-mcp/shared`** (`server-base.ts` `start()` + comment/JSDoc sites; `profiles.ts` registry header comment; tests; docs). No ObjectScript change → no bootstrap regen; `BOOTSTRAP_VERSION` stays at its Epic-36-close value (`2159ec9e6f69` per the Epic 36 retro §6) — prove it. **No governance surface change:** no tool, no action key, no schema change (Rule #31); frozen baseline `1e62c5ad5bf7`/141 untouched; live/post-foundation 203/62 unmoved.
- **Test blast radius is small by design (option A):** exactly ONE existing test flips — `packages/shared/src/__tests__/server-base.test.ts:558` "should call process.exit when health check fails". The 38 test files that each define a local `stageDefaultStartup` helper (e.g. `governance-file.test.ts:764`, `governance-enforcement-coverage.test.ts:253`, `resolve-profile-client.test.ts:170`) stage the SUCCESS path, which is byte-for-byte unchanged, so they stay untouched — as do the "no extra fetches after start" pins (`server-base.test.ts:728`, `server-param.test.ts:340`, `server-param-integration.test.ts:357`, `governance-enforcement.test.ts:285`). A fully-lazy design (option B) would have re-sequenced all of them.
- **Changesets:** `.changeset/config.json` has `fixed: [["@iris-mcp/*"]]`, so a `@iris-mcp/shared` patch bumps the whole suite together — one changeset entry suffices (L-6).

---

## 3. Recommended Approach

**Selected: Option 1 — Direct Adjustment** (new single-story epic). Option 2 (Rollback) — not applicable; nothing recent caused this (Story 14.1, 2026-06). Option 3 (MVP Review) — not needed; FR111/FR112 stand, this is a resilience defect in a shipped feature.

**Fix design — option A, "eager attempt, non-fatal, lazy retry"** (alternatives B/C/D evaluated in `docs/bugs-2026-09-16.md` §Fix options): keep steps 2–4.5 of `start()` exactly as today when `default` is reachable; on health-check rejection log ERROR (existing message + one line stating the continuation semantics), `this.clients.drop(DEFAULT_PROFILE_NAME)`, leave `profileMeta` unset for `default`, skip negotiation/bootstrap, and connect the transport. The first call on `default` then flows through the existing `establishProfile` path exactly like a non-default profile — retryable, in-flight-coalesced, structured error. The `process.exit(1)` is removed for THIS case only; invalid-config exits (audit dir `:2011`, audit config `:1995`, malformed `IRIS_GOVERNANCE*`/`IRIS_PROFILES`/preset) stay fatal.

**Why not B (fully lazy default):** moves the one-time bootstrap (seconds to tens of seconds) INSIDE the first tool call, risking the client's per-call ceiling — the very constraint Epic 36 documented; loses the startup-time bootstrap report; re-sequences 38 test files for the same user-visible outcome. **Why not C (non-fatal only with ≥2 profiles):** forks semantics on registry size and keeps a no-recovery-without-restart failure mode for single-server users, whose only "benefit" is preserving a crash. **Why not D (strictness env var now):** speculative; each env var costs rows in README + three client guides; precedent (`IRIS_SERVER_MANAGER=required`) shows it can be added later with a named trigger.

**Effort:** 37.1 Low-Medium. **Risk:** Low — success path mechanically pinned; failure path proven RED→GREEN on the real dist. **Timeline:** nothing in flight; the beta continues on `main`; Epic 37 is the second beta-feedback epic.

**Lead decisions (all DECIDED 2026-09-16):**

- **L-1 — Branching: `epic37` directly off `main`.** The wave-5 tip (`63bf908`) and `main` (`2ed83ff`) have IDENTICAL trees (`git diff --stat 63bf908 2ed83ff` is empty), so the starting content is the same either way. Procedure (executed 2026-09-16 in this session): `git checkout -b epic37 main`, then the planning-artifact commit as the FIRST commit on `epic37`, then `git push -u origin epic37` — precedent: the 2026-09-10 planning commit `69526ed` landed on the feature branch, not on `main`'s first-parent line, and `main` receives planning changes only through the close-of-epic merge; at the SC-1 prompt name the EXISTING `feature/feature-wave-5-beta-feedback` (it exists and is up to date with its remote); SC-2 finds `epic37` present and checks it out; at close merge `epic37` → wave-5 → `main` (as Epic 36 did). Ticketless convention per `branch-naming.yaml` (`epic_pattern: epic{N}`).
- **L-2 — Non-fatal everywhere, single-server included** (option A as written). A documented change to a FAILURE mode only; the success path stays byte-for-byte.
- **L-3 — No strictness knob.** Option D becomes a ledger candidate with a named trigger (a beta user asks for fail-fast).
- **L-4 — `iris_server_profiles` reachability field deferred.** The tool stays connection-agnostic (README `:472`); one doc line instead ("a running server no longer implies the default IRIS is reachable"), relevant to `claude mcp list`'s per-server health check (`docs/client-config/README.md:289`). Ledger candidate.
- **L-5 — Epic 37 = Story 37.1 ONLY.** The 37.0 gate is skipped by Lead direction at epic-cycle kickoff; no burn-down runs in Epic 37; the Rule #37 forward obligation transfers to the Epic 38 gate as a recorded exception (§2); `36-4-CR-1` stays deferred to its own pre-publish story. Alternatives considered and declined: gate + fix; fix + `36-4-CR-1` as 37.2; the full gate + fix + burn-down.
- **L-6 — Changeset: `@iris-mcp/shared` patch** (bug fix; the fixed group bumps every package together). Pre-first-publish, so this only fixes the CHANGELOG narrative.

---

## 4. Detailed Change Proposals

### 4.1 — `epics.md` — append after line 4839 (Epic 36's `**Out of scope**` footer, end of file)

```markdown
## Epic 37: Beta Feedback Remediation — Startup Resilience With an Unreachable Default Profile (added 2026-09-16)

**Goal**: An unreachable IRIS instance is a per-profile, per-call condition, never a process-level fatal. Every server in the suite starts and serves calls against every reachable profile even when the reserved `default` profile's instance is down; a call against the unreachable profile returns the standard structured connection error; and the profile recovers on its next call once reachable — no restart required. Invalid configuration remains fail-fast at startup.

**Context**: Second beta-feedback defect (verbal, 2026-09-16, relayed by the Project Lead): "the MCP server fails to start if the default server is down but the other registered servers are up." Confirmed by source reading and by an empirical run of the built `iris-dev-mcp` dist with `default` pointed at a closed local port (`127.0.0.1:9`) plus an `IRIS_PROFILES` entry: exit code 1, `[ERROR] IRIS health check failed: …`, no transport connect, the second profile never probed. Root cause: `McpServerBase.start()` (`packages/shared/src/server-base.ts:2026-2034`) calls `process.exit(1)` when the eagerly-created `default` client fails `checkHealth`, before the transport connects (`:2090`); non-default profiles are established lazily (`getOrCreateClient` `:2166` → `establishProfile` `:2220`) and already have the desired semantics — retryable first touch (AC 14.2.8, `ProfileClientRegistry.drop` `profiles.ts:708`) surfaced by `handleToolCall` (`:1506-1531`) as `Could not connect to server profile "<name>": …` with `isError: true`. The asymmetry is written down: "only the default profile's startup failure is fatal" (`:2141`); it is a carried-over single-server behavior from Epic 14 decision D1 (`architecture.md:396`) / Story 14.1 (commit `213756b`), never re-examined once profiles existed. Full evidence, the four fix options and the Lead decisions: `docs/bugs-2026-09-16.md` and `sprint-change-proposal-2026-09-16-default-profile-outage.md`. Architecture record M1 (added with this epic) fixes the principle: invalid config fails fast; an unreachable peer never does.

**Constraint F-1 (no governance or tool-surface change)**: Story 37.1 adds NO tool, NO action key, NO schema field and NO env var. It is pure TypeScript in `@iris-mcp/shared` (`server-base.ts`, `profiles.ts`, tests, docs). Tool counts do not move (#31); `GOVERNANCE_BASELINE` stays frozen at `1e62c5ad5bf7`/141 and the live/post-foundation counts stay 203/62 — verify with `gen:governance-baseline:check` ONLY (#23/#25). No ObjectScript change, so `BOOTSTRAP_VERSION` must NOT move from its Epic-36-close value (`2159ec9e6f69`, Epic 36 retro §6) — prove it (`bootstrap-classes.ts` absent from the diff).

**Constraint F-2 (Rule #19 on the SUCCESS path)**: with `default` reachable, `start()`'s fetch sequence (health `HEAD`, version `GET`, the custom-REST bootstrap probe when `needsCustomRest`) and its `profileMeta` seeding are byte-identical to today; the existing eager-establishment pins (`server-base.test.ts:728`; `server-param.test.ts:340`; `server-param-integration.test.ts:357`; `governance-enforcement.test.ts:285`) and every one of the 38 test files carrying a local `stageDefaultStartup` helper pass UNMODIFIED. Only the failure path changes.

**Constraint F-3 (fail-fast stays fail-fast for CONFIG)**: the other `process.exit(1)` paths in `start()` — audit-log configuration (`:1995`), unwritable audit directory (`:2011`), malformed `IRIS_GOVERNANCE`/`IRIS_GOVERNANCE_FILE`/`IRIS_GOVERNANCE_PRESET`/`IRIS_PROFILES`/`IRIS_TOOLS_PRESET`, missing `IRIS_USERNAME`/`IRIS_PASSWORD` — are untouched. Existence of the `default` profile is still required; this epic is about reachability only.

**Branching (Rules SC-1 / SC-2; Project Lead decision L-1, 2026-09-16)**: `epic37` is cut DIRECTLY off `main` (`2ed83ff`; identical tree to the wave-5 tip `63bf908`); the planning-artifact commit (this proposal) is the first commit on `epic37`. At the SC-1 prompt name the EXISTING `feature/feature-wave-5-beta-feedback`; SC-2 finds `epic37` present and checks it out; at close merge `epic37` → wave-5 → `main`. Ticketless convention per `_bmad/custom/branch-naming.yaml` (`epic_pattern: epic{N}`, `ticket_required: false`); the ACTIVE marker comment in that file is updated in the same change.

**Gate and Rule #37 (Project Lead decision L-5, 2026-09-16 — a recorded exception, never a silent one)**: this epic carries ONE story. The conventional `37.0` retro-review gate is SKIPPED by Lead direction at epic-cycle kickoff — the command otherwise creates it whenever the prior retro exists or the ledger has open items (`.claude/commands/epic-cycle.md:270-274`, `:399`; both are true: `epic-36-retro-2026-09-11.md` exists and the ledger carries 1 HIGH / 24 MEDIUM / 62 LOW = 87 open). Consequence: NO triage event occurs in Epic 37, so no item's Rule #37 count moves here. The Epic 36 gate's forward obligation (`deferred-work.md:2939` — 36 items at count 2: Story 34.6 batch 19 `34-6-CR-9`, `-12…-20`, `34-6-CR2-7…-15`; Story 34.7 batch 10 `34-7-QA-1`, `34-7-CR-1…-9`; Story 34.8 batch 7 `34-8-CR-1…-7`; including `34-8-CR-1`'s named beta trigger and the `34-6-CR2-8`↔`34-6-CR-15` fold / `34-6-CR-17` stale-open anomalies) transfers UNCHANGED to the **Epic 38** gate, where a further re-deferral would be their third consecutive and the 37 Epic-35-era items at count 1 also reach count 2 (73 items at count 2 there). Under the strict reading applied at the 36.0 gate (`35-0-CR-C`) this is a Lead-owned exception to Rule #37, taken so the beta user's fix ships with nothing in front of it. Epic 36 retro action items (#4 npm publish, #5 `34-8-CR-1` trigger, the external carries, the `36-4-CR-1` HIGH deferred by decision with its interim mitigation) transfer unreviewed to the Epic 38 gate. Recorded identically in the proposal, in `sprint-status.yaml`, and in a dated line at the end of `deferred-work.md`.

### Story 37.1: MEDIUM - Default-Profile Outage Must Not Take Down the Server — Degrade and Retry Instead of `process.exit(1)`

**Added 2026-09-16 (correct-course, beta feedback).** Framework story in `@iris-mcp/shared`; affects all five servers identically. Full evidence: `docs/bugs-2026-09-16.md`. **Pure TypeScript** — no ObjectScript change, so NO bootstrap regen; `BOOTSTRAP_VERSION` must NOT move (`2159ec9e6f69`). Prove that. The shared IRIS instance is in use by other projects: an outage is ALWAYS simulated with a closed local port (`IRIS_HOST=127.0.0.1 IRIS_PORT=9`), never by stopping the instance; traffic to the real instance is read-only (`HEAD`/`GET`, `iris_server_info`). Semantics per Lead decision L-2: non-fatal everywhere, single-server installs included.

- **AC 37.1.1** - Root cause confirmed at `packages/shared/src/server-base.ts:2023` (eager `getOrCreate(DEFAULT_PROFILE_NAME)`), `:2026-2034` (`checkHealth` → `process.exit(1)`), `:2037-2043` (negotiation), `:2049-2072` (bootstrap), `:2082-2085` (`profileMeta.set(DEFAULT_PROFILE_NAME, …)`), `:2090` (transport connect — reached only after the above). Evidence recorded: the closed-port run (exit 1; no connect line; second profile never probed).
- **AC 37.1.2** - Probe-first (#16/#47), BEFORE coding, recorded in Dev Notes: (a) confirm `ProfileClientRegistry.drop` (`profiles.ts:708`) is safe for `default` (no special-casing) and that `getOrCreate` re-creates it from the registry's synthesized default (`profiles.ts:424`); (b) confirm `establishProfile` (`:2220`) handles `profile.name === "default"` without change — its `attemptProfileBootstrap(profile, …)` passes the `IrisProfile` (which spreads the full `IrisConnectionConfig`) where `start()` passed `this.config`, so the bootstrap inputs are equivalent; (c) enumerate every reader of the private `atelierVersion` field (`:381`) — only the startup log line and the eager bootstrap — and decide, recording why: sync it in `establishProfile` when `profile.name === DEFAULT_PROFILE_NAME`, or leave it log-only with `profileMeta` as the sole source of truth for calls; (d) read the MCP `instructions` string in `server-base.ts` and the `Fatal:` catch in each server's `index.ts` for wording that assumes the default is reachable.
- **AC 37.1.3** - **Fix (option A; L-2).** In `start()`, on `checkHealth(defaultClient)` rejection: log at ERROR the existing message PLUS one line stating that startup continues, that tools targeting the `default` profile will return a connection error until it is reachable, and that it recovers automatically; `this.clients.drop(DEFAULT_PROFILE_NAME)`; do NOT set `profileMeta` for `default`; skip negotiation and bootstrap; proceed to connect the transport. Remove the `process.exit(1)` for this case ONLY (F-3). On the success path nothing changes (F-2). The same semantics apply with only `default` registered.
- **AC 37.1.4** - **Startup survives (Rule #21 capstone, unit half).** With the health `HEAD` rejected and ≥1 other profile registered: `start("stdio")` resolves, `process.exit` is NOT called, the transport is connected; the ERROR log names host:port, the reason and the continuation semantics. Same assertion with only `default` registered (L-2).
- **AC 37.1.5** - **Others serve; default degrades then recovers without restart.** After the failed eager attempt: a call with `server:"other"` (fetch mocks: `HEAD` 200 + version) succeeds; a call on `default` while its `HEAD` still rejects returns the EXISTING envelope `Could not connect to server profile "default": …` with `isError: true` (no throw out of the SDK handler, no exit); the client was dropped (`registry.has("default")` false after the failure; a fresh instance on the next attempt); once the `HEAD` resolves, the next call establishes through `establishProfile` (health → negotiation → one-time bootstrap when `needsCustomRest`) and succeeds; bootstrap is attempted exactly once across the recovery; two concurrent first-touch calls on `default` share ONE establishment (`establishing` coalescing, AC 14.2.7 symmetry). Every fake returns a shape the real `fetch`/Atelier API can return (#54).
- **AC 37.1.6** - **Success path unchanged (F-2, Rule #19 mechanical proof).** `server-base.test.ts:558` is the ONLY existing test that changes (it becomes "continues startup, logs, does not exit"); `git diff --stat -- 'packages/*/src/__tests__'` lists that file plus the new test file(s) and nothing else; the eager pins named in F-2 pass unmodified; a `toEqual` pin of the startup fetch-call sequence under a reachable default fails on any drift.
- **AC 37.1.7** - **Gate proven RED on the path it guards (Rules #48/#59).** The AC 37.1.4/37.1.5 tests live in the DEFAULT suite (never an excluded suffix); with the fix reverted (reinstate `process.exit(1)`) they go RED; restore → GREEN. The Rule #59 statement names the path: `McpServerBase.start()` under a mocked-rejecting `fetch`, the same call the real entry points make.
- **AC 37.1.8** - **Live proof from the BUILT dist in a fresh Node process (#22/#26/#34), no shared-instance changes.** `default` → `127.0.0.1:9`; `other` → the real instance (read-only). Over stdio JSON-RPC: `initialize` succeeds; `tools/call iris_server_info {server:"other"}` → result; `tools/call iris_server_info {}` → the `isError` envelope naming `default`; stderr carries the ERROR + continuation lines and `Connected via stdio transport`. Repeat on a SECOND server package (e.g. `iris-ops-mcp`, `needsCustomRest` differs from dev) to prove the framework path, and once with `IRIS_SERVER_MANAGER=auto` if a Server-Manager profile is available locally (source `server-manager` profiles take the same lazy path — record the verdict). Mutation leg: the pre-fix dist reproduces exit code 1. A permanent armed live gate in the default suite (read `epic35-defect-gate.test.ts` for the arming convention first — #47) pins the closed-port-default + reachable-other round trip.
- **AC 37.1.9** - **Docs (#43 self-documenting; #56 enumerate exhaustively, verdict per surface).** `README.md`: Backward Compatibility (`:528-540`) gains a bullet stating the failure-mode change ("startup no longer exits when the `default` instance is unreachable; calls to it return a connection error and recover on their own; invalid configuration still fails fast"), and the Profiles section (`:344-356`) gains one paragraph on per-profile independence at startup; `docs/client-config/README.md` startup-failure guidance near `:30` and the `claude mcp list` note near `:289` ("a running server no longer implies the default IRIS is reachable — call a cheap read, e.g. `iris_server_info`, to check") — the L-4 doc line; `docs/client-config/claude-code.md`, `claude-desktop.md`, `cursor.md`, the five per-server READMEs, `packages/iris-mcp-all/README.md`, the `iris-mcp-launcher` README: checked for startup/health-check claims with a recorded verdict each; `tool_support.md`: no key moves — verdict recorded; `CHANGELOG.md` "Pre-release — <date>" entry under Fixed (since-when anchored: Story 14.1, `213756b`); JSDoc/comments at `server-base.ts:1506-1510`, `:1924-1935`, `:2025-2026`, `:2137-2141`, `:2220-2230` and `profiles.ts:655-665`; the Story 14.1 file is NOT edited (M1 supersedes its clause). Run every documented example.
- **AC 37.1.10** - **Ledger candidates recorded (not stories):** option D strictness knob with its named trigger (L-3); `iris_server_profiles` per-profile reachability (L-4); periodic re-ping (`health.ts` `ping()` is unused by `server-base` today). Each as a LOW row with rationale, Rule #37 count 0.
- **AC 37.1.11** - Gates: `pnpm turbo run build test lint type-check` green (per-package standalone runs acceptable per `35-1-DEV-1`, substitution recorded); `gen:governance-baseline:check` (`:check` ONLY) exit 0 at frozen `1e62c5ad5bf7`/141, live/post-foundation 203/62 (F-1); tool counts unmoved, no new key (#31); `bootstrap-classes.ts` absent from the diff, `BOOTSTRAP_VERSION` stays `2159ec9e6f69`; changeset added (`@iris-mcp/shared` patch — L-6); the OS suite untouched (`total` vs `Test*` count, #35, unchanged).
- **AC 37.1.12** - **Gate duties folded in (no 37.0 in this epic — L-5).** Confirm `epic37` exists off `main` (`2ed83ff` or later) and is the current branch before any code lands (L-1; HALT and escalate otherwise); Rule #57 machinery armed for this story's review (bounded-close, frozen-diff snapshot, delivery receipts — Epic 36 closed non-degraded, hold that bar); suite baselines re-measured at pickup with per-package standalone runs (prior figures in `deferred-work.md` → "Epic 36 retro-review gate" → "Suite baselines", per `36-0-CR-Z`; the `35-1-DEV-1` and `36-4-CR-4` parallel flakes are environmental); the ledger is NOT triaged here — the Rule #37 exception in the epic preamble stands and the Epic 38 gate owns the transferred obligation.

**Out of scope for Epic 37**: existence of the `default` profile (`IRIS_USERNAME`/`IRIS_PASSWORD` remain required at startup — README `:109`, `config.ts:135-141`); a strictness env var restoring fail-fast (ledger candidate with a named trigger, L-3); per-profile reachability in `iris_server_profiles` (ledger candidate, L-4); periodic re-ping / background monitoring; the Rule #37 burn-down of the 36 count-2 items (transferred to the Epic 38 gate — Lead exception L-5, recorded above); `36-4-CR-1` (HIGH bootstrap downgrade — its own pre-publish story in a later epic, per the Epic 36 retro §7 and L-5); the SDK `extra`-argument wiring (Epic 36 carry); the npm publish (post-beta, Project Lead action).
```

### 4.2 — `sprint-status.yaml` — append after line 620 (`epic-36-retrospective: done`)

OLD (end of file, unchanged, for anchor):
```yaml
  36-4-global-subscript-injection: done
  epic-36-retrospective: done
```

NEW (appended):
```yaml
  # Epic 37: Beta Feedback Remediation — startup resilience with an unreachable
  # default profile (trigger docs/bugs-2026-09-16.md, second beta-feedback
  # defect; sprint-change-proposal-2026-09-16-default-profile-outage.md).
  # McpServerBase.start() calls process.exit(1) when the reserved default
  # profile fails its startup health check, before the transport connects, so
  # healthy IRIS_PROFILES / Server-Manager profiles never get to serve (all 5
  # servers; since Story 14.1). 37.1 = eager-but-non-fatal default
  # establishment with lazy retry (option A, non-fatal everywhere per L-2; pure
  # TS in @iris-mcp/shared; no tool/action key; no BOOTSTRAP bump).
  # ONE story by Project Lead decision L-5 (2026-09-16): the 37.0 retro-review
  # gate is SKIPPED by Lead direction at kickoff (answer the epic-cycle's gate
  # step with this decision) and NO burn-down runs here. The Epic 36 gate's
  # Rule #37 forward obligation (36 items at count 2, deferred-work.md L2939)
  # transfers UNCHANGED to the Epic 38 gate — recorded exception; see the Epic
  # 37 preamble in epics.md and the ledger's 2026-09-16 section. 36-4-CR-1
  # (HIGH) stays deferred to its own pre-publish story. Ledger carries
  # 1H/24M/62L=87 open. Do NOT renumber.
  # Branch (L-1, 2026-09-16): epic37 DIRECTLY off main (2ed83ff; identical tree
  # to the wave-5 tip 63bf908); the planning commit is its first commit. At SC-1 name
  # the existing feature/feature-wave-5-beta-feedback; SC-2 finds epic37
  # present; at close merge epic37 → wave-5 → main.
  epic-37: backlog
  37-1-default-profile-outage-degrade-and-retry: backlog
  epic-37-retrospective: optional
```

The file's `# last_updated:` header is rewritten by the epic-cycle at pickup (as with Epic 36); not edited here.

### 4.3 — `prd.md`

**A. Functional Requirements — append after line 690 (`- FR144`, the current last FR):**

```
- FR145: Operator running several server profiles keeps a working MCP server when the reserved `default` profile's IRIS instance is unreachable: server startup completes, calls against reachable profiles succeed, calls against the unreachable profile return the standard structured connection error (code, message, recovery suggestion), and that profile recovers on its next call once reachable — no server restart required. The same applies to a single-server install (the server starts and recovers rather than exiting). Invalid configuration remains fail-fast at startup. (Epic 37, Story 37.1)
```

**B. `### Reliability` NFR — insert after line 723 (the Epic 36 async-job bullet), before the session-expiration bullet:**

```
- An unreachable IRIS instance is a per-profile, per-call condition, never a process-level fatal: server startup must complete when any configured profile — including `default` — cannot be reached, a call against the unreachable profile must return the standard connection error with its recovery suggestion, and the profile must recover on a later call without a server restart. Invalid configuration (malformed policy, missing credentials, unwritable audit path) remains fail-fast at startup — a peer's availability and the operator's configuration are different failure classes (Epic 37)
```

**Rationale:** FR111/FR112 define profiles but are silent on availability; the existing Reliability bullet covers detection within 2 s but not process survival. FR145 makes the survive-and-recover behavior an explicit requirement; the NFR states the principle that M1 records architecturally. FR111's "today's behavior" clause is unchanged (the success path is byte-for-byte).

### 4.4 — `architecture.md` — new dated decision record after the L1 paragraph (line 486), before `## Implementation Patterns & Consistency Rules` (line 488)

```markdown
### Startup Resilience Under Profile Unreachability (Epic 37 — added 2026-09-16)

Added via `sprint-change-proposal-2026-09-16-default-profile-outage.md`, triggered by `docs/bugs-2026-09-16.md` (the second beta-feedback defect). Decision D1 (Epic 14) made the reserved `default` profile's client eager at startup "preserving today's bootstrap/health-check/negotiation exactly" — and with it, silently, the pre-multi-server consequence that a failed health check is fatal (`process.exit(1)` before the transport connects). Non-default profiles were given lazy, retryable, per-call-error semantics (AC 14.2.8). A multi-profile process therefore died with its anchor: one instance down made every other configured instance unreachable through the suite, at exactly the moment an operator wants the others.

**M1 — A configuration error fails startup fast; an unreachable peer never does.** Concretely: (1) `start()` distinguishes INVALID CONFIGURATION — malformed `IRIS_GOVERNANCE*`/`IRIS_PROFILES`/preset values, missing credentials, an unwritable audit path — which fails fast naming the variable, from an UNREACHABLE IRIS INSTANCE, which is logged (host:port, reason, continuation semantics) and never exits the process; (2) every profile, the reserved `default` included, is established through ONE path (`getOrCreateClient` → `establishProfile`) with retryable first-touch semantics; the default's startup attempt is an eager WARM-UP of that path (kept so single-server installs retain startup-time bootstrap and diagnostics), never a gate — on failure its client is dropped and no metadata is recorded, so the first call re-establishes exactly as a non-default profile would; (3) unreachability surfaces per call as the structured `isError` connection envelope and recovers without restart; (4) a running server process therefore does not imply that any IRIS instance is reachable — discovery (`iris_server_profiles`) stays connection-agnostic by design, and reachability is learned per call (a cheap read such as `iris_server_info`). *Rationale:* the suite's multi-server value ("one process, several instances") is worthless if one outage takes down the process; the lazy path already had the right semantics, so the fix is to stop exempting `default` from them. *Recorded, not decided:* an opt-in strictness knob restoring fail-fast (precedent `IRIS_SERVER_MANAGER=required`) and a per-profile reachability field on discovery are ledger candidates with named triggers, not features. This is a single-pattern decision like K1/L1 — recorded because it amends the failure-mode consequence of D1 without changing D1's success path.
```

### 4.5 — `_bmad/custom/branch-naming.yaml` — ACTIVE-branch comment block (comment-only; no schema field)

OLD:
```
# ── ACTIVE feature branch ────────────────────────────────────────────────────
#
# feature/feature-wave-5-beta-feedback
#
# wave-4 merged to main 2026-08-19 (60be515) and is closed; wave-3 is closed.
# Epic 36 (first beta-feedback epic) targets WAVE-5, cut off main (Project Lead
# decision L-1, 2026-09-10, sprint-change-proposal-2026-09-10-execute-tests-
# long-run.md). Three feature branches now match feature_pattern — this line
# resolves the SC-7 ambiguity: branch epic36 off wave-5.
```

NEW:
```
# ── ACTIVE feature branch ────────────────────────────────────────────────────
#
# feature/feature-wave-5-beta-feedback
#
# wave-4 merged to main 2026-08-19 (60be515) and is closed; wave-3 is closed.
# wave-5 carries the beta-feedback epics: Epic 36 merged to main 2026-09-11
# (2ed83ff). Epic 37 (second beta-feedback epic; Project Lead decision L-1,
# 2026-09-16, sprint-change-proposal-2026-09-16-default-profile-outage.md):
# epic37 is cut DIRECTLY off main (2ed83ff — identical tree to the wave-5 tip
# 63bf908). At the SC-1 prompt name this existing wave-5 branch; SC-2 finds
# epic37 present and checks it out; at close merge epic37 → wave-5 → main.
# Three feature branches match feature_pattern — this line resolves the SC-7
# ambiguity.
```

Also append to the "Observed history" list: `#   feature/feature-wave-5-beta-feedback          Epic 36      (merge 2ed83ff)`.

### 4.6 — Bug record: `docs/bugs-2026-09-16.md` — append a disposition footer and `git add`

The record already exists (written 2026-09-16 by this session's analysis pass; untracked). Append:

```markdown
## Correct-course disposition (2026-09-16 — Mary)

- **Home:** new Epic 37, ONE story — 37.1 (the fix, option A, non-fatal everywhere per Lead decision L-2). No 37.0 gate and no burn-down in this epic (Lead decision L-5; the Rule #37 forward obligation transfers to the Epic 38 gate as a recorded exception).
- **Lead decisions:** recorded in `sprint-change-proposal-2026-09-16-default-profile-outage.md` §3 (L-1 … L-6).
- **Architecture:** record M1 ("a configuration error fails startup fast; an unreachable peer never does") supersedes the fatal consequence of D1 without changing D1's success path.
- **Requirements:** FR145 + one Reliability NFR bullet.
- **Live verification plan:** closed local port for `default`, read-only traffic to the real instance; the shared instance is never stopped.
```

### 4.7 — `deferred-work.md` — ONE dated section appended at the end (the single ledger edit this session makes, authorized by L-5; no count moves)

```markdown
## Project Lead decision — Epic 37 scope and the Rule #37 forward obligation (2026-09-16, correct-course session — Mary)

Epic 37 (`sprint-change-proposal-2026-09-16-default-profile-outage.md`; trigger `docs/bugs-2026-09-16.md`) carries ONE story, 37.1 (the default-profile-outage fix). By Project Lead decision L-5 the 37.0 retro-review gate is skipped at epic-cycle kickoff and no burn-down runs in Epic 37. Therefore NO triage event occurs in Epic 37 and no item's Rule #37 count moves here. The forward obligation recorded at the Story 36.0 gate (L2939 — **36 items (7 MEDIUM · 29 LOW)** at Rule #37 count 2: Story 34.6 batch 19 `34-6-CR-9`, `-12…-20`, `34-6-CR2-7…-15`; Story 34.7 batch 10 `34-7-QA-1`, `34-7-CR-1…-9`; Story 34.8 batch 7 `34-8-CR-1…-7`; incl. `34-8-CR-1`'s named beta trigger and the `34-6-CR2-8`↔`34-6-CR-15` fold / `34-6-CR-17` stale-open anomalies) transfers UNCHANGED to the **Epic 38** gate, where a further re-deferral would be their third consecutive and Rule #37 mandates a burn-down; the 37 Epic-35-era items at count 1 also reach count 2 there. `36-4-CR-1` (HIGH) stays deferred per the Epic 36 retro §7 (a dedicated pre-publish story). Epic 36 retro action items transfer unreviewed to the Epic 38 gate. **No count moves:** the ledger state remains that of the Story 36.4 code review — 1 HIGH / 24 MEDIUM / 62 LOW = 87 open across 223 distinct items (136 terminal); the Epic 38 gate owns the next mechanical recount (#51). Story 37.1 will append its own ledger candidates (AC 37.1.10) in its own section.
```

### 4.8 — Not changed at proposal time (by design)

- `docs/epic-summary.md` — the epic-cycle updates it at epic close.
- Code (`server-base.ts`, `profiles.ts`, tests, READMEs, client-config guides, `CHANGELOG.md`, changeset) — story work.
- `_bmad-output/implementation-artifacts/14-1-…md` — historical; M1 supersedes its clause without editing it.
- The `epic37` branch — cut off `main` at `2ed83ff` in this session (L-1); the planning-artifact commit is its first commit, pushed with `-u origin epic37` at the Lead's request. `main` is untouched.

---

## 5. Implementation Handoff

**Scope classification: Moderate** — a new single-story epic; PRD/architecture/epics/sprint-status/branch-naming/ledger edits; one recorded Rule #37 exception; no MVP or architecture invalidation, no rollback.

- **Route to:** Product Owner / Scrum Master (accept Epic 37 and its one story key into `sprint-status.yaml`; at epic-cycle kickoff answer the retro-review gate step with decision L-5 and the SC-1 prompt with the existing wave-5 branch per L-1), then Development via `/epic-cycle` (or `bmad-create-story` → `bmad-dev-story` directly, which creates no gate).
- **This correct-course session's own deliverable:** apply §4.1–§4.7 exactly as shown (region-scoped appends/edits; verify each with `git diff --stat` per Rule #55); run `node scripts/check-epics-sync.mjs` (expect 37.1 present on both sides, 0 orphans, 0 genuine drift); create the Story 37.1 file (`_bmad-output/implementation-artifacts/37-1-default-profile-outage-degrade-and-retry.md`) carrying this session's source anchors and the closed-port run as its "Lead pre-story probe" section, so the dev agent starts from verified facts (the practice the Epic 35/36 retros credited); `git add` the bug record. The Lead then requested commit + push: cut `epic37` off `main`, one planning commit on `epic37`, pushed to `origin`.
- **Success criteria:** the seven artifacts updated exactly as shown; Epic 36's stories, gate and retro untouched; `deferred-work.md` gains exactly one section and no count moves; `sprint-status.yaml` gains exactly one epic block with one story key + retro key; `check-epics-sync.mjs` clean; the bug record staged under `docs/` with its disposition footer.

---

## Appendix — Change Navigation Checklist (Step 2 record)

| # | Item | Status | Note |
|---|---|---|---|
| 1.1 | Triggering story | [N/A] | Beta-feedback defect, not a story; origin Story 14.1 (`213756b`) |
| 1.2 | Problem statement | [x] | §1 |
| 1.3 | Evidence | [x] | §1 + `docs/bugs-2026-09-16.md`; empirical closed-port run (exit 1) |
| 2.1 | Current epic completable | [x] | Epic 36 closed; untouched |
| 2.2 | Epic-level changes | [x] | New single-story Epic 37; Rule #37 exception recorded (L-5) |
| 2.3 | Remaining epics | [x] | None planned beyond 36; Epic 36 carries and the Rule #37 obligation transfer to the Epic 38 gate |
| 2.4 | Invalidated / new epics | [x] | None invalidated; Epic 37 new |
| 2.5 | Order / priority | [x] | Single story; `36-4-CR-1` stays deferred (L-5) |
| 3.1 | PRD conflicts | [x] | FR145 + Reliability bullet (§4.3); FR111/FR112 stand |
| 3.2 | Architecture conflicts | [x] | M1 amends D1's failure consequence (§4.4) |
| 3.3 | UI/UX | [N/A] | Backend suite; launcher verdict recorded in 37.1 |
| 3.4 | Other artifacts | [x] | sprint-status, branch-naming, bug record, ledger line; docs/CHANGELOG/changeset are story work |
| 4.1 | Option 1 Direct Adjustment | [Viable] | Effort Low-Med / Risk Low — SELECTED |
| 4.2 | Option 2 Rollback | [Not viable] | Nothing recent caused it |
| 4.3 | Option 3 MVP Review | [Not viable] | Requirements stand; resilience defect |
| 4.4 | Selected path | [x] | §3 |
| 5.1–5.5 | Proposal components | [x] | §1–§5 |
| 6.1–6.2 | Review | [x] | This document |
| 6.3 | Explicit approval | [x] | APPROVED 2026-09-16 with L-1 … L-6 as recorded in the header |
| 6.4 | `sprint-status.yaml` update | [x] | §4.2 applied |
| 6.5 | Handoff | [x] | §5 |
