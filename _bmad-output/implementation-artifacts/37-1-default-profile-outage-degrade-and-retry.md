# Story 37.1: MEDIUM - Default-Profile Outage Must Not Take Down the Server — Degrade and Retry Instead of `process.exit(1)`

Status: backlog

<!-- Created 2026-09-16 by the correct-course session (Mary) with the lead pre-story probe below, per the practice the Epic 35/36 retros credited. The epic-cycle's create-story step should ADOPT this file rather than create a second one. Validation is optional: run validate-create-story before dev-story if desired. -->

## Story

As an **operator (or the AI client acting for them) who has registered several IRIS instances as server profiles**,
I want **every server in the suite to start and serve calls against the reachable profiles even when the reserved `default` profile's instance is down, and calls against the down profile to fail per call with the standard connection error and recover on their own once it is back**,
so that **one instance's outage never takes the whole MCP server with it, and I never have to reconfigure `IRIS_*` or restart the client to route around it**.

## Context — why this story exists

Second beta-feedback defect (verbal, 2026-09-16, relayed by the Project Lead): "the MCP server fails to start if the default server is down but the other registered servers are up." Full record with evidence, the four fix options and the Lead decisions: `docs/bugs-2026-09-16.md` and `sprint-change-proposal-2026-09-16-default-profile-outage.md`.

`McpServerBase.start()` (`packages/shared/src/server-base.ts:2026-2034`) calls `process.exit(1)` when the eagerly-created `default` client fails `checkHealth`, BEFORE the transport connects (`:2090`). Non-default profiles are established lazily and already have the desired semantics (retryable first touch, structured per-call error). The asymmetry is written down in the JSDoc — "only the default profile's startup failure is fatal" (`:2141`) — and is a carried-over single-server behavior from Epic 14 decision D1 / Story 14.1 (`213756b`), never re-examined once profiles existed. Architecture record M1 (added with this epic) fixes the principle: invalid config fails fast; an unreachable peer never does.

**This is the ONLY story of Epic 37** (Project Lead decision L-5, 2026-09-16): there is no 37.0 gate and no burn-down in this epic; the Rule #37 forward obligation transfers to the Epic 38 gate as a recorded exception (epic preamble in `epics.md`; `sprint-status.yaml`; the ledger's 2026-09-16 section). The gate duties that matter to this story are folded into AC 37.1.12. The change proposal's PRD (FR145 + Reliability bullet) and `architecture.md` M1 edits are ALREADY applied — do not re-apply.

**This story is pure TypeScript** in `@iris-mcp/shared` (`server-base.ts`, `profiles.ts` comments, tests, docs). No ObjectScript change, so NO bootstrap regen; `BOOTSTRAP_VERSION` must NOT move (`2159ec9e6f69` per the Epic 36 retro §6 — verify at pickup). Prove that.

**Epic constraints in force:** F-1 (no tool, no action key, no schema field, no env var; frozen baseline `1e62c5ad5bf7`/141, live/post-foundation 203/62; `gen:governance-baseline:check` ONLY); F-2 (success path byte-for-byte — the 38 `stageDefaultStartup` files and the eager pins pass unmodified); F-3 (config fail-fast paths untouched). Lead decisions: **L-2** non-fatal everywhere, single-server included; **L-3** no strictness knob (ledger candidate); **L-4** no discovery reachability field (one doc line instead); **L-6** changeset `@iris-mcp/shared` patch.

**The shared IRIS instance is in use by other projects.** An outage is ALWAYS simulated with a closed local port (`IRIS_HOST=127.0.0.1 IRIS_PORT=9`), never by stopping the instance; traffic to the real instance is read-only (`HEAD`/`GET`, `iris_server_info`).

## Acceptance Criteria

Sourced verbatim from `_bmad-output/planning-artifacts/epics.md`, "### Story 37.1" (added via correct-course 2026-09-16).

1. **AC 37.1.1** - Root cause confirmed at `packages/shared/src/server-base.ts:2023` (eager `getOrCreate(DEFAULT_PROFILE_NAME)`), `:2026-2034` (`checkHealth` → `process.exit(1)`), `:2037-2043` (negotiation), `:2049-2072` (bootstrap), `:2082-2085` (`profileMeta.set(DEFAULT_PROFILE_NAME, …)`), `:2090` (transport connect — reached only after the above). Evidence recorded: the closed-port run (exit 1; no connect line; second profile never probed).
2. **AC 37.1.2** - Probe-first (#16/#47), BEFORE coding, recorded in Dev Notes: (a) confirm `ProfileClientRegistry.drop` (`profiles.ts:708`) is safe for `default` (no special-casing) and that `getOrCreate` re-creates it from the registry's synthesized default (`profiles.ts:424`); (b) confirm `establishProfile` (`:2220`) handles `profile.name === "default"` without change — its `attemptProfileBootstrap(profile, …)` passes the `IrisProfile` (which spreads the full `IrisConnectionConfig`) where `start()` passed `this.config`, so the bootstrap inputs are equivalent; (c) enumerate every reader of the private `atelierVersion` field (`:381`) — only the startup log line and the eager bootstrap — and decide, recording why: sync it in `establishProfile` when `profile.name === DEFAULT_PROFILE_NAME`, or leave it log-only with `profileMeta` as the sole source of truth for calls; (d) read the MCP `instructions` string in `server-base.ts` and the `Fatal:` catch in each server's `index.ts` for wording that assumes the default is reachable.
3. **AC 37.1.3** - **Fix (option A; L-2).** In `start()`, on `checkHealth(defaultClient)` rejection: log at ERROR the existing message PLUS one line stating that startup continues, that tools targeting the `default` profile will return a connection error until it is reachable, and that it recovers automatically; `this.clients.drop(DEFAULT_PROFILE_NAME)`; do NOT set `profileMeta` for `default`; skip negotiation and bootstrap; proceed to connect the transport. Remove the `process.exit(1)` for this case ONLY (F-3). On the success path nothing changes (F-2). The same semantics apply with only `default` registered.
4. **AC 37.1.4** - **Startup survives (Rule #21 capstone, unit half).** With the health `HEAD` rejected and ≥1 other profile registered: `start("stdio")` resolves, `process.exit` is NOT called, the transport is connected; the ERROR log names host:port, the reason and the continuation semantics. Same assertion with only `default` registered (L-2).
5. **AC 37.1.5** - **Others serve; default degrades then recovers without restart.** After the failed eager attempt: a call with `server:"other"` (fetch mocks: `HEAD` 200 + version) succeeds; a call on `default` while its `HEAD` still rejects returns the EXISTING envelope `Could not connect to server profile "default": …` with `isError: true` (no throw out of the SDK handler, no exit); the client was dropped (`registry.has("default")` false after the failure; a fresh instance on the next attempt); once the `HEAD` resolves, the next call establishes through `establishProfile` (health → negotiation → one-time bootstrap when `needsCustomRest`) and succeeds; bootstrap is attempted exactly once across the recovery; two concurrent first-touch calls on `default` share ONE establishment (`establishing` coalescing, AC 14.2.7 symmetry). Every fake returns a shape the real `fetch`/Atelier API can return (#54).
6. **AC 37.1.6** - **Success path unchanged (F-2, Rule #19 mechanical proof).** `server-base.test.ts:558` is the ONLY existing test that changes (it becomes "continues startup, logs, does not exit"); `git diff --stat -- 'packages/*/src/__tests__'` lists that file plus the new test file(s) and nothing else; the eager pins named in F-2 pass unmodified; a `toEqual` pin of the startup fetch-call sequence under a reachable default fails on any drift.
7. **AC 37.1.7** - **Gate proven RED on the path it guards (Rules #48/#59).** The AC 37.1.4/37.1.5 tests live in the DEFAULT suite (never an excluded suffix); with the fix reverted (reinstate `process.exit(1)`) they go RED; restore → GREEN. The Rule #59 statement names the path: `McpServerBase.start()` under a mocked-rejecting `fetch`, the same call the real entry points make.
8. **AC 37.1.8** - **Live proof from the BUILT dist in a fresh Node process (#22/#26/#34), no shared-instance changes.** `default` → `127.0.0.1:9`; `other` → the real instance (read-only). Over stdio JSON-RPC: `initialize` succeeds; `tools/call iris_server_info {server:"other"}` → result; `tools/call iris_server_info {}` → the `isError` envelope naming `default`; stderr carries the ERROR + continuation lines and `Connected via stdio transport`. Repeat on a SECOND server package (e.g. `iris-ops-mcp`, `needsCustomRest` differs from dev) to prove the framework path, and once with `IRIS_SERVER_MANAGER=auto` if a Server-Manager profile is available locally (source `server-manager` profiles take the same lazy path — record the verdict). Mutation leg: the pre-fix dist reproduces exit code 1. A permanent armed live gate in the default suite (read `epic35-defect-gate.test.ts` for the arming convention first — #47) pins the closed-port-default + reachable-other round trip.
9. **AC 37.1.9** - **Docs (#43 self-documenting; #56 enumerate exhaustively, verdict per surface).** `README.md`: Backward Compatibility (`:528-540`) gains a bullet stating the failure-mode change ("startup no longer exits when the `default` instance is unreachable; calls to it return a connection error and recover on their own; invalid configuration still fails fast"), and the Profiles section (`:344-356`) gains one paragraph on per-profile independence at startup; `docs/client-config/README.md` startup-failure guidance near `:30` and the `claude mcp list` note near `:289` ("a running server no longer implies the default IRIS is reachable — call a cheap read, e.g. `iris_server_info`, to check") — the L-4 doc line; `docs/client-config/claude-code.md`, `claude-desktop.md`, `cursor.md`, the five per-server READMEs, `packages/iris-mcp-all/README.md`, the `iris-mcp-launcher` README: checked for startup/health-check claims with a recorded verdict each; `tool_support.md`: no key moves — verdict recorded; `CHANGELOG.md` "Pre-release — <date>" entry under Fixed (since-when anchored: Story 14.1, `213756b`); JSDoc/comments at `server-base.ts:1506-1510`, `:1924-1935`, `:2025-2026`, `:2137-2141`, `:2220-2230` and `profiles.ts:655-665`; the Story 14.1 file is NOT edited (M1 supersedes its clause). Run every documented example.
10. **AC 37.1.10** - **Ledger candidates recorded (not stories):** option D strictness knob with its named trigger (L-3); `iris_server_profiles` per-profile reachability (L-4); periodic re-ping (`health.ts` `ping()` is unused by `server-base` today). Each as a LOW row with rationale, Rule #37 count 0.
11. **AC 37.1.11** - Gates: `pnpm turbo run build test lint type-check` green (per-package standalone runs acceptable per `35-1-DEV-1`, substitution recorded); `gen:governance-baseline:check` (`:check` ONLY) exit 0 at frozen `1e62c5ad5bf7`/141, live/post-foundation 203/62 (F-1); tool counts unmoved, no new key (#31); `bootstrap-classes.ts` absent from the diff, `BOOTSTRAP_VERSION` stays `2159ec9e6f69`; changeset added (`@iris-mcp/shared` patch — L-6); the OS suite untouched (`total` vs `Test*` count, #35, unchanged).
12. **AC 37.1.12** - **Gate duties folded in (no 37.0 in this epic — L-5).** Confirm `epic37` exists off `main` (`2ed83ff` or later) and is the current branch before any code lands (L-1; HALT and escalate otherwise); Rule #57 machinery armed for this story's review (bounded-close, frozen-diff snapshot, delivery receipts — Epic 36 closed non-degraded, hold that bar); suite baselines re-measured at pickup with per-package standalone runs (prior figures in `deferred-work.md` → "Epic 36 retro-review gate" → "Suite baselines", per `36-0-CR-Z`; the `35-1-DEV-1` and `36-4-CR-4` parallel flakes are environmental); the ledger is NOT triaged here — the Rule #37 exception in the epic preamble stands and the Epic 38 gate owns the transferred obligation.

## Lead pre-story probe — what the correct-course session verified (2026-09-16)

Everything below is READ-ONLY evidence from source reading on `main` @ `2ed83ff` and one run of the built dist against a closed local port. **The shared instance was not touched.** Re-run cheaply if you extend anything (Rule #16). Line numbers are as of `2ed83ff`.

**P1 — The fatal path, end to end (`packages/shared/src/server-base.ts`).** `start()` (`:1937`) → `loadConfig()` (`:1941-1942`, THROWS on missing `IRIS_USERNAME`/`IRIS_PASSWORD` — `config.ts:135-141` — the rejection reaches the entry point's `Fatal:` catch, `packages/iris-dev-mcp/src/index.ts:31-34`, which exits 1: that is the CONFIG fail-fast route and stays) → profile registry (`:1943-1952`) → governance/preset/file/audit parses (`:1954-2019`; explicit `process.exit(1)` at `:1995` audit config and `:2011` unwritable audit dir — F-3, untouched) → **`:2023` eager `getOrCreate(DEFAULT_PROFILE_NAME)`** → **`:2026-2034` `await checkHealth(defaultClient)`; catch → `logger.error("IRIS health check failed: …")` → `process.exit(1)` → `return`** → `:2037-2043` negotiation (failure = warn + v1) → `:2045-2047` "starting with Atelier API v…" log → `:2049-2072` bootstrap when `needsCustomRest` (failure = warn) → `:2082-2085` `profileMeta.set(DEFAULT_PROFILE_NAME, { atelierVersion, bootstrapAttempted: needsCustomRest === true })` → **`:2088-2091` stdio transport connect**. The exit at `:2033` precedes the connect at `:2090`; nothing after it runs.

**P2 — The lazy path already has the target semantics.** `getOrCreateClient` (`:2166`): fast path when `profileMeta` has the profile (`:2181-2186`); otherwise coalesced via `establishing` (`:2192-2211`). `establishProfile` (`:2220`): `registry.getOrCreate(profile.name)` → if no meta: `checkHealth(client)`; on throw `registry.drop(profile.name)` then rethrow (AC 14.2.8); negotiation (failure = warn + v1); `meta = { atelierVersion, bootstrapAttempted: false }`; then `attemptProfileBootstrap(profile, client, version)` once when `needsBootstrap`. `handleToolCall` (`:1506-1531`) wraps `getOrCreateClient` and returns `{ content: [{ text: 'Could not connect to server profile "<name>": <message>' }], isError: true }` on throw (text at `:1528`). NOTHING in `establishProfile` special-cases `default`; it is simply never reached for `default` today because `start()` seeds `profileMeta` first (or exits). `ProfileClientRegistry` (`profiles.ts:667-723`): `getOrCreate` resolves via `resolveProfile` (works for `default`, `:637`), `drop` (`:708`) destroys + deletes any cached client, no name checks. The `default` profile is synthesized at `profiles.ts:424` as `{ name: "default", ...defaultConfig }` — it carries EVERY `IrisConnectionConfig` field, so `bootstrap(client, profile, version)` on the lazy path receives the same inputs as `bootstrap(client, this.config, version)` on the eager path (`bootstrap` signature: `bootstrap.ts:446-450`, second arg `IrisConnectionConfig`).

**P3 — Empirical reproduction (no IRIS involved).** Built dist of 2026-09-11 06:07. Command and result:

```
IRIS_HOST=127.0.0.1 IRIS_PORT=9 IRIS_USERNAME=probe IRIS_PASSWORD=probe \
IRIS_PROFILES='{"other":{"host":"127.0.0.1","port":52773}}' \
node packages/iris-dev-mcp/dist/index.js </dev/null
# exit code 1
# stderr:
# [INFO] Tool visibility: preset="full" visible=30 hidden=0
# [ERROR] IRIS health check failed: Failed to connect to IRIS at 127.0.0.1:9. Verify the host and port are correct, and that IRIS is running.
```

No `Connected via stdio transport` line; the `other` profile was never probed (nothing listens on 52773 on this host either — a probe would have logged a second connection error). macOS has no `timeout` binary: wrap timed runs as `perl -e 'alarm 30; exec @ARGV' -- node …` (exit code preserved).

**P4 — Test blast radius (mechanical).** Exactly ONE existing test pins the exit: `packages/shared/src/__tests__/server-base.test.ts:558-569` ("should call process.exit when health check fails" — `fetchMock.mockRejectedValue(new TypeError("Connection refused"))`, then `expect(exitMock).toHaveBeenCalledWith(1)`; `process.exit` is spied at `:546-550`). The eager-establishment pins that MUST stay green unmodified: `server-base.test.ts:728` ("establishes the default profile eagerly in start() and reuses that client" — asserts no extra fetches after start and `atelierVersion === 8`), `server-param.test.ts:340`, `server-param-integration.test.ts:357`, `governance-enforcement.test.ts:285`, `governance-preset-cross-surface.test.ts:329`. **38 test files** define a LOCAL `stageDefaultStartup(fetchMock)` helper (one `HEAD` 200 + one version response — e.g. `governance-file.test.ts:764`, `governance-enforcement-coverage.test.ts:253`, `resolve-profile-client.test.ts:170`; count via `grep -rl stageDefaultStartup packages/*/src/__tests__/*.ts | wc -l`); every one stages the SUCCESS path, which option A leaves byte-for-byte. `server-param.test.ts:529-599` is the existing AC 14.2.8 non-default retry suite — the natural template for the `default` recovery test (AC 37.1.5). Tests that read `ctx.atelierVersion` expect the fixture's `8` (`server-base.test.ts:386`, `resolve-profile-client.test.ts:223`, `tool-types.test.ts:166`) — unaffected.

**P5 — The private `atelierVersion` field.** `private atelierVersion = 1` (`:381`, JSDoc "unchanged back-compat field" — it is PRIVATE; no external reader). Writers/readers: `:2039`/`:2042` (negotiation), `:2046` (startup log), `:2055` (eager bootstrap arg), `:2083` (meta seed). After a failed eager attempt it stays `1` and the startup log would print "Atelier API v1" — misleading; on the failed path log "default profile not established" instead. Calls never read the field; they read `profileMeta` (`:2186`, `:2257`, `:2261`). Decision per AC 37.1.2 (c).

**P6 — Other consumers and surfaces.** `checkHealth` (`health.ts:29`) = `HEAD /api/atelier/` with a 5 s timeout (`HEALTH_CHECK_TIMEOUT`), throws `IrisConnectionError` (`errors.ts:15-27`; message already ends with the recovery suggestion). `ping()` (`health.ts:58`) is exported but has NO caller in `server-base.ts` (grep) — the "monitoring loop (Story 1.4)" its comment mentions does not exist; ledger candidate (AC 37.1.10). `iris_server_profiles` never connects (README `:472`) — unaffected, and it remains the right first call after startup. The `iris-mcp-credentials test --connect` CLI reuses `checkHealth` and throws — correct for a diagnostic, unchanged. The `iris-mcp-launcher` extension only spawns the server (`extensions/iris-mcp-launcher/src/extension.ts`); no health handling of its own — verdict for AC 37.1.9.

**P7 — Docs surfaces found by grep (verdict each, AC 37.1.9).** `README.md`: `:78` (`IRIS_PROFILES` row), `:97` (single-server "behaves exactly as it always has" — still true for the SUCCESS path; consider one clause), `:109` (removing `IRIS_PASSWORD` "breaks startup for all of them" — CONFIG, stays true), `:344-356` (Profiles), `:472` (discovery works when unreachable), `:528-540` (Backward Compatibility — add the bullet). `docs/client-config/README.md`: `:30` ("Omitting `IRIS_USERNAME` fails at startup" — config, stays true), `:289` (`claude mcp list` health check — add the L-4 line). `claude-code.md:164/:235/:313`, `claude-desktop.md:23/:280`, `cursor.md:233/:311` mention startup only for config failures — verdicts expected "unchanged". `tool_support.md`: no key moves.

**P8 — Branch, gate and version facts.** `main` = `2ed83ff`; wave-5 tip `63bf908` has an IDENTICAL tree (`git diff --stat 63bf908 2ed83ff` empty). `epic37` was cut off `main` (`2ed83ff`) on 2026-09-16 and the planning-artifact commit is its first commit (L-1). No 37.0 gate (L-5) — AC 37.1.12 carries the gate duties. `BOOTSTRAP_VERSION` at Epic 36 close: `2159ec9e6f69` (retro §6); confirm at pickup with the read-only `SELECT ExecuteMCPv2.Setup_GetBootstrapVersion()` via `iris_sql_execute` and by reading `packages/shared/src/bootstrap-classes.ts`. Changesets: `.changeset/config.json` has `fixed: [["@iris-mcp/*"]]` — one `@iris-mcp/shared: patch` entry bumps the suite together.

**Not verified — yours (AC 37.1.2):** (a) `drop` + `getOrCreate` round trip for `default` in a unit test; (b) `establishProfile` with `profile.name === "default"` end to end incl. bootstrap; (c) the `atelierVersion` decision; (d) the `instructions` string and each `index.ts` wording. Also: whether `epic35-defect-gate.test.ts`'s arming convention fits a closed-port-default gate (read it first); whether a Server-Manager profile is available locally for the `IRIS_SERVER_MANAGER=auto` leg; the `iris-ops-mcp` dist leg.

## Tasks / Subtasks

- [ ] **Task 1 — Probe-first (AC 37.1.1, 37.1.2).** Re-confirm the anchors on the epic branch; run probes (a)–(d); record verbatim in Dev Notes; decide the `atelierVersion` handling with the reason.
- [ ] **Task 2 — The fix (AC 37.1.3).** Rewrite the `:2026-2034` catch: ERROR log (existing message + continuation line) → `this.clients.drop(DEFAULT_PROFILE_NAME)` → skip `:2037-2085` (negotiation, "starting with" log, bootstrap, meta seed) via a single `defaultEstablished` flag → fall through to the transport connect. Keep the success path byte-identical. Update the startup log for the failed path. Update JSDoc/comments at `:1506-1510`, `:1924-1935`, `:2025-2026`, `:2137-2141`, `:2220-2230`, `profiles.ts:655-665`.
- [ ] **Task 3 — Unit tests (AC 37.1.4–37.1.7).** Flip `server-base.test.ts:558`; add a new default-suite file (e.g. `server-base-default-outage.test.ts`) using `server-param.test.ts:529-599` as the template: startup survives (multi-profile AND single-profile), other serves, default degrades → recovers, drop/re-create, bootstrap-once across recovery, coalescing; a `toEqual` pin of the success-path fetch sequence. Mutation-prove RED with `process.exit(1)` reinstated; record the Rule #59 path statement.
- [ ] **Task 4 — Live proof + armed gate (AC 37.1.8).** Rebuild; run the built `iris-dev-mcp` and `iris-ops-mcp` dists with `default` → `127.0.0.1:9` and `other` → the real instance; drive `initialize` + two `tools/call`s over stdio; keep the JSON-RPC driver script disposable (delete before staging). Pre-fix dist reproduces exit 1. Add the permanent armed gate (arming convention from `epic35-defect-gate.test.ts`). Server-Manager leg with a recorded verdict.
- [ ] **Task 5 — Docs, CHANGELOG, changeset (AC 37.1.9, 37.1.11).** Every surface in P7 with a verdict; CHANGELOG "Pre-release — <date>" Fixed entry (since Story 14.1, `213756b`); `.changeset/*.md` with `"@iris-mcp/shared": patch`.
- [ ] **Task 6 — Ledger candidates (AC 37.1.10).** Three LOW rows in a new `deferred-work.md` section for this story (strictness knob + trigger; discovery reachability; `ping()` unused). No count claims beyond "+3 LOW opened" with the arithmetic shown (#51).
- [ ] **Task 7 — Gates and gate duties (AC 37.1.11, 37.1.12).** Branch check; Rule #57 arming; baselines re-measured; `pnpm turbo run build test lint type-check` (standalone substitution recorded if needed); `gen:governance-baseline:check`; `bootstrap-classes.ts` absent from the diff; `BOOTSTRAP_VERSION` unchanged; OS suite untouched.

## Dev Notes

### Fix shape (option A) — target code, refine in review

```ts
// start(), replacing the :2026-2034 catch. Success path unchanged.
let defaultEstablished = true;
try {
  await checkHealth(defaultClient);
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`IRIS health check failed: ${message}`);
  logger.error(
    `Continuing startup without the "${DEFAULT_PROFILE_NAME}" profile: tools targeting it will ` +
      `return a connection error until it is reachable, then recover automatically (no restart needed).`,
  );
  // AC 14.2.8 symmetry: drop the un-established client so the first call
  // re-creates it and re-attempts establishment via establishProfile().
  this.clients.drop(DEFAULT_PROFILE_NAME);
  defaultEstablished = false;
}

if (defaultEstablished) {
  // :2037-2085 exactly as today — negotiation, "starting with" log, bootstrap, profileMeta seed.
} else {
  logger.info(`${this.options.name} v${this.options.version} starting; "${DEFAULT_PROFILE_NAME}" profile not yet established`);
}
// :2088-2091 transport connect, unchanged.
```

With `profileMeta` unset for `default`, the first `getOrCreateClient("default", needsCustomRest)` misses the fast path (`:2181`) and runs `establishProfile` (`:2220`), which is EXACTLY the non-default first-touch flow: health → negotiation → meta → one-time bootstrap. No new establishment logic (Rule #47). The `establishing` map coalesces concurrent first touches (AC 14.2.7).

### Traps

- **Do not go fully lazy (option B).** Keeping the eager attempt preserves the startup-time bootstrap report and keeps the 38 `stageDefaultStartup` files untouched. Deleting steps 2–4.5 would move a possibly long bootstrap inside the first tool call (the Epic 36 client-ceiling problem) and re-sequence dozens of tests for the same user-visible outcome.
- **`profileMeta.set(DEFAULT_PROFILE_NAME, …)` must stay INSIDE the success branch** with `bootstrapAttempted: this.options.needsCustomRest === true` — the comment at `:2074-2081` explains why hard-coding `true` would skip the first-use bootstrap on a `needsCustomRest: false` server.
- **Only the health-check exit moves.** `:1995` (audit config) and `:2011` (audit dir) stay `process.exit(1)`; `loadConfig`/governance/preset/file parse errors stay THROWN (they surface through each entry point's `Fatal:` catch). F-3.
- **Reuse the existing per-call envelope** at `:1506-1531`; do not add a second "could not connect" shape.
- **Startup log on the failed path** must not print "Atelier API v1" — print that the default profile is not yet established.
- **Test seams:** existing tests spy `process.exit` (`server-base.test.ts:546-550`) and call `server.start("stdio")` under `globalThis.fetch` mocks — the new tests must assert `start()` RESOLVES and `exitMock` was NOT called, then drive `handleToolCall` via the existing `callTool` helpers the neighbouring suites use. For the recovery leg, make the mock path-aware (route `HEAD` vs version `GET` by URL) so the first rejected `HEAD` and the later successful `HEAD` do not shift a shared response queue (the AC 36.1.7 lesson).
- **Every fake must be a real shape (#54):** a rejected `fetch` (`TypeError`) IS what Node's `fetch` produces on ECONNREFUSED; a `HEAD` 200 + the version JSON are the real success shapes (see `versionResponse()` in `server-base.test.ts:690-700`).
- **Rule #55:** never generate file content through a shell heredoc; `git diff --stat` after every write.
- **The shared instance is never stopped.** Closed local port only. Real-instance traffic read-only.

### Testing standards

- vitest; new tests in the DEFAULT suite (no excluded suffix); per-package standalone runs acceptable per `35-1-DEV-1` with the substitution recorded.
- Rule #59: state the guarded path for each pin and show it RED with the fix reverted.
- Rule #19 mechanical proof: `git diff --stat -- 'packages/*/src/__tests__'` lists only the intended files; the F-2 pins pass unmodified.
- Rule #22/#26: the live proof runs the BUILT dist in a fresh Node process over real stdio JSON-RPC, on two server packages.

### Doc surfaces — enumerate exhaustively (#56), verdict each

`README.md` (`:78`, `:97`, `:109`, `:344-356`, `:472`, `:528-540`); `docs/client-config/README.md` (`:30`, `:289`); `docs/client-config/claude-code.md`, `claude-desktop.md`, `cursor.md`; `packages/iris-dev-mcp/README.md`, `packages/iris-admin-mcp/README.md`, `packages/iris-interop-mcp/README.md`, `packages/iris-ops-mcp/README.md`, `packages/iris-data-mcp/README.md`, `packages/iris-mcp-all/README.md`; `extensions/iris-mcp-launcher/README.md`; `tool_support.md`; `CHANGELOG.md`; JSDoc in `server-base.ts` and `profiles.ts`; the MCP `instructions` string; each server's `index.ts` `Fatal:` wording.

### Project Structure Notes

- `packages/shared/src/server-base.ts` — the fix (`start()`), JSDoc.
- `packages/shared/src/profiles.ts` — header comment only (`:655-665`); no code change expected.
- `packages/shared/src/__tests__/server-base.test.ts` — one test flips.
- `packages/shared/src/__tests__/server-base-default-outage.test.ts` (new) — AC 37.1.4–37.1.7.
- `packages/shared/src/__tests__/<armed live gate>.test.ts` (new) — AC 37.1.8; arming convention from `epic35-defect-gate.test.ts`.
- `.changeset/<name>.md` — `"@iris-mcp/shared": patch`.
- Docs listed above; `_bmad-output/implementation-artifacts/deferred-work.md` — this story's ledger-candidate section.

### References

- `docs/bugs-2026-09-16.md` — the bug record: evidence, four fix options, workaround.
- `_bmad-output/planning-artifacts/sprint-change-proposal-2026-09-16-default-profile-outage.md` — Lead decisions L-1 … L-6, Rule #37 exception.
- `_bmad-output/planning-artifacts/architecture.md` — D1 (`:396`), M1 (Epic 37 record).
- `_bmad-output/implementation-artifacts/14-1-multi-server-profiles-config-and-resolution.md:134` — the original "default stays fatal" clause (historical; not edited).
- `.claude/rules/project-rules.md` — #16/#47 (probe-first), #19 (mechanical back-compat), #21 (capstone in the default suite), #22/#26 (live smoke on the built dist), #48/#59 (RED proof on the guarded path), #54 (real fake shapes), #55 (no heredocs), #56 (enumeration completeness), #57 (review layers), #31 (no tool count moves), #23/#25 (baseline `:check` only).
- `packages/shared/src/__tests__/server-param.test.ts:529-599` — the AC 14.2.8 retry suite (template for the recovery tests).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## QA Results

## Code Review
