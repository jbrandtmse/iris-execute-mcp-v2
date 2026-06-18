# Story 14.1: Multi-Server Profiles — Config Model & Connection Resolution

Status: done

## Story

As an operator running the MCP suite against more than one IRIS instance,
I want to define named server profiles and have the connection layer resolve the right one per call,
so that one running server process can target prod, staging, or dev without separate processes — while my existing single-server setup keeps working untouched.

## Acceptance Criteria

1. **AC 14.1.1** — `@iris-mcp/shared` parses an `IRIS_PROFILES` env var (JSON object: `{ "<name>": { host, port, username, password, namespace, https } }`) at startup into a profile registry. Malformed JSON fails fast with a clear startup error naming the offending var (`IRIS_PROFILES`).
2. **AC 14.1.2** — The **default profile** is synthesized from the existing `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE`/`IRIS_HTTPS` vars and registered under a reserved name (`default`). When `IRIS_PROFILES` is absent, only the default profile exists — **byte-for-byte today's behavior** (back-compat gate).
3. **AC 14.1.3** — A profile in `IRIS_PROFILES` may omit fields; omitted fields inherit from the default profile (so a profile can override just `host`).
4. **AC 14.1.4** — `IrisHttpClient` resolves connection config by profile name; sessions/cookies are cached **per profile** (no cross-profile session bleed). Implemented via a per-profile client registry (`Map<profileName, IrisHttpClient>`) — each profile gets its own client instance, and `IrisHttpClient` already isolates session state per instance (`cookies`, `csrfToken`, `sessionEstablished` are instance fields — [http-client.ts:45-50](../../packages/shared/src/http-client.ts#L45-L50)).
5. **AC 14.1.5** — A `resolveProfile(name?)` helper returns the named profile or the default when `name` is undefined; an unknown profile name throws a structured error listing valid profile names.
6. **AC 14.1.6** — Unit tests: default-only (no `IRIS_PROFILES`), multi-profile parse, field inheritance, unknown-profile error, **per-profile session isolation**, malformed-JSON startup failure. **(De-risking priority — see Dev Notes; land the session-isolation test red→green first.)**
7. **AC 14.1.7** — **Lazy per-profile bootstrap (arch decision D8):** the default profile's client is created eagerly at startup (preserving today's bootstrap/health-check/Atelier-negotiation). A non-default profile's client is created on first use; for custom-REST tools, the framework attempts the existing auto-bootstrap flow ([server-base.ts:411-433](../../packages/shared/src/server-base.ts#L411-L433)) once per profile and, on failure, returns the existing structured "steps succeeded/failed + manual remediation" report (FR12/FR13) as a clear error — never a silent no-op. Atelier-only tools never trigger bootstrap.

## Integration ACs

**Service-introducing story — no consumer in this story.** Story 14.1 introduces the shared profile registry, `resolveProfile`, and the per-profile `IrisHttpClient` registry. **The first consumer will be Story 14.2** (`server` parameter across all tool schemas), which wires `resolveProfile` into `handleToolCall` so a per-call `server` value selects the profile's client. The cross-server end-to-end integration test (per-profile session isolation + governance enforcement) is owned by **Story 14.5 (AC 14.5.6)** by epic design. This story's verification is the AC 14.1.6 unit suite, with per-profile session isolation as the priority case. This satisfies the epic-cycle Integration-AC gate escape clause (producer with no consumer yet in this story).

## Tasks / Subtasks

- [x] Task 1: Profile config model + parsing (AC 14.1.1, 14.1.2, 14.1.3)
  - [x] Add an `IrisProfile` shape (a named `IrisConnectionConfig`) and a `ProfileRegistry` type. Decide placement: new module [`packages/shared/src/profiles.ts`](../../packages/shared/src/profiles.ts) (per architecture D-blast-radius "two new modules `profiles.ts`, `governance.ts`").
  - [x] In [`config.ts`](../../packages/shared/src/config.ts) (`loadConfig`, lines 43-83), synthesize the reserved `default` profile from the existing `IRIS_*` vars (reuse the current parsing exactly — do not change single-server behavior). **Implemented via `buildProfileRegistry(loadConfig(env), env)`; `loadConfig` left byte-for-byte unchanged (back-compat gate). Central entry point `loadProfileRegistry(env)` composes the two — see Decision note below for why parsing lives in `profiles.ts` not inside `loadConfig` (return-type back-compat).**
  - [x] Parse `IRIS_PROFILES` (JSON). On parse failure, throw a clear error naming `IRIS_PROFILES` (mirror the existing fail-fast style in `loadConfig`, e.g. the `IRIS_PORT`/`IRIS_TIMEOUT` errors).
  - [x] Field inheritance: a profile entry may omit fields; merge each profile over the `default` profile so an entry can override just `host`. Re-derive `baseUrl` from the merged `host`/`port`/`https`.
  - [x] Reserved-name handling: if `IRIS_PROFILES` defines `default`, it overrides the `IRIS_*`-derived one with a startup **warning** (`logger.warn`), per Implementation Notes.
- [x] Task 2: `resolveProfile(name?)` helper + structured unknown-profile error (AC 14.1.5)
  - [x] Return the named profile, or the `default` profile when `name` is undefined/empty.
  - [x] Unknown name → throw a structured error listing valid profile names. **Chose a dedicated `ProfileResolutionError` (extends `Error`, carries `requested` + `validProfiles`) rather than `IrisConnectionError`/`IrisApiError`: this is a config/lookup error with no HTTP status or network cause, so neither existing type fits its shape — documented in `profiles.ts` JSDoc.**
- [x] Task 3: Per-profile client registry (AC 14.1.4, 14.1.7 — arch decision D1/D8)
  - [x] In [`server-base.ts`](../../packages/shared/src/server-base.ts), replace the single `private http: IrisHttpClient | undefined` with a `ProfileClientRegistry` wrapping a lazily-populated `Map<profileName, IrisHttpClient>` (implemented in `profiles.ts` so isolation is unit-testable without a live server).
  - [x] Provide a `getOrCreateClient(profileName)` path: default profile created eagerly in `start()` (preserve today's health-check + Atelier-version negotiation exactly); non-default created on first touch, then cached (health-check + negotiation on first touch).
  - [x] D8 lazy bootstrap: on first custom-REST use of a non-default profile, attempt the existing auto-bootstrap orchestration, cache the result (`bootstrapAttempted` flag — run at most once per profile); on failure surface the existing structured remediation report as a warning. Atelier-only tools pass `needsBootstrap: false` and never trigger it.
  - [x] **Scope boundary with 14.2:** built the registry + get-or-create + default-eager + resolution helper and unit-tested isolation. Did NOT add the `server` Zod field or change `handleToolCall`'s per-call selection — `handleToolCall` stays on the default profile (D2/14.2). `buildToolContext` signature unchanged so 14.2 can pass the per-profile client with zero handler changes.
- [x] Task 4: Unit tests (AC 14.1.6) — `packages/shared/src/__tests__/profiles.test.ts` (+ server-base.test.ts for registry integration)
  - [x] default-only (no `IRIS_PROFILES`) → only `default` exists; asserts byte-for-byte equality with today's `loadConfig` output (back-compat gate).
  - [x] multi-profile parse; field inheritance (override just `host`, inherit the rest); unknown-profile structured error (asserts valid names listed); malformed-JSON startup failure (asserts `IRIS_PROFILES` named).
  - [x] **per-profile session isolation** (priority — landed red→green FIRST): two profiles → two distinct `IrisHttpClient` instances; a cookie/session set on one does not appear on the other's request headers; destroying one profile's client leaves the other's session intact. Asserts distinct instances + isolated cookie/CSRF state, all without a live server (mocked fetch).
- [x] Task 5: Regression + back-compat verification
  - [x] `pnpm turbo run build`, `pnpm turbo run test`, `pnpm turbo run lint` exit 0 across the monorepo.
  - [x] With no `IRIS_PROFILES`/`IRIS_GOVERNANCE` set, existing shared/server tests pass unchanged (no behavior drift — all 6 server packages green, totals unchanged).
  - [x] No `BOOTSTRAP_VERSION` bump (TypeScript-only; no ObjectScript / `bootstrap-classes.ts` changes — verified via git status).

### Review Findings

Adversarial code review (2026-06-15, `/bmad-code-review` — Blind Hunter + Edge Case Hunter + Acceptance Auditor). Verdict: **back-compat gate holds, session isolation (D1) genuinely proven, no D2 scope over-reach, no AC violations.** `config.ts` confirmed byte-for-byte unchanged (git diff empty). One HIGH and one MED auto-resolved inline; remaining items deferred (none block the story).

**Resolved (HIGH):**

- [x] [Review][Patch] Default profile falsely pre-marked `bootstrapAttempted: true` regardless of whether bootstrap ran [packages/shared/src/server-base.ts:500-503] — `start()` hard-coded `bootstrapAttempted: true` for the `default` profile even when `needsCustomRest:false` (no bootstrap actually ran). A later first custom-REST use of the default profile via the Story-14.2 seam `getOrCreateClient("default", true)` would then skip the default's bootstrap forever (the non-default path correctly seeds `false`). Convergent HIGH from Blind Hunter (#4/#9) + Edge Case Hunter (#1). **Fixed:** set `bootstrapAttempted: this.options.needsCustomRest === true` so the flag reflects actual execution. **Regression tests added** to `profiles-bootstrap.test.ts` (default-profile first custom-REST use bootstraps once on a `needsCustomRest:false` server; and is NOT re-bootstrapped on a `needsCustomRest:true` server). Latent in 14.1 (no production caller of `getOrCreateClient` yet) but a real defect in the changed method's contract and a 14.2 landmine — fixed now.

**Resolved (MED):**

- [x] [Review][Patch] Story File List omitted two QA test files — `profiles-resolution.test.ts` (~494 lines) and `profiles-bootstrap.test.ts` (~199 lines) existed, passed, and carry the strongest D8 / AC-14.1.5 coverage, but were absent from the File List (authored in the QA pass after the dev File List was written). Acceptance Auditor MED. **Fixed:** both added to the File List with coverage descriptions.

**Deferred (tracked in `deferred-work.md`; none block this story):**

- [x] [Review][Defer] Concurrency race in `getOrCreateClient` first-touch path [packages/shared/src/server-base.ts:566-593] — `await checkHealth`/`negotiateVersion` sit between the `profileMeta.get` check and the `profileMeta.set` write with no in-flight promise cache, so two concurrent first-touch calls for the same non-default profile could both establish + both bootstrap. No active caller in 14.1 (the concurrent-dispatch path is created when Story 14.2 wires `handleToolCall`); deferred to 14.2, which must add per-profile in-flight promise dedup. Blind Hunter #1.
- [x] [Review][Defer] Non-default first-touch health-check failure caches the client but records no meta [packages/shared/src/server-base.ts:565 vs 580/593] — a thrown `checkHealth` leaves the client cached with no `profileMeta`, so every subsequent call re-runs health/negotiation (retry-on-next-call, defensible) and the cached client is never `destroy()`-ed. Low impact (no session established on a failed health check); revisit with 14.2's real call path. Edge Case Hunter #2.
- [x] [Review][Defer] `port` / `timeout` validation accepts coerced strings/booleans/arrays via `Number()` (asymmetric with strict `https`) [packages/shared/src/profiles.ts:140-149, 195-206] — `"443"`→443, `true`→1, `[443]`→443 pass silently; `https` strictly requires a boolean. Hardening, additive; no correctness bug (NaN/fractional/out-of-range still rejected). Edge Case Hunter #3/#4, Blind Hunter #5.
- [x] [Review][Defer] Whitespace-only profile name registered without error; unknown/typo'd profile keys silently ignored [packages/shared/src/profiles.ts:277, mergeProfile] — a `"   "` key registers an effectively-unreachable profile; a typo'd field (`hostname` for `host`) silently inherits the default host. Operational footguns, not crashes. Edge Case Hunter #5, Blind Hunter #6.
- [x] [Review][Defer] No `destroyAll()` / shutdown drain on `McpServerBase`; default-vs-override profile construction divergence [packages/shared/src/server-base.ts, profiles.ts mergeProfile] — `ProfileClientRegistry.destroyAll()` is never called by the server (pre-existing lifecycle gap, not a 14.1 regression — the old single `this.http` was also never destroyed); and the default profile is built via `{...defaultConfig}` spread while non-default profiles enumerate fields explicitly in `mergeProfile`, so a future *optional* `IrisConnectionConfig` field would silently drop from non-default profiles (required fields are type-guarded). Maintainability note. Blind Hunter #2/#11.

**Dismissed as noise:** redundant tautological timeout-propagation test (the value-reaches-client assertion exists separately at `profiles-resolution.test.ts:191-193`); `atelierVersion` dual storage (set equal in `start()`); double-`start()` re-entrancy (out of contract); `getSetCookie` monkeypatch (matches existing `http-client.test.ts`/`atelier.test.ts` convention); `destroy()` idempotency. D7's literal "parse in `config.ts`/`loadConfig`" location was assessed as an **acceptable intent-preserving refinement, not a Rule-6 violation** — the dev placed parsing in `profiles.ts` (`loadProfileRegistry` composes `loadConfig` + `buildProfileRegistry`) because changing `loadConfig`'s return type would break every caller and the release-critical back-compat gate; D7's intent (central startup parse + fail-fast + default synthesis + inheritance) is fully satisfied and the deviation is documented in the Decisions section.

**Post-fix verification:** `pnpm --filter @iris-mcp/shared test` → 262 passed (13 files); `pnpm turbo run lint` → 6/6 successful; `pnpm --filter @iris-mcp/shared build` → tsc exit 0.

## Dev Notes

### The crux — why a profile is not a namespace (arch decision D1)

The existing per-call `namespace` override ([server-base.ts:110](../../packages/shared/src/server-base.ts#L110) `resolveNamespace`) is a **path-only string on the same authenticated session**. A server profile is a **different host + credentials → a different session** (cookie jar, CSRF token, base URL) and cannot reuse a single `IrisHttpClient`. This drives the per-profile client registry. `IrisHttpClient` already holds all session state as instance fields ([http-client.ts:45-52](../../packages/shared/src/http-client.ts#L45-L52): `cookies`, `csrfToken`, `sessionEstablished`, `activeControllers`), so **isolation is achieved structurally by one client instance per profile** — there is no shared mutable session state to leak as long as the registry never hands the same client to two profiles. The session-isolation test (AC 14.1.6) is the mechanical proof; it is the highest-value test in the epic's foundation — write it first (red→green) per the epic's de-risking priority.

### Architecture decisions in scope (from [architecture.md](../planning-artifacts/architecture.md) "Multi-Server Profiles & Tool Governance", 2026-06-15)

- **D1 — Per-profile client registry (the crux):** replace single `this.http` ([server-base.ts:154](../../packages/shared/src/server-base.ts#L154), created in `start()` ~line 385) with `Map<profileName, IrisHttpClient>`. Default eager at startup; non-default lazy on first touch (health-check + Atelier negotiation), then cached.
- **D7 — Config parsing & fail-fast:** parse `IRIS_PROFILES` centrally in `config.ts`/`loadConfig` at startup; malformed JSON fails fast naming the offending var. Default profile synthesized from `IRIS_*` under reserved name `default`; profiles may omit fields to inherit the default's.
- **D8 — Lazy per-profile bootstrap with graceful failure:** custom-REST tools require `ExecuteMCPv2` on the target instance; attempt the existing auto-bootstrap flow once per profile on first custom-REST call, cache the result, fall back to the structured remediation report on failure. Atelier-only tools never trigger bootstrap. The bootstrap attempt mutating the target on first use is identical to today's default-profile startup — it is part of establishing the profile's connection, not a separately-governed action.
- **Out of D2 (deferred to 14.2):** do NOT inject the `server` Zod field or change `handleToolCall` selection here.

### Current code patterns to preserve

- [`config.ts:43-83`](../../packages/shared/src/config.ts#L43-L83) `loadConfig` — returns one `IrisConnectionConfig` from `IRIS_*`; throws clear errors for bad `IRIS_PORT`/`IRIS_TIMEOUT` and missing `IRIS_USERNAME`/`IRIS_PASSWORD`. **Mirror this fail-fast style** for `IRIS_PROFILES`. Keep the single-config path intact for the default profile.
- [`http-client.ts:54-57`](../../packages/shared/src/http-client.ts#L54-L57) `IrisHttpClient` constructor takes `(config, defaultTimeout)`. Each profile's client is `new IrisHttpClient(mergedConfig, mergedConfig.timeout)`.
- [`server-base.ts:150-174`](../../packages/shared/src/server-base.ts#L150-L174) `McpServerBase` holds `config`, `http`, `atelierVersion`; capabilities at line 163 (`tools: { listChanged: true }` — leave unchanged; `resources` is Story 14.5).
- [`server-base.ts:102-136`](../../packages/shared/src/server-base.ts#L102-L136) `buildToolContext(scope, config, http, atelierVersion, pageSize)` — keep its signature so 14.2 can hand it the per-profile client + that profile's namespace default + that profile's negotiated Atelier version.

### Testing standards

- Vitest. Unit tests in `packages/shared/src/__tests__/*.test.ts`; integration (live IRIS) in `*.integration.test.ts` (do not put live-IRIS dependence in the AC 14.1.6 unit suite — isolation must be provable without a server, by asserting distinct instances + isolated state with mocked/!established sessions).
- Existing references: [`config.test.ts`](../../packages/shared/src/__tests__/config.test.ts), [`http-client.test.ts`](../../packages/shared/src/__tests__/http-client.test.ts), [`server-base.test.ts`](../../packages/shared/src/__tests__/server-base.test.ts).

### Back-compat gate (release-critical)

Epic 14 is **strictly additive**. With neither `IRIS_PROFILES` nor `IRIS_GOVERNANCE` set, behavior must be **byte-for-byte** today's. AC 14.1.2 + the default-only test are the proof. Do not change `loadConfig`'s output for the no-`IRIS_PROFILES` case.

### ObjectScript / IRIS note

No ObjectScript classes change in this story (TypeScript-only). No `BOOTSTRAP_VERSION` bump. There is no project ADR registry (`docs/adr/` absent); the architecture.md "Multi-Server Profiles & Tool Governance" section (decisions D1–D8) is the design authority.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-14.1] — ACs verbatim.
- [Source: _bmad-output/planning-artifacts/architecture.md#Multi-Server-Profiles-&-Tool-Governance] — D1, D7, D8 (lines 372-412).
- [Source: _bmad-output/planning-artifacts/prd.md] — FR111, FR112 (default profile back-compat; `server` carries profile name only).
- [Source: packages/shared/src/config.ts] — `loadConfig` fail-fast pattern.
- [Source: packages/shared/src/http-client.ts] — per-instance session state (isolation substrate).
- [Source: packages/shared/src/server-base.ts] — `this.http` (154), `start()` (~385), `buildToolContext` (102), bootstrap orchestration (411-433).

## Dev Agent Record

### Agent Model Used

Claude Opus 4.8 (1M context) — `claude-opus-4-8[1m]`. Implemented via the `bmad-dev-story` skill.

### Debug Log References

- Baseline (before changes): `@iris-mcp/shared` 205 tests passing (10 files). Full suite: 12 turbo tasks successful.
- De-risking: AC 14.1.6 per-profile session-isolation test written FIRST; confirmed RED (`Failed to load url ../profiles.js`), then GREEN after `profiles.ts` landed.
- After changes: `@iris-mcp/shared` 230 tests passing (11 files) = +25. Full suite: `build` 6/6 exit 0; `test` 12/12 exit 0; `lint` 6/6 exit 0.
- One transient lint failure (`makeConfig` unused helper in `profiles.test.ts`) fixed by removing the dead helper + its `IrisConnectionConfig` import.

### Completion Notes List

- **Crux delivered (D1):** A profile is not a namespace — it is host+credentials → a distinct session. Replaced the single `McpServerBase.http` with a `ProfileClientRegistry` (`Map<profileName, IrisHttpClient>`); each profile gets its own client, so cookie/CSRF/session state is isolated structurally. The session-isolation unit test proves it without a live server (distinct instances + no cookie bleed + independent destroy).
- **Back-compat gate held (AC 14.1.2):** `loadConfig`'s signature and output are untouched. With no `IRIS_PROFILES`, the registry has exactly one `default` profile whose connection fields equal `loadConfig` output byte-for-byte (asserted by stripping `name` and `toEqual(loadConfig(env))`). `handleToolCall` still resolves only the default profile (synchronous cached lookup) — no behavior drift; all pre-existing tests pass unchanged.
- **Config parsing (D7):** `loadProfileRegistry(env)` is the central startup entry point — composes `loadConfig` + `buildProfileRegistry`. Malformed `IRIS_PROFILES` (bad JSON, non-object root, non-object entry) fails fast with an error naming `IRIS_PROFILES`, mirroring `loadConfig`'s `IRIS_PORT`/`IRIS_TIMEOUT` style. Field inheritance merges each entry over the default and re-derives `baseUrl`. A `default` redefinition logs `logger.warn`.
- **Lazy bootstrap (D8):** `getOrCreateClient(profileName, needsBootstrap)` establishes non-default profiles lazily (health-check + version negotiation on first touch, cached). Custom-REST first-use attempts the existing `bootstrap()` orchestration once per profile (`bootstrapAttempted` flag); on failure it logs the existing structured remediation report as a warning — never a silent no-op. Atelier-only callers pass `needsBootstrap: false`. Non-default health-check failure throws (becomes a tool error in 14.2) rather than `process.exit` — only the default profile's startup failure stays fatal.
- **Scope boundary respected (D2/14.2):** No `server` Zod field injected; `handleToolCall` per-call selection unchanged. `getOrCreateClient` is the seam 14.2 will call. `buildToolContext` signature unchanged.
- **No `BOOTSTRAP_VERSION` bump:** TypeScript-only; no ObjectScript or `bootstrap-classes.ts` changes (verified via `git status`).

### Decisions (non-obvious)

- **Parsing lives in `profiles.ts`, not inside `loadConfig`:** Making `loadConfig` return the registry would change its return type and break every existing caller (e.g. `server-base.ts` `this.config = loadConfig()`), violating the back-compat gate. Instead `loadConfig` stays as-is and `loadProfileRegistry`/`buildProfileRegistry` (in `profiles.ts`) compose on top. This also keeps the runtime import one-directional (`profiles.ts` → `config.ts`; `config.ts` imports nothing from `profiles.ts`), avoiding an ESM cycle. D7's "config parsing in the config layer" is satisfied — the config-loading concern is composed in one entry point.
- **`ProfileClientRegistry` placed in `profiles.ts` (not only as a private field in `server-base.ts`):** makes per-profile session isolation provable in a true unit test with no `McpServerBase`/`start()`/live-server dependency, matching the Dev Notes requirement. `server-base.ts` consumes it.
- **`ProfileResolutionError` is a dedicated class** (carries `requested` + `validProfiles`) rather than reusing `IrisConnectionError`/`IrisApiError` — it is a config/lookup error with no HTTP status or network cause.
- **`timeout` is inherited** by derived profiles from the default (not in the documented per-profile schema, but each client needs a sane timeout); a profile may still override it explicitly.

### File List

- packages/shared/src/profiles.ts (new) — `IrisProfile`/`ProfileRegistry` types, `DEFAULT_PROFILE_NAME`, `buildProfileRegistry`, `loadProfileRegistry`, `resolveProfile`, `ProfileResolutionError`, `ProfileClientRegistry`.
- packages/shared/src/server-base.ts (modified) — replaced single `this.http` with `ProfileClientRegistry` + per-profile metadata; default-eager establishment in `start()`; new async `getOrCreateClient` + `attemptProfileBootstrap` (D1/D8); `handleToolCall` resolves the default profile's client.
- packages/shared/src/index.ts (modified) — barrel exports for the new profile symbols/types.
- packages/shared/src/__tests__/profiles.test.ts (new) — AC 14.1.6 suite: priority session-isolation cases + default-only back-compat + multi-profile parse + inheritance + `default`-override warning + malformed-JSON fail-fast + `resolveProfile` + `loadProfileRegistry`.
- packages/shared/src/__tests__/profiles-resolution.test.ts (new, QA) — complementary AC 14.1.3/14.1.5/14.1.1/14.1.4 coverage: disjoint-subset overrides, https/port/timeout inheritance + baseUrl re-derivation, whitespace/case-sensitive resolve contract, `ProfileResolutionError` lists every valid name, malformed-JSON message-text assertions, `default`-override warns exactly once, `ProfileClientRegistry` `has()`/`destroyAll()` lifecycle, empty-`IRIS_PROFILES`-as-absent back-compat. *(Added to File List during code review — was authored in the QA pass after the dev File List was written.)*
- packages/shared/src/__tests__/profiles-bootstrap.test.ts (new, QA) — D8 lazy per-profile bootstrap contract (AC 14.1.7): bootstrap attempted at most once per profile across repeated custom-REST calls, targets the profile's own config, Atelier-only never bootstraps, graceful bootstrap failure does not throw, plus the code-review regression tests for the default-profile bootstrap-flag fix. *(Added to File List during code review.)*
- packages/shared/src/__tests__/server-base.test.ts (modified) — per-profile client registry integration tests (default-eager reuse, non-default lazy isolation, unknown-profile error, `handleToolCall` default-path back-compat).

## Change Log

| Date       | Version | Description                                                                                                   | Author |
|------------|---------|---------------------------------------------------------------------------------------------------------------|--------|
| 2026-06-15 | 0.1     | Implemented Story 14.1: profile registry (`profiles.ts`), `resolveProfile`, per-profile `IrisHttpClient` registry with default-eager / non-default-lazy creation (D1/D8), `IRIS_PROFILES` parsing + default synthesis + field inheritance + fail-fast (D7). AC 14.1.6 unit suite (session-isolation landed red→green first). Strictly additive — no `loadConfig` behavior change, no `BOOTSTRAP_VERSION` bump. shared tests 205→230; build/test/lint all exit 0. | Amelia (Dev) |
