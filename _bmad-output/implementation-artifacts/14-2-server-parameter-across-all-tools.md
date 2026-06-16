# Story 14.2: `server` Parameter Across All Tool Schemas

Status: done

## Story

As an AI client told to "use the prod server",
I want every tool to accept an optional `server` profile-name parameter,
so that I can target a profile per call without any other change, and omitting it transparently uses the default.

## Acceptance Criteria

1. **AC 14.2.1** — Every tool in all five servers gains an **optional** `server` (string) parameter with the description: "Named server profile to target for this call (from `IRIS_PROFILES`). Omit to use the default server."
2. **AC 14.2.2** — The shared tool-registration helper injects `server` into each tool's Zod schema **centrally** (not hand-added per tool), so coverage is uniform and future tools inherit it (arch decision D2). Injection happens in `@iris-mcp/shared` `registerTool` ([server-base.ts:221-252](../../packages/shared/src/server-base.ts#L221-L252)).
3. **AC 14.2.3** — `server` resolves via `resolveProfile` (14.1) and selects the connection for that call; concurrent calls with different `server` values do not interfere (analogous to the existing per-call `namespace` override, FR7b/FR7c). **(Integration AC.)**
4. **AC 14.2.4** — Omitting `server` → default profile. **Existing clients that never send `server` are unaffected** (back-compat gate). Adding one optional field to every advertised `inputSchema` is additive/non-breaking per D2.
5. **AC 14.2.5** — Precedence with `namespace`: `server` selects the instance/profile; `namespace` still overrides the namespace **within** that profile. Both may be combined. (`buildToolContext`'s `resolveNamespace(override)` returns `override ?? profile.namespace`.)
6. **AC 14.2.6** — Tests confirm `server` is present on a representative tool per server, resolution works, unknown-profile errors surface cleanly (structured `isError`, not a crash), and concurrent mixed-profile calls stay isolated. **(Integration AC.)**
7. **AC 14.2.7 (routed from 14.1 CR — MED #1, concurrency race):** `getOrCreateClient` caches the establishment **Promise** per profile (e.g. `Map<string, Promise<{client, atelierVersion}>>`) so two concurrent first-touch calls for the same profile await **one** shared establishment and `attemptProfileBootstrap` runs **at most once** per profile. Add a concurrent-dispatch test (two simultaneous `getOrCreateClient(sameProfile, true)` → bootstrap called once).
8. **AC 14.2.8 (routed from 14.1 CR — MED #2, failed-health-check meta):** Decide and implement the first-touch health-check-failure semantics: on `checkHealth` rejection for a non-default profile, **`destroy()` + drop the cached client** (so the failure is retryable and no un-established client lingers) — OR record an explicit `failed`-state meta — rather than silently caching an un-established client with no meta. Add a test driving a non-default first-touch health-check rejection and asserting the chosen semantics (recommended: retryable — next call re-attempts cleanly).

## Integration ACs

**First consumer of Story 14.1's profile registry.** This story wires `resolveProfile` + `getOrCreateClient` (from 14.1) into `handleToolCall`, making the per-call `server` selection observable. AC 14.2.3 and AC 14.2.6 are the integration ACs (per-call resolution + concurrent isolation). The full cross-server end-to-end isolation + governance test is owned by Story 14.5 (AC 14.5.6).

## Tasks / Subtasks

- [x] Task 1: Central `server` param injection (AC 14.2.1, 14.2.2, 14.2.4 — D2)
  - [x] In `registerTool` ([server-base.ts](../../packages/shared/src/server-base.ts)), build an extended schema once: `withServerParam(tool.inputSchema)` = `tool.inputSchema.extend({ server: z.string().optional().describe("Named server profile to target for this call (from IRIS_PROFILES). Omit to use the default server.") })`. The extended schema's `.shape` is advertised to the SDK (so `server` is visible) and the extended schema is stored in `this.extendedSchemas` for validation in `handleToolCall`.
  - [x] Defined the `server` Zod field once as the module constant `SERVER_PARAM_FIELD` (consumed by the `withServerParam` helper) so the description is identical everywhere and future tools inherit it automatically.
  - [x] Confirmed `outputSchema` is untouched (test: "does not add `server` to a tool's outputSchema").
- [x] Task 2: Per-call profile selection in `handleToolCall` (AC 14.2.3, 14.2.5)
  - [x] Validate against the stored extended schema (so `server` is captured, not stripped). Extract `server` via rest-destructure and **strip it before calling the handler** (`const { server, ...validatedArgs } = parseResult.data`) so handlers stay byte-for-byte unchanged.
  - [x] `resolveProfile(this.profiles, server)`; on `ProfileResolutionError` return a structured `isError` result (the error's message names the bad profile + lists valid names); do NOT throw out of the SDK handler.
  - [x] `const { client, atelierVersion } = await this.getOrCreateClient(profile.name, this.options.needsCustomRest ?? false)`; on a first-touch establishment failure return a structured `isError` (does not throw out of the SDK handler).
  - [x] Build context with the resolved **profile** as `config` (so `resolveNamespace` defaults to the profile's namespace) + that profile's `client` + `atelierVersion`. Default path (omitted `server`) remains byte-for-byte today's behavior — verified by a test asserting no extra fetches after `start()`.
  - [x] `buildToolContext` signature unchanged; passes the resolved `IrisProfile` (a structural `IrisConnectionConfig`) as its `config` arg.
- [x] Task 3: Concurrency race fix (AC 14.2.7 — routed 14.1 CR MED #1)
  - [x] Added per-profile in-flight establishment Promise caching (`this.establishing: Map<string, Promise<…>>`) in `getOrCreateClient`; the async work was factored into a private `establishProfile`. Concurrent first-touch calls for the same profile await one shared establishment; bootstrap runs at most once. Entry cleared in `finally` so failures are retryable.
- [x] Task 4: Failed-health-check semantics (AC 14.2.8 — routed 14.1 CR MED #2)
  - [x] **Decision: retryable.** On non-default first-touch `checkHealth` failure, `establishProfile` calls `ProfileClientRegistry.drop(profile.name)` (new method: `destroy()` + delete from cache) then re-throws, so no un-established client lingers and the next call re-creates a fresh client + retries. Chosen over a `failed`-state meta because a transient outage should be retryable (the deferred-work item's recommended semantics).
- [x] Task 5: Tests (AC 14.2.6, 14.2.7, 14.2.8) — new file `packages/shared/src/__tests__/server-param.test.ts` (14 tests)
  - [x] Shared-level: advertised schema contains `server` (+ exact description, optional); `server:"prod"` selects prod's client + namespace; omitted `server` → default (back-compat, no extra fetches); unknown `server` → structured `isError` listing valid names; `namespace` + `server` combine (precedence); concurrent mixed-profile calls stay isolated; `server` stripped before handler.
  - [x] Representative-per-server: asserts the advertised schema contains `server` for one real tool name from EACH of the 5 servers (`iris_doc_get`, `iris_user_get`, `iris_docdb_find`, `iris_production_status`, `iris_metrics_system`) via the shared mechanism (no cross-package import — shared has no dep on the server packages).
  - [x] Concurrent-dispatch (14.2.7: two simultaneous `getOrCreateClient(other,true)` → bootstrap once, one shared client, exactly one health+negotiation) + health-check-failure (14.2.8: drop + retryable; tool call surfaces structured `isError`).
- [x] Task 6: Regression + back-compat
  - [x] `pnpm turbo run build && pnpm turbo run test && pnpm turbo run lint` all exit 0 (build 6/6, test 12/12 tasks, lint 6/6). No `BOOTSTRAP_VERSION` bump (TypeScript-only). All 5 server packages' test suites pass unchanged — the additive `server` field broke no schema assertions. With no `IRIS_PROFILES`, every existing tool behaves byte-for-byte as before.

## Dev Notes

### Architecture decision D2 (the design authority — [architecture.md](../planning-artifacts/architecture.md) "Multi-Server Profiles & Tool Governance")

> **D2 — `server` is a framework parameter, injected centrally, invisible to handlers.** Merge `server: z.string().optional()` into every tool's input schema at registration (extending `tool.inputSchema.shape`). `handleToolCall` consumes `server` to select the profile client, then strips it before invoking the handler. Handlers keep using `ctx.http` / `ctx.resolveNamespace(namespace)` exactly as today — **zero handler changes**. Back-compat: one optional field added to every advertised `inputSchema` is additive/non-breaking per JSON-Schema/MCP semantics — calls omitting `server` behave identically; output schemas untouched.

### The 14.1 seam (already built — read it before wiring)

- `getOrCreateClient(profileName, needsBootstrap) → Promise<{ client, atelierVersion }>` ([server-base.ts:560-607](../../packages/shared/src/server-base.ts#L560-L607)) — resolveProfile → getOrCreate client → (cached meta? return) else first-touch health-check + version-negotiation + optional bootstrap, set `profileMeta`. **This is the seam to call from `handleToolCall`.** Its current race window (existence check → async establish → meta set with no in-flight cache) is AC 14.2.7.
- `handleToolCall` currently hard-resolves the default profile at [server-base.ts:306-319](../../packages/shared/src/server-base.ts#L306-L319) with an inline comment marking exactly where 14.2 hooks in. It is already `async`, so awaiting `getOrCreateClient` is free.
- `buildToolContext(scope, config, http, atelierVersion)` ([server-base.ts:110](../../packages/shared/src/server-base.ts#L110)) — `resolveNamespace(override)` returns `override ?? config.namespace`. Pass the resolved **profile** as `config` so namespace precedence (AC 14.2.5) falls out naturally.
- `resolveProfile(registry, name?)` ([profiles.ts:329](../../packages/shared/src/profiles.ts#L329)) throws `ProfileResolutionError` (carries `.requested` + `.validProfiles`) for unknown names — convert to a structured `isError` result in `handleToolCall`, do not let it escape the SDK handler.

### Back-compat gate (release-critical)

With no `IRIS_PROFILES`, only `default` exists; `resolveProfile(registry, undefined)` → default; `getOrCreate("default")` returns the eagerly-established client. So the omitted-`server` path is byte-for-byte today's. The added optional `server` field is the only schema change — additive. Prove with a test that an omitted-`server` call routes to the default client/version exactly as before.

### Testing standards & ObjectScript note

- Vitest; `packages/shared/src/__tests__/*.test.ts`. Concurrency tests use `Promise.all` of two `getOrCreateClient`/`handleToolCall` invocations with mocked `fetch`/health. No live IRIS required.
- TypeScript-only; **no `BOOTSTRAP_VERSION` bump**. No `docs/adr/` registry — architecture.md D2 is the design authority.

### References

- [Source: epics.md#Story-14.2] — ACs verbatim.
- [Source: architecture.md#D2] — central injection, strip-before-handler, additive back-compat.
- [Source: deferred-work.md] — "Triaged via Story 14.0" + the two "[14.1 / MED]" items routed here (AC 14.2.7, 14.2.8).
- [Source: packages/shared/src/server-base.ts] — registerTool (221), handleToolCall (261), getOrCreateClient (560), buildToolContext (110).
- [Source: packages/shared/src/profiles.ts] — resolveProfile, ProfileResolutionError, ProfileClientRegistry.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context) — via bmad-dev-story.

### Debug Log References

- Probed the MCP SDK's `_registeredTools[name].inputSchema.shape` to confirm the advertised schema reflects the extended shape (`['name','server']`) — the SDK stores it as a `ZodMiniObject` exposing `.shape`. The injected `server` field carries its `.description` on the Zod v4 `.description` accessor.
- `npx tsc --noEmit` (shared) clean; `npx turbo run build|test|lint` all exit 0.

### Completion Notes List

- **D2 implemented exactly as the architecture authority specifies:** central injection in `registerTool` (one shared `SERVER_PARAM_FIELD` constant via a `withServerParam` helper — never hand-added per tool), validation against the stored extended schema, and rest-destructure strip of `server` before the handler runs. Zero handler changes across all 5 servers (their test suites pass unchanged). `outputSchema` untouched.
- **Back-compat gate proven:** the omitted-`server` path resolves the `default` profile and returns its eagerly-established client/version with no additional fetches after `start()` (asserted). The only advertised-schema change is the one optional `server` field — additive per JSON-Schema/MCP.
- **AC 14.2.5 precedence falls out of the design:** `buildToolContext` receives the resolved `IrisProfile` as `config`, so `resolveNamespace(override)` returns `override ?? profile.namespace` — `server` picks the instance, `namespace` overrides within it.
- **AC 14.2.7 (routed CR MED #1):** in-flight establishment Promise cache (`this.establishing`) keyed by profile name; the prior race (existence-check → async establish → meta-set with no in-flight cache) is closed. Async work extracted into `establishProfile`; coalescing also covers the first-bootstrap-of-an-already-established-client case, so bootstrap is truly at-most-once even under concurrency. Cache entry cleared in `finally` (settles on success OR failure) → failures are retryable.
- **AC 14.2.8 (routed CR MED #2):** chose **retryable** semantics. New `ProfileClientRegistry.drop(name)` (`destroy()` + delete) is called on a non-default first-touch `checkHealth` rejection before re-throwing, so no un-established client lingers; the next call re-creates + retries. A tool call hitting this surfaces a structured `isError` ("Could not connect to server profile …") rather than throwing out of the SDK handler.
- No new dependencies. No `BOOTSTRAP_VERSION` bump (TypeScript-only, all in `@iris-mcp/shared`).
- `withServerParam` and `SERVER_PARAM_FIELD` are module-level (exported from `server-base.ts` for testability) but intentionally NOT added to the public barrel (`index.ts`) — D2's whole point is that server packages never touch the `server` field; keeping it off the barrel preserves a minimal public surface.

### File List

- `packages/shared/src/server-base.ts` — modified: added `SERVER_PARAM_FIELD` constant + `withServerParam` helper; `registerTool` injects the extended schema centrally and stores it in `this.extendedSchemas`; `removeTools` drops the extended-schema entry; `handleToolCall` validates the extended schema, strips `server`, resolves the profile (structured `isError` on unknown), get-or-creates the profile client (structured `isError` on establishment failure), and builds context from the resolved profile; added `this.establishing` in-flight Promise cache + `establishProfile` private method (concurrency coalescing + retryable health-check-failure drop).
- `packages/shared/src/profiles.ts` — modified: added `ProfileClientRegistry.drop(profileName)` (destroy + remove a single cached client; supports AC 14.2.8 retryable semantics).
- `packages/shared/src/__tests__/server-param.test.ts` — new: 14 tests covering AC 14.2.1–14.2.8 (advertised-schema injection + exact description, representative-per-server, outputSchema untouched, runtime-added tools, default/back-compat selection, prod selection, namespace precedence, unknown-profile structured error, strip-before-handler, concurrent mixed-profile isolation, concurrent-dispatch bootstrap-once, health-check-failure retryable + structured error).

## Change Log

- 2026-06-15 — Story 14.2 implemented (D2). Central `server` parameter injected into every tool's advertised input schema in `@iris-mcp/shared` `registerTool`; `handleToolCall` consumes `server` to select the per-call profile client (via the 14.1 `getOrCreateClient` seam), strips it before the handler, and builds context from the resolved profile (namespace precedence preserved). Routed 14.1 CR items closed: AC 14.2.7 (per-profile in-flight establishment Promise cache → bootstrap-once under concurrency) and AC 14.2.8 (first-touch health-check failure drops the cached client → retryable). Additive/back-compat: omitting `server` is byte-for-byte today's behavior; output schemas untouched; no `BOOTSTRAP_VERSION` bump. Tests: shared 262 → 276 (+14); full suite green (build/test/lint exit 0).
- 2026-06-15 — Code review (adversarial, 3 layers: Blind Hunter / Edge Case Hunter / Acceptance Auditor). Acceptance Auditor confirmed **exact D2 conformance** (central injection, consume-then-strip before handler, zero handler changes, output schemas untouched, omitted-`server` byte-for-byte) and that all 8 ACs (14.2.1–14.2.8) + both Integration ACs are genuinely exercised (not schema-shape-asserted). **No HIGH findings; no D2 mismatch.** Two MED hardening patches auto-resolved inline (F1 reserved-field collision guard; F5 missing-extended-schema fail-fast). Shared tests 291 → 293 (+2 guard tests); build/test/lint exit 0. See Review Findings.

### Review Findings (code review 2026-06-15)

Severity legend: HIGH (release-blocking), MED (fix or justify), LOW/INFO (optional). Layers: `blind` (no context), `edge` (project read), `auditor` (spec/D2).

**Patches applied inline (auto-resolved):**

- [x] [Review][Patch] F1 — Reserved-field collision: a tool declaring its own `server` arg was silently clobbered then stripped [packages/shared/src/server-base.ts:72 `withServerParam`] — `source: blind+edge`, MED. `.extend(SERVER_PARAM_FIELD)` silently replaces a same-named key, and the rest-destructure strip then removes it before the handler → a tool would lose its own `server` argument with no error. No current tool declares `server:` (grep over `**/tools/**` confirmed → latent), but the doc comment promises "future tools inherit it automatically," so this is a forward landmine. **Fix:** `withServerParam(inputSchema, toolName?)` now throws at registration if `inputSchema.shape` already owns a `server` key, naming the offending tool (fail-fast, aligns with the suite's fail-fast convention + D2's "framework reserves `server`"). Test added (`server-param.test.ts`: "fails fast … reserved `server` field (CR F1)").

- [x] [Review][Patch] F5 — Silent `?? tool.inputSchema` fallback would strip `server` and mis-route to default if the extended-schema invariant ever broke [packages/shared/src/server-base.ts:359 `handleToolCall`] — `source: edge`, MED (defensive). Currently unreachable (registerTool always populates `extendedSchemas` before the SDK callback can fire; removeTools deletes both together), but if a future refactor registered an SDK callback without the extended schema, validation would fall back to the unextended schema → `server` stripped as unknown key → the call silently runs against the `default` profile while the caller believes they targeted a named server (silent mis-routing, no error). **Fix:** replaced the `?? tool.inputSchema` fallback with a hard invariant — a missing extended schema now returns a structured `isError` ("not fully registered") instead of silently mis-routing. Test added (`server-param.test.ts`: "missing extended schema fails fast … not a silent default-profile mis-route (CR F5)").

**Deferred (pre-existing or out-of-scope; added to deferred-work.md):**

- [x] [Review][Defer] F2 — Coalesced in-flight establishment Promise is keyed by profile name only, ignoring `needsBootstrap` variance [packages/shared/src/server-base.ts:726] — `source: blind`, MED→deferred. If an establishment started with `needsBootstrap=false` is in flight when a second caller arrives with `needsBootstrap=true`, the second caller coalesces onto the first promise and may receive a client whose bootstrap never ran (future callers re-establish+bootstrap correctly via `bootstrapAttempted=false`). **Latent only:** `handleToolCall` always passes the constant `this.options.needsCustomRest ?? false`, so within one server instance `needsBootstrap` never varies per profile. The public `getOrCreateClient(name, needsBootstrap)` signature is the footgun. Deferred — fixing means keying the cache by `(profile, needsBootstrap)` or documenting/enforcing the invariant; touches 14.2's concurrency design with no current trigger.

- [x] [Review][Defer] F4 — Untrimmed / mis-cased `server` value yields a confusing (but safe) "unknown profile" error [packages/shared/src/profiles.ts:333 `resolveProfile`] — `source: edge`, MED→deferred. `"prod "`, `" prod"`, `"PROD"` all throw `ProfileResolutionError` (exact `registry.get`, no trim/normalize); stray whitespace inside the quoted name is easy to miss. Not a crash — structured `isError`. **Deferred (not patched) deliberately:** the QA integration suite (`server-param-integration.test.ts:366`) asserts whitespace-only `"   "` is NOT treated as default and surfaces unknown-profile; trimming at resolution would alter that QA-asserted semantics, and AC 14.2 does not mandate trimming (the 14.1 CR already deferred whitespace-name handling to a profile-parsing hardening pass). Conservative classification per triage rules.

- [x] [Review][Defer] F6 — `addTools()` re-adding an already-registered name throws uncaught, now after `extendedSchemas` + `tools` are already mutated [packages/shared/src/server-base.ts:480] — `source: edge`, LOW→deferred, pre-existing. The MCP SDK's `registerTool` throws on a duplicate name; this throw propagates uncaught out of `addTools` (no try/catch). 14.2 adds one more map (`extendedSchemas`) written before the throw → marginally larger partial-state-on-throw. The legitimate remove→add cycle is handled correctly (removeTools deletes both maps + the SDK entry). Pre-existing duplicate-registration behavior, not introduced by 14.2.

- [x] [Review][Defer] F9 — Secondary coalescing branch (already-established client + first concurrent bootstrap) is code-correct but lacks a dedicated test [packages/shared/src/server-base.ts:715,788] — `source: auditor`, INFO→deferred. The fast-path guard returns synchronously only when `existingMeta && (!needsBootstrap || existingMeta.bootstrapAttempted)`; the established-but-not-yet-bootstrapped + concurrent path correctly flows through `this.establishing` coalescing before `establishProfile` bootstraps once. The existing AC 14.2.7 test exercises first-touch (no prior meta); this secondary interleaving is asserted-by-reasoning, not exercised. Optional added test for maximal rigor.

**Dismissed as noise / false-positive (4):**

- F3 (blind, MED) — "Non-`ProfileResolutionError` rethrow escapes the SDK callback" [server-base.ts:407]. **Dismissed:** verified `resolveProfile` only ever throws `ProfileResolutionError` (profiles.ts:335-337), which the catch handles; the defensive `throw error` is correct dead-path style and never fires for the only error that call can raise.
- F7 (blind, LOW) — "`negotiateVersion` failure permanently caches `atelierVersion=1`". **Dismissed:** verified `negotiateVersion` catches internally and returns `DEFAULT_VERSION` — it never throws (atelier.ts:98-103); the `try/catch` in `establishProfile` is defensive/dead. By-design graceful degradation, pre-existing, not introduced by 14.2.
- F8 (blind, LOW) — "Redundant double `resolveProfile` per call". **Dismissed:** `resolveProfile` is a cheap idempotent Map lookup; the second call inside `getOrCreateClient` is harmless. Negligible.
- F10 (auditor, INFO) — "N-way integration test proves per-profile once-establishment, not same-key coalescing". **Dismissed:** no actual gap — same-key coalescing IS covered by the dev suite's two-caller `"other"` test (`server-param.test.ts:443-473`).
