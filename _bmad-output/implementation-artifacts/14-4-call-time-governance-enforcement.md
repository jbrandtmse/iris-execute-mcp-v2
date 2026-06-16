# Story 14.4: Call-Time Governance Enforcement & Structured Denial Error

Status: done

## Story

As an operator,
I want disabled actions rejected when invoked,
so that the policy is actually enforced regardless of which profile a call targets.

## Acceptance Criteria

1. **AC 14.4.1** — Every tool invocation passes through a governance gate that evaluates `effective(key, resolvedProfile)` (via the 14.3 engine, using `getEffectivePolicy`/`effective`) for the call's resolved `server` profile **before** reaching the handler. **(Integration AC.)**
2. **AC 14.4.2** — A disabled action returns a structured error (e.g. `action 'iris_backup_manage:run' is disabled by governance policy for server 'prod'`) with a **machine-readable code**; the IRIS handler is never called (and the profile's connection is not established for a denied call). **(Integration AC.)**
3. **AC 14.4.3** — Enforcement is **call-time** (not advertise-time): all tools remain in `tools/list`. Rationale documented inline — the governing profile is selected per-call (via `server`), so per-profile policy cannot be evaluated at advertise/registration time.
4. **AC 14.4.4** — Read actions and all existing actions are unaffected when no governance config is present (default seed all-enabled) — **back-compat gate**. With no `IRIS_GOVERNANCE`, the gate is a pure pass-through.
5. **AC 14.4.5** — Tests: denied write action blocked + correct structured error + handler not invoked; same action allowed under a profile that re-enables it; existing action always allowed under empty config; the gate runs **after** profile resolution (an unknown `server` errors before the gate) and **before** connection establishment (a denied call does not health-check/bootstrap). **(Integration AC.)**

## Integration ACs

**Consumer of Story 14.3 (governance engine) + Story 14.2 (profile resolution).** This story wires `effective`/`getEffectivePolicy` into the `handleToolCall` chokepoint as the enforcement gate. AC 14.4.1/14.4.2/14.4.5 are the integration ACs. The cross-server end-to-end enforcement + isolation test is owned by Story 14.5 (AC 14.5.6).

## Tasks / Subtasks

- [x] Task 1: Startup wiring — parse `IRIS_GOVERNANCE` + build the mutates lookup (D7)
  - [x] In `start()` ([server-base.ts:597](../../packages/shared/src/server-base.ts#L597)), after the profile registry is built (lines 608–610), parse governance: `this.governanceConfig = parseGovernanceConfig()` (env-based, mirrors `loadProfileRegistry()`; `parseGovernanceConfig` already fails fast naming `IRIS_GOVERNANCE`).
  - [x] Build `this.mutatesLookup = buildMutatesLookup(...)` in the constructor (via `rebuildMutatesLookup()`, reading the live tool registry so `addTools`/`removeTools` keep it in sync). Default `this.governanceConfig = {}` (empty ⇒ all-enabled pass-through) until parsed, so a server constructed-but-not-started still behaves safely.
  - [x] (Optional) precompute `this.governedKeys` — NOT needed: the gate uses `effective(key, …)` directly (no `getEffectivePolicy` at the gate). Skipped intentionally.
- [x] Task 2: The gate in `handleToolCall` (D5 — the one chokepoint)
  - [x] Insert the gate **after** `profile = resolveProfile(this.profiles, server)` ([server-base.ts:533](../../packages/shared/src/server-base.ts)) and **before** `getOrCreateClient` / context-build / handler. Ordering per D5: validate (Zod) → resolve `server`→profile → **extract action → evaluate policy → deny or proceed** → build context + invoke.
  - [x] Compute the governance key (D4) via `computeGovernanceKey(tool, validatedArgs)`: for a multi-action tool (`inputSchema.shape.action.options` is a non-empty array — the EXACT predicate `gen-governance-baseline.mjs` uses), `key = ${tool.name}:${validatedArgs.action}`; otherwise `key = tool.name`. Tests assert a representative multi-action tool's gate key (`iris_database_manage:delete`) equals a `GOVERNANCE_BASELINE` entry.
  - [x] `if (!effective(key, profile.name, this.governanceConfig, this.mutatesLookup)) { return <structured isError> }`. Denial result: `isError: true`, human-readable `text` (`action '<key>' is disabled by governance policy for server '<profile>'`), and machine-readable `structuredContent: { code: "GOVERNANCE_DISABLED", action: key, server: profile.name }`. Does NOT call `getOrCreateClient`, does NOT call the handler.
  - [x] Inline rationale comment for AC 14.4.3 (call-time by necessity — governing profile is per-call).
- [x] Task 3: Tests (AC 14.4.5) — `packages/shared/src/__tests__/governance-enforcement.test.ts` (14 tests)
  - [x] Denied write (seed-disabled NEW write tool) → `isError` with the structured code + names action + profile; handler spy NOT called; no health-check/bootstrap fetch (gate before establishment) — proven for both default and non-default profiles.
  - [x] Same action allowed under a profile that re-enables it (`profiles.prod.<key> = true` over a `global false` / over the seed) → handler IS called; still denied on the default profile.
  - [x] Existing action under empty `IRIS_GOVERNANCE` → always allowed (back-compat gate) — a representative read from EACH of the 5 servers + a multi-action tool's full enum.
  - [x] Ordering: unknown `server` → `Unknown server profile` `isError` BEFORE the gate (no governance code); Zod validation also precedes the gate; denied call does NOT establish the connection.
  - [x] Governance key alignment: the multi-action gate key matches a `GOVERNANCE_BASELINE` entry; single-op key is the bare name. Plus D7 fail-fast at `start()` and constructed-but-not-started safety.
- [x] Task 4: Regression + back-compat
  - [x] `pnpm turbo run build && pnpm turbo run test && pnpm turbo run lint` exit 0. **No `BOOTSTRAP_VERSION` bump.** With no `IRIS_GOVERNANCE`, every existing tool across all 5 servers behaves byte-for-byte as before (the gate is a pass-through). All server packages' suites pass unchanged (dev 293 / admin 224 / interop 171 / ops 159 / data 120 — identical to baseline).

## Dev Notes

### Architecture decision D5 (design authority — [architecture.md](../planning-artifacts/architecture.md) "Multi-Server Profiles & Tool Governance")

> **D5 — Gate placement & ordering (one chokepoint).** Inside `handleToolCall`: validate args (Zod) → resolve `server`→profile → extract `action` → evaluate `getEffectivePolicy(profile)[key]` → if disabled, return a structured `isError` result (machine-readable code, names action + profile) WITHOUT calling the handler → else build per-profile context and invoke. One change point cascades to all five servers. *Rationale:* validate-before-gate gives reliable action extraction + clean errors; a single chokepoint keeps enforcement uniform and un-bypassable.

D4 governs the key shape (`tool` vs `tool:action`). D7 governs the startup parse (fail-fast naming `IRIS_GOVERNANCE`).

### The current handleToolCall flow (post-14.2 — wire into it, don't rewrite)

[server-base.ts:350–460+](../../packages/shared/src/server-base.ts#L350): validate extended schema → strip `server` → check initialised → `resolveProfile` (unknown → `isError`) → **[14.4 GATE HERE]** → `getOrCreateClient` (health-check/bootstrap on first touch) → `buildToolContext` → `tool.handler`. The gate goes between profile resolution and `getOrCreateClient` so a denied call neither establishes a connection nor runs the handler.

### Engine API (from Story 14.3 — already shipped)

- `parseGovernanceConfig(env?) → GovernanceConfig` (fail-fast naming `IRIS_GOVERNANCE`).
- `buildMutatesLookup(tools) → MutatesLookup` (ReadonlyMap; from `ToolDefinition.mutates`).
- `effective(key, profile, config, mutatesLookup, baseline?) → boolean` (cascade; `??` honors explicit `false`; prototype-key-safe per CR-14.3-1).
- `getEffectivePolicy(profile, config, allKeys, mutatesLookup, baseline?) → Record<key, boolean>` (for 14.5; the gate can use `effective` directly).
- `GOVERNANCE_BASELINE` (141 keys); under empty config every baseline key → enabled.

### Back-compat gate (release-critical)

With no `IRIS_GOVERNANCE`: `this.governanceConfig = {}`; for any existing tool/action `key` (which IS in the baseline), `effective(key, …) === true`. The gate passes through. This is the hard release gate — verify a representative existing action from each server is allowed under empty config, and that NO server-package test regresses.

### Testing standards & notes

- Vitest; `packages/shared/src/__tests__/*.test.ts`. Use synthetic governed tools (with `mutates`) + a handler spy + a mocked health/fetch to assert the handler/connection are NOT touched on denial. No live IRIS.
- TypeScript-only; **no `BOOTSTRAP_VERSION` bump**. No `docs/adr/` — architecture.md D4/D5/D7 is the design authority.

### References

- [Source: epics.md#Story-14.4] — ACs verbatim.
- [Source: architecture.md#D5] / #D4 / #D7 — gate placement, key shape, fail-fast parse.
- [Source: packages/shared/src/server-base.ts] — `handleToolCall` (~350), `start()` (597), `McpServerBaseOptions` (99).
- [Source: packages/shared/src/governance.ts] — `effective`, `parseGovernanceConfig`, `buildMutatesLookup`.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context) — via `/bmad-dev-story`.

### Debug Log References

- One RED→GREEN iteration: the non-default-profile denial test initially failed because the shared `bootstrapSpy` was called once during the DEFAULT profile's `start()` (the test used `needsCustomRest: true`). Fixed by `bootstrapSpy.mockClear()` after `start()` so the assertion measures only the denied prod call (which triggers neither establishment nor bootstrap). All 14 tests green thereafter.

### Completion Notes List

- **Gate placement (D5):** inserted the enforcement gate in `handleToolCall` strictly AFTER `resolveProfile(...)` and BEFORE `getOrCreateClient(...)`. A denied call returns the structured `isError` without establishing the profile's connection (no health-check / bootstrap) and without invoking the handler — verified by spies + fetch-call-count assertions for both the default and a non-default (`prod`) profile.
- **Governance key (D4):** `computeGovernanceKey` reads `tool.inputSchema.shape.action.options` with the EXACT `Array.isArray(options) && options.length > 0` predicate that `scripts/gen-governance-baseline.mjs` uses, so a multi-action tool resolves to `tool:action` and a single-op tool to the bare `tool` — guaranteeing the runtime key aligns with the baseline keys. Behavioral alignment test: disabling `iris_database_manage:delete` via global policy and invoking `action:"delete"` returns a denial whose `action` field equals the `GOVERNANCE_BASELINE` entry (and `create` on the same tool stays allowed).
- **Startup wiring (D7):** `start()` calls `parseGovernanceConfig()` right after the profile registry is built; it fails fast (naming `IRIS_GOVERNANCE`) on malformed JSON / non-boolean values — covered by two `start()`-rejects tests. `mutatesLookup` is built in the constructor (`rebuildMutatesLookup()`, from the live registry) and rebuilt on `addTools`/`removeTools` so dynamically-added governed tools stay classified.
- **Safe defaults:** `governanceConfig` defaults to `{}` and `mutatesLookup` to an empty map, so a constructed-but-not-started server is a pure pass-through (asserted directly).
- **Back-compat gate (release-critical, AC 14.4.4):** under empty `IRIS_GOVERNANCE`, a representative existing read action from EACH of the five servers (`iris_doc_get`, `iris_database_list`, `iris_production_status`, `iris_license_info`, `iris_docdb_find`) resolves enabled and reaches its handler; the multi-action `iris_database_manage` allows all three enum actions. NO server-package suite regressed.
- **AC 14.4.3 (call-time, not advertise-time):** an inline rationale comment documents that the governing profile is per-call, so per-profile policy cannot be evaluated at advertise time; a test proves a globally-disabled tool is STILL advertised in the SDK registry (`tools/list`) and only denied at call time. Advertise-time code (registration / `tools/list`) is untouched.
- **Denial shape (AC 14.4.2):** `isError: true`, human text `action '<key>' is disabled by governance policy for server '<profile>'`, and object `structuredContent: { code: "GOVERNANCE_DISABLED", action, server }` (object, not array — per the suite's structuredContent rule).
- **No `BOOTSTRAP_VERSION` bump; no generated-file change.** Only `server-base.ts` + the new test file changed. `governance-baseline.ts` / `bootstrap-classes.ts` untouched; the baseline drift test still passes.
- Validation: `pnpm turbo run build` (6/6, exit 0), `pnpm turbo run test` (12/12, exit 0; shared 397→425 tests, +28 = 14 dev + 14 QA across the two new files, no regressions), `pnpm turbo run lint` (6/6, exit 0). [Corrected during code review: the original note read "397→411 (+14)", counting only the dev file; the QA coverage file adds another 14 — verified `vitest run` of both files reports `Tests 28 passed`.]
- Changes left UNCOMMITTED per epic-cycle instruction (lead commits after the smoke gate).

### File List

- `packages/shared/src/server-base.ts` (modified) — governance imports; `governanceConfig` + `mutatesLookup` fields with safe defaults; `rebuildMutatesLookup()` (constructor + add/removeTools); `parseGovernanceConfig()` in `start()`; `computeGovernanceKey()`; the enforcement gate in `handleToolCall`.
- `packages/shared/src/__tests__/governance-enforcement.test.ts` (new) — 14 integration tests for AC 14.4.1–14.4.5 (+ D7 fail-fast and constructed-but-not-started safety).
- `packages/shared/src/__tests__/governance-enforcement-coverage.test.ts` (new) — 14 complementary QA tests (governance × `server` × `namespace`, the full three-layer cascade through the gate, per-action enforcement via the profile layer, the strict denial-envelope invariant, near-miss `action` values rejected by Zod, concurrent denied+allowed independence, denial establishes no client/in-flight entry, and a NEW read enabled by the seed under empty config). [Added during code review: present + passing on disk but omitted from the dev's original File List.]

## Review Findings (code review — 2026-06-15)

Adversarial code review of the security-critical enforcement chokepoint via `/bmad-code-review` (three parallel layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor). **Outcome: no HIGH and no MED findings; no D5/D4/D7 mismatch.** All five integration ACs (14.4.1/14.4.2/14.4.5) plus 14.4.3/14.4.4 were verified genuinely exercised THROUGH `handleToolCall` (the SDK-registered callback), not by calling `effective()` directly.

**Security-boundary verifications (all clean):**
- **Un-bypassability (D5):** the gate is the SOLE chokepoint (exactly one `effective()` call in the file), strictly AFTER `resolveProfile` and BEFORE `getOrCreateClient`+handler. Lines 520–555 are fully synchronous, so nothing can interleave between profile resolution and the gate. The handler is invoked at exactly one site, after the gate. A denied call creates no client, no `establishing` entry, and issues zero fetches to the target host — asserted for BOTH default and non-default (`prod`) profiles.
- **Fail-closed:** the `effective()` call is not `try`-wrapped, so an engine throw would propagate as a JSON-RPC error and still never reach the handler (safe).
- **Denial envelope (AC 14.4.2):** `isError:true` + non-empty human text + object `structuredContent:{code:"GOVERNANCE_DISABLED",action,server}`. The MCP SDK's `validateToolOutput` early-returns on `result.isError` BEFORE touching any tool `outputSchema` (confirmed in SDK `mcp.js`) — a denial's `structuredContent` is never validated against an `outputSchema`, so the dev's claim holds.
- **D4 key alignment:** `computeGovernanceKey`'s predicate is byte-identical to `gen-governance-baseline.mjs`; a test proves the gate-computed `iris_database_manage:delete` equals the baseline entry and the single-op key is bare. Reading the ORIGINAL `tool.inputSchema` while Zod validates the EXTENDED schema is safe (`withServerParam.extend()` only adds `server`, leaving the `action` enum reference intact — runtime-verified).
- **Back-compat (AC 14.4.4, release-critical):** non-vacuous — a representative existing read from each of the 5 servers + all three `iris_database_manage` actions resolve enabled under empty `IRIS_GOVERNANCE`, each asserted `GOVERNANCE_BASELINE.has(key)` first. Only `server-base.ts` + the two test files changed (no server-package source; `governance-baseline.ts` / `bootstrap-classes.ts` untouched; no `BOOTSTRAP_VERSION` bump), so "no server suite regressed" is structurally sound.
- **D7 fail-fast:** `start()` throws naming `IRIS_GOVERNANCE` on malformed JSON and on a non-boolean value (two tests).

**Findings & dispositions:**
1. **[LOW — RESOLVED inline]** Story test-count claim under-reported: "+14 (397→411)" counted only the dev file; two files were added (14 dev + 14 QA). Corrected to "+28 (397→425)" — verified `vitest run` of both files reports `Tests 28 passed`. (Completion Notes validation line updated.)
2. **[LOW — RESOLVED inline]** Story File List omitted `governance-enforcement-coverage.test.ts` (the 14-test QA suite, present + passing). Added to the File List above.
3. **[LOW — DEFERRED]** `computeGovernanceKey` would degrade per-action governance to whole-tool governance (and could build a `tool:undefined` key) if a future `action` enum is ever wrapped in `.optional()`/`.default()`/`.nullable()` (the predicate's `.options` read returns `undefined` for those wrappers). NOT reachable on the current surface — all 21 production multi-action tools use a required bare `z.enum(...).describe(...)`, and the gate stays consistent with the generator (identical predicate). Forward-looking robustness trap for Epics 15–17; a correct fix must patch BOTH the gate and the generator (unwrap the wrapper) plus add a registration-time assertion + an edge test, so it is folded into the epic that first adds a governed write tool — see `deferred-work.md` "code review of story-14.4". This directly extends the already-deferred 14.3 CR item on unwrapping `z.optional(z.enum(...))` action shapes.

Post-review validation after the inline doc edits: `pnpm --filter @iris-mcp/shared test` green (425 tests), `pnpm turbo run lint` green (6/6). No source code changed during review (the two resolved findings were story-doc fixes only); the deferred item is tracked, not patched.

### Review Findings checklist

- [x] [Review][Patch] Story test-count claim corrected "+14 (397→411)" → "+28 (397→425)" [14-4-call-time-governance-enforcement.md:99] — fixed inline; verified `vitest run` reports 28 passed.
- [x] [Review][Patch] QA coverage test file added to File List [14-4-call-time-governance-enforcement.md File List] — fixed inline.
- [x] [Review][Defer] `computeGovernanceKey` would degrade per-action governance to whole-tool (and could build `tool:undefined`) if a future `action` enum is wrapped in `.optional()`/`.default()`/`.nullable()` [packages/shared/src/server-base.ts:419-428] — deferred (LOW, latent, not reachable on the current tool surface; correct fix spans gate + generator + a registration-time assertion, folded into the epic that adds the first governed write tool; extends the already-deferred 14.3 unwrap item). Tracked in deferred-work.md.
