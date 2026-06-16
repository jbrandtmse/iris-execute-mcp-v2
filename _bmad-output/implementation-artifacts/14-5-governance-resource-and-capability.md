# Story 14.5: Governance Discovery Resource & `resources` Capability

Status: done

## Story

As an AI client,
I want to read the effective governance policy for a profile,
so that I can avoid attempting blocked actions — without the resource being a security dependency.

## Acceptance Criteria

1. **AC 14.5.1** — Each server declares the MCP **`resources` capability** in its initialize response (net-new — suite is tools-only today). Additive: clients that ignore `resources` are unaffected. (Per D6: `resources: { listChanged: true }`.)
2. **AC 14.5.2** — Implements `resources/list` (a default/global policy resource) and `resources/templates/list` exposing `iris-governance://{profile}`.
3. **AC 14.5.3** — `resources/read` of `iris-governance://{profile}` returns the effective enabled/disabled action map for that profile (from `getEffectivePolicy`), as JSON; unknown profile → structured error.
4. **AC 14.5.4** — The resource is **advisory** — the call-time gate (14.4) remains the authoritative boundary; a client that never reads the resource still gets correct enforcement.
5. **AC 14.5.5** — Tests: capability advertised, list/templates/read shapes, per-profile policy correctness, unknown-profile error.
6. **AC 14.5.6** — **Cross-server foundation integration test (D1/D5):** an end-to-end test across at least two servers verifies (a) **per-profile session isolation** — concurrent calls to two profiles do not share cookies / CSRF token / session state (D1); and (b) **uniform governance enforcement** — a write action disabled by policy is rejected at call time identically on each server, while read actions pass (D5). This story explicitly owns the cross-cutting risk that per-story unit tests (e.g. AC 14.1.6) do not cover end-to-end. **This is the foundation's highest-value test — land it before declaring Epic 14 done.**

## Integration ACs

**Consumer of Story 14.3 (`getEffectivePolicy`) + 14.1 (profiles) + 14.4 (governance config/gate).** The resource (AC 14.5.2/14.5.3) and the cross-server test (AC 14.5.6) ARE the integration ACs — AC 14.5.6 is the epic's capstone integration test for D1 (session isolation) and D5 (uniform enforcement).

## Tasks / Subtasks

- [x] Task 1: `resources` capability + governance resource (D6)
  - [x] Declare the `resources` capability. Per D6, add `resources: { listChanged: true }` to the `new McpServer(...)` capabilities ([server-base.ts:303-305](../../packages/shared/src/server-base.ts#L303-L305)). NOTE: the MCP SDK (1.29.0) auto-registers the `resources` capability + the `resources/list` / `resources/read` / `resources/templates/list` request handlers when you call `registerResource`; verify whether the explicit capability declaration is additive or conflicts with the SDK's auto-registration, and do whichever yields a correct `initialize` response advertising `resources` (a test asserts it). **Verified empirically:** the underlying `Server.registerCapabilities` uses `mergeCapabilities` and only throws when called AFTER a transport connects (`server/index.js:86-91`); the SDK's `setResourceRequestHandlers` calls `registerCapabilities({ resources: { listChanged: true } })` (`server/mcp.js:339-343`) — identical to the constructor declaration — so the two MERGE idempotently with no conflict. Declared it explicitly in the constructor per D6.
  - [x] Register a STATIC resource for the **default/global** policy (e.g. name `iris-governance-default`, URI `iris-governance://default`) whose read callback returns `getEffectivePolicy("default", this.governanceConfig, allKeys, this.mutatesLookup)` as JSON. This populates `resources/list` (AC 14.5.2).
  - [x] Register a `ResourceTemplate` `iris-governance://{profile}` whose read callback `(uri, variables)` returns `getEffectivePolicy(variables.profile, …)` as JSON. This populates `resources/templates/list` + serves `resources/read` (AC 14.5.2/14.5.3). Unknown profile → structured error (resolveProfile throws `ProfileResolutionError`; map it to a clear resource-read error, do not crash the server). **Mapped to `McpError(ErrorCode.InvalidParams, …)`** so the read rejects cleanly without crashing; the `ResourceTemplate` `list` callback is `undefined` (D6 minimal — the template is for parameterized read, not enumeration of all profiles; the SDK requires the field passed explicitly even when undefined).
  - [x] Read-result shape: `{ contents: [{ uri, mimeType: "application/json", text: JSON.stringify(policy) }] }` (confirm against the SDK `ReadResourceResult` type in `@modelcontextprotocol/sdk/.../mcp.d.ts`). **Confirmed** against `types.d.ts` `ReadResourceResultSchema` (`contents: [{ uri, mimeType?, text }]`).
- [x] Task 2: `allKeys` computation for the policy map
  - [x] Compute the union of `GOVERNANCE_BASELINE` ∪ this server's registered tool/action keys (bare `tool` for single-op; `tool:action` per enum value — reuse the SAME key logic as `computeGovernanceKey` / the generator so the resource's keys match the gate's). Expose/store it (e.g. `this.governedKeys`) so the resource read returns the full effective map. **Implemented as `this.governedKeys` + `rebuildGovernedKeys()`, rebuilt at construction and on `addTools`/`removeTools`.**
- [x] Task 3: Advisory-only guarantee (AC 14.5.4)
  - [x] Inline doc/comment + a test that a client which NEVER reads the resource still gets correct enforcement (the gate is authoritative). The resource is read-only/advisory; reading it has no effect on enforcement. **Doc on `GOVERNANCE_URI_SCHEME` + `registerGovernanceResource` JSDoc; tests "a client that NEVER reads the resource still gets the seed-disabled write denied" and "reading the resource does NOT change enforcement".**
- [x] Task 4: Resource tests (AC 14.5.5) — `packages/shared/src/__tests__/*.test.ts`
  - [x] `resources` capability advertised in the `initialize` result. **(via the underlying `Server.getCapabilities()`, which IS what `_oninitialize` returns; asserted pre- and post-start).**
  - [x] `resources/list` includes the default policy resource; `resources/templates/list` includes `iris-governance://{profile}`; `resources/read` of `iris-governance://prod` returns the correct effective map for `prod` (cross-check against `getEffectivePolicy`); `resources/read` of an unknown profile → structured error.
  - [x] Drive these through the real `McpServerBase` / SDK surface (mirror the `server.server._registeredResources` / `_registeredResourceTemplates` access pattern, or an in-memory client). **Drove the REAL registered request handlers on the underlying `Server` (`_requestHandlers.get("resources/read")` etc.) — full dispatch incl. URI→template matching, since this SDK build ships no in-memory client/transport.**
- [x] Task 5: **AC 14.5.6 — cross-server integration test (the capstone)**
  - [x] Construct **two** `McpServerBase` instances (use two real server packages' tool sets, e.g. `@iris-mcp/iris-dev-mcp` + `@iris-mcp/iris-admin-mcp`, OR two synthetic tool sets — pick what makes the assertions clean and keeps the test in the DEFAULT suite with mocked `fetch`). Two profiles (`default` + a second, e.g. `prod`). **Two synthetic tool sets on two `McpServerBase` instances, each with `default` + `prod` profiles on four distinct hosts.**
  - [x] **(a) Per-profile session isolation (D1):** concurrent calls targeting two different profiles must use distinct `IrisHttpClient` instances — no shared cookie jar / CSRF token / session state. Assert (mocked fetch) that a cookie/session established on profile A's client never appears on profile B's request headers, across both servers, under concurrency (`Promise.all`). **Host-aware fetch mock issues a host-unique `Set-Cookie`; the test asserts each host's GET carries ONLY its own cookie and never another host's session token, under `Promise.all`, plus all four clients are distinct instances.**
  - [x] **(b) Uniform governance enforcement (D5):** with the same `IRIS_GOVERNANCE` disabling a write action, BOTH servers reject that action at call time with the identical structured denial (`code:"GOVERNANCE_DISABLED"`), while a read action passes on both. Proves enforcement is uniform across servers (one shared chokepoint). **Both servers deny the write byte-identically (same `structuredContent` + text) on default + prod; reads pass on both. A third test confirms the advisory resource on both servers agrees with the gate.**
  - [x] Keep it deterministic + in the default `vitest run` (mocked fetch); if a live-IRIS variant is added, make it a `*.integration.test.ts` that does not break the default run. **The capstone is hermetic and MUST run by default, so it is `governance-cross-server.test.ts` (NOT `.integration.test.ts`, which the vitest config excludes from the default run). No live-IRIS variant added.**
- [x] Task 6: Regression + back-compat
  - [x] `pnpm turbo run build && pnpm turbo run test && pnpm turbo run lint` exit 0. **No `BOOTSTRAP_VERSION` bump.** Adding the `resources` capability is additive — existing tools-only clients are unaffected (a test confirms `tools/list` still works and tools behave unchanged). **All three exit 0 (FINAL_EXIT=0). No `BOOTSTRAP_VERSION` bump; governance-baseline drift check still passes (no tool-surface change). Back-compat: the `tools` capability + all tool behavior are unchanged — every pre-existing shared/server test still passes.**

## Dev Notes

### Architecture decision D6 (design authority — [architecture.md](../planning-artifacts/architecture.md) "Multi-Server Profiles & Tool Governance")

> **D6 — Minimal governance resource (no premature framework).** Add `resources: { listChanged: true }` to capabilities; implement `resources/list`, `resources/templates/list` (`iris-governance://{profile}`), and `resources/read` → `getEffectivePolicy(profile)` as JSON. Build a focused governance-resource provider; do NOT generalize into a `ResourceDefinition` framework yet (YAGNI — one resource type today). *Rationale:* additive (clients ignoring `resources` unaffected); generalize only when a second resource appears.

AC 14.5.6 also exercises **D1** (per-profile client registry / session isolation) and **D5** (one enforcement chokepoint) end-to-end.

### MCP SDK 1.29.0 resource API (verified)

- `registerResource(name, uriOrTemplate, config, readCallback)` — static (URI string) OR dynamic (`ResourceTemplate`). Registering a resource auto-advertises the `resources` capability and wires `resources/list` / `resources/read` / `resources/templates/list`. (`packages/shared/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts`.)
- `ResourceTemplate` (class) for `iris-governance://{profile}`; the read callback receives `(uri: URL, variables: { profile }, extra)`.
- `ReadResourceResult`: `{ contents: [{ uri, mimeType, text }] }` — confirm the exact field names in the SDK types.
- `McpServerBase.server` getter ([server-base.ts:1020](../../packages/shared/src/server-base.ts#L1020)) exposes the `McpServer` for test-time inspection of `_registeredResources` / `_registeredResourceTemplates` (mirrors the 14.4 test harness's `_registeredTools` access).

### Engine API (from 14.3/14.4 — already shipped)

- `getEffectivePolicy(profile, config, allKeys, mutatesLookup, baseline?) → Record<key, boolean>`.
- `this.governanceConfig` (parsed in `start()`), `this.mutatesLookup` (built from the live tool registry) — both already present from Story 14.4.
- `resolveProfile(registry, name?)` throws `ProfileResolutionError` for unknown — reuse for the unknown-profile resource error.

### Back-compat / advisory (release-critical)

The `resources` capability is purely additive — a tools-only client is unaffected. The resource is **advisory**: enforcement is the 14.4 gate, not the resource. Do not make any code path depend on the client having read the resource.

### Testing standards & notes

- Vitest; `packages/shared/src/__tests__/*.test.ts`. Resource + cross-server tests use mocked `fetch` (no live IRIS in the default suite). AC 14.5.6 is the capstone — make its isolation + uniform-enforcement assertions strong and unambiguous.
- TypeScript-only; **no `BOOTSTRAP_VERSION` bump**. No `docs/adr/` — architecture.md D1/D5/D6 is the design authority.

### References

- [Source: epics.md#Story-14.5] — ACs verbatim (note AC 14.5.6 is the Epic-14-done gate).
- [Source: architecture.md#D6] / #D1 / #D5 — resource design, session isolation, uniform enforcement.
- [Source: packages/shared/node_modules/@modelcontextprotocol/sdk/.../server/mcp.d.ts] — `registerResource`, `ResourceTemplate`, `ReadResourceResult`.
- [Source: packages/shared/src/server-base.ts] — capabilities (303-305), `server` getter (1020), `governanceConfig`/`mutatesLookup` (Story 14.4).
- [Source: packages/shared/src/governance.ts] — `getEffectivePolicy`.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context)

### Debug Log References

- Empirical SDK verification (Rule #14/#16 — verify the API rather than trusting the spec):
  - `registerResource(name, uriOrTemplate, config, readCallback)` — `config` is `ResourceMetadata` (required); two overloads (string URI → `ReadResourceCallback (uri, extra)`; `ResourceTemplate` → `ReadResourceTemplateCallback (uri, variables, extra)`). `server/mcp.d.ts:102-103`.
  - `ResourceTemplate` constructor REQUIRES `{ list: ListResourcesCallback | undefined, complete? }` — `list` must be passed explicitly even as `undefined`. `server/mcp.d.ts:222-236`.
  - `ReadResourceResult.contents` = `[{ uri, mimeType?, text }]` (or `blob` variant). `types.d.ts` `ReadResourceResultSchema:1628-1652`.
  - The SDK auto-advertises `resources` + wires `resources/list` / `resources/templates/list` / `resources/read` on `registerResource` via `setResourceRequestHandlers` (`server/mcp.js:332-396`), which calls `registerCapabilities({ resources: { listChanged: true } })`. The underlying `Server.registerCapabilities` MERGES (`mergeCapabilities`) and only throws AFTER connecting to a transport (`server/index.js:86-91`) — so declaring `resources` in the constructor AND the SDK re-registering it is idempotent, no conflict. `_oninitialize` returns `this.getCapabilities()` (`server/index.js:270-281`), so asserting `getCapabilities()` is asserting the `initialize` result.
  - The `resources/read` handler checks exact `_registeredResources[uri]` FIRST, then templates (`server/mcp.js:376-393`) — so `iris-governance://default` resolves the static resource, and any other authority resolves the `{profile}` template.
  - `sendResourceListChanged()` is guarded by `isConnected()` (`server/mcp.js:757-760`), so registering the resource in the constructor (pre-connect) is a safe no-op for the notification.
- Test-harness note: importing governance engine values via the `../index.js` barrel breaks the hoisted `vi.mock("../bootstrap.js")` (the barrel transitively imports `server-base` → `bootstrap`, evaluated before `bootstrapSpy` initializes). Imported from the direct `../governance.js` / `../governance-baseline.js` modules instead.
- The build (`tsc --project`, `include: ["src"]`) type-checks the test files under `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`; vitest (esbuild) does not. Index accesses and the fetch-mock signature needed strict-safe guards/typing that vitest alone did not surface.

### Completion Notes List

Implemented the advisory governance RESOURCE + the `resources` capability (D6) and the Epic-14 capstone cross-server integration test (AC 14.5.6). All TypeScript-only in `@iris-mcp/shared`; no `BOOTSTRAP_VERSION` bump.

- **D6 — minimal, single-resource provider (no premature framework):** added to `McpServerBase`:
  - The constructor now declares `capabilities.resources: { listChanged: true }` alongside `tools` (additive; merges idempotently with the SDK's own registration).
  - `registerGovernanceResource()` (called from the constructor, like tool registration): a STATIC `iris-governance://default` resource (→ `resources/list`) + a `ResourceTemplate` `iris-governance://{profile}` (→ `resources/templates/list` + `resources/read`). Read callbacks close over `this`, so they read `governanceConfig` / `governedKeys` AT READ TIME (after `start()` parsed `IRIS_GOVERNANCE`).
  - `buildGovernancePolicyResult(profile, uri)`: resolves the profile (unknown → `McpError(InvalidParams)`, never a crash), then returns `getEffectivePolicy(profile, this.governanceConfig, this.governedKeys, this.mutatesLookup)` as `{ contents: [{ uri, mimeType: "application/json", text: JSON.stringify(policy) }] }`.
  - `governedKeys` (new field) + `rebuildGovernedKeys()`: the union of `GOVERNANCE_BASELINE` and this server's registered tool/action keys, computed with the SAME `tool` / `tool:action` rule as the gate and the baseline generator, so the resource's keys line up exactly with enforcement. Rebuilt at construction and on `addTools`/`removeTools` (mirroring `rebuildMutatesLookup`).
- **Advisory (AC 14.5.4):** the resource is read-only; no code path depends on a client reading it — the 14.4 call-time gate stays authoritative. Documented inline + proven by tests (enforcement is identical whether or not the resource is read).
- **Capstone (AC 14.5.6):** `governance-cross-server.test.ts` constructs two `McpServerBase` instances (two synthetic tool sets) with `default`+`prod` profiles on four distinct hosts and proves, under `Promise.all`: (a) per-profile session isolation (D1) — a host-unique cookie established on one profile never appears on another profile's request headers, across both servers, and all four `IrisHttpClient` instances are distinct; (b) uniform enforcement (D5) — the same `IRIS_GOVERNANCE` disabling a write denies it byte-identically on both servers (default + prod), while reads pass on both. A third test confirms the advisory resource on both servers agrees with the gate.

**Tests:** shared package 425 → 438 (+13: `governance-resource.test.ts` 10, `governance-cross-server.test.ts` 3). Full monorepo `build` + `test` + `lint` all exit 0 (shared 438, dev 293, admin 224, interop 171, ops 159, data 120). Governance-baseline drift check still passes (no tool-surface change → no `BOOTSTRAP_VERSION` impact).

### File List

- `packages/shared/src/server-base.ts` (modified — resource scheme constants, imports, `resources` capability, `governedKeys` field + `rebuildGovernedKeys`, `buildGovernancePolicyResult`, `registerGovernanceResource`, `addTools`/`removeTools` sync)
- `packages/shared/src/__tests__/governance-resource.test.ts` (new — AC 14.5.1–14.5.5 resource tests)
- `packages/shared/src/__tests__/governance-cross-server.test.ts` (new — AC 14.5.6 capstone: D1 session isolation + D5 uniform enforcement)
- `_bmad-output/implementation-artifacts/14-5-governance-resource-and-capability.md` (story status, tasks, Dev Agent Record)

## Review Findings

Adversarial code review (2026-06-15) — three parallel layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor). Capstone AC 14.5.6 was scrutinized hardest as the Epic-14-done gate. **Verdict: the capstone is GENUINE, not illusory, on every axis** — it asserts on real per-instance cookie state (the actual `Cookie` header the production `IrisHttpClient` emits from genuinely separate per-profile cookie jars), four distinct cached client instances, and byte-identical structured denials flowing through the single shared `handleToolCall` gate (deny + re-enable directions). It runs in the DEFAULT vitest suite (`.test.ts`, not `.integration.test.ts` — `vitest.config.ts` includes the former, excludes the latter). Advisory-only (AC 14.5.4) is structurally guaranteed (resource read callbacks are pure — no enforcement path reads resource state) and empirically confirmed cross-server. AC 14.5.3 cross-checks the FULL effective map incl. the global∩profile cascade, not spot-checks. D6 minimalism honored (one resource + one template, `list: undefined`, no generalized framework). No HIGH findings.

- [x] [Review][Patch] Capstone cookie mocks diverge from repo `getSetCookie` convention → cross-Node-version fragility [packages/shared/src/__tests__/governance-cross-server.test.ts:158; packages/shared/src/__tests__/governance-cross-server-coverage.test.ts:165] — **RESOLVED.** Both `makeHostAwareFetch` mocks set `Set-Cookie` via the `Response` constructor but did NOT patch `Headers.getSetCookie()`. The production client reads cookies ONLY via `response.headers.getSetCookie()` (`http-client.ts:414`), which does NOT reliably surface a constructor-set `Set-Cookie` across the package's supported Node range (`engines.node >= 18`; undici changed this over its lifecycle). Every other cookie-bearing mock in the package (`http-client`/`health`/`profiles`/`atelier`/`bootstrap` tests) explicitly patches `getSetCookie` with comments to this effect; these two NEW capstone mocks broke that convention. On Node 18 the per-profile cookie jars would stay empty and the D1 isolation assertion `expect(getCall?.cookie).toBe(ownToken(host))` would FAIL (loudly, not vacuously — so not illusory, but the epic capstone must be robust on the supported floor). Fixed by patching `getSetCookie` in both mocks to mirror the established convention. Also tightened the imprecise "the tool's GET" comment in the dev file (the first GET inspected is actually the establishment/version-negotiation GET, which still carries the cookie). Re-ran: shared 450 tests pass, `tsc` build (strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`) clean, lint clean.
- [x] [Review][Defer] URL-encoded profile name not decoded in the resource template read callback [packages/shared/src/server-base.ts:531-535] — deferred (narrow edge case, not a regression). The `ResourceTemplate` read callback does `String(variables.profile)` and passes the RAW (undecoded) authority segment to `resolveProfile`. Verified against the SDK: `iris-governance://a%20b` yields `profile: "a%20b"` (not `"a b"`). So a profile whose name percent-encodes in a URI authority (space, non-ASCII) would be unreachable via its natural encoded URI, returning a clean `McpError(InvalidParams)` "Unknown server profile" (NO crash) with a confusing encoded-vs-decoded mismatch in the valid-profiles list. Realistic profile names (`prod`, `stage`, `dr`) never percent-encode, so impact is minimal. A fix (`decodeURIComponent`) carries its own edge cases (literal `%` in a name, malformed sequences throwing `URIError`) and is not clearly required by any AC; deferred to `deferred-work.md` for a considered decision rather than a reflexive patch. See Dismissed note below for the non-actionable items.

**Dismissed as noise / non-defects (not persisted as action items):** (1) Blind Hunter "concurrency framing is non-load-bearing" — the `Promise.all` isolation proof is genuine; it asserts real per-instance cookie state end-to-end and validates exactly the structural guarantee D1 specifies (the Acceptance Auditor independently confirmed it is real, not mock theater). (2) "Tests reach into SDK private internals (`_requestHandlers`/`_registeredTools`/`.clients`)" — this is the established Epic-14 harness pattern (the story Dev Notes document driving the real registered handlers because this SDK build ships no in-memory client/transport); consistent across the suite. (3) "`headers as Record` cast assumes a plain object" — correct today (the client always passes a plain object literal); defensive-only. (4) Acceptance Auditor "synthetic tool sets rather than real package tool sets" — explicitly sanctioned by Task 5 ("OR two synthetic tool sets"); the single-`McpServerBase`-chokepoint design makes the framework-level proof the load-bearing one. (5) "Reuse of the real `iris_doc_get` baseline name for a synthetic fixture" — cosmetic; assertions pass for the right reason (baseline membership). All Edge-Case-Hunter cases other than the URL-decode finding were confirmed correctly HANDLED (static-URI reachability/case/path/empty-authority, pre-start read fallback, `rebuildGovernedKeys`↔`computeGovernanceKey` alignment, add/remove baseline persistence, `__proto__`-key JSON round-trip, concurrent-read torn-state).
