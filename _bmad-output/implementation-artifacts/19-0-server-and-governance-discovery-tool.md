# Story 19.0: Server & Governance Discovery Tool

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an AI client connected to a suite server,
I want a single tool that reports the configured server profiles (with non-secret connection metadata) and the effective governance policy,
so that I can choose the right `server` profile and avoid blocked actions without reading the client's config files or guessing.

## Acceptance Criteria

- **AC 19.0.1** — A new read tool (proposed name `iris_server_profiles`; final name confirmed in dev) is **registered centrally in `@iris-mcp/shared` `server-base.ts`** — framework-provided, NOT added to any package `tools/index.ts` — so it is present on all five servers (dev, admin, interop, ops, data) without per-package wiring.
- **AC 19.0.2** — Output includes a **profile roster**: for each configured profile, `{ name, isDefault, host, port, username, namespace, https, baseUrl, timeout }`. The `password` field is **never** included in the output (verified by an explicit assertion). Roster is built from the profile registry (`profiles.ts`).
- **AC 19.0.3** — Output includes the **effective governance policy** (enabled/disabled action map) computed via the existing `getEffectivePolicy` — the same source the D6 resource uses — so the tool and resource cannot drift. The tool accepts an optional `profile` argument selecting which profile's policy to report (defaults to `default`), and an optional flag to return policy for **all** profiles.
- **AC 19.0.4** — Governance classification: the tool is `mutates: "read"` → **default-enabled**; it is a new non-baseline key and does **not** modify the frozen baseline (`1e62c5ad5bf7`). `assertGovernanceClassification` passes at registration.
- **AC 19.0.5** — The tool **description** instructs the client to call it **first** to discover available profiles and governance before invoking other tools. The MCP server **`instructions`** field (set on the shared server base) reinforces the same guidance so capable clients surface it at connect time.
- **AC 19.0.6** — **Back-compat (mechanical proof, Rule #19):** with neither `IRIS_PROFILES` nor `IRIS_GOVERNANCE` set, the tool reports exactly one profile (`default`, with today's `IRIS_*`-derived connection metadata) and the default-seed policy (every baseline action enabled). A test asserts this "off" state and asserts no existing tool/schema/output changed.
- **AC 19.0.7** — **(Optional companion, recommended)** the per-profile governance resource template's `list` callback enumerates the configured profile names, so resource-reading clients can also discover the roster via `resources/templates/list`. If included, covered by a test; if deferred, recorded as a follow-up.
- **AC 19.0.8** — Unit tests: roster shape + **password-absence assertion**, policy correctness vs `getEffectivePolicy`, optional-`profile` + all-profiles selection, default-only back-compat, presence of the tool on a representative server, governance classification.
- **AC 19.0.9** — Docs rollup: root `README.md` + every per-package README + `tool_support.md` + `iris-mcp-all` document the new tool, its **call-first** guidance, and that it is a **read** (enabled by default) per Rule #30; per-server tool counts bumped; CHANGELOG entry.

## Tasks / Subtasks

- [x] **Task 1 — Define the framework discovery tool** (AC: 1, 2, 3, 4, 5)
  - [x] Decide the final tool name against the existing `iris_server_*` family (chosen: `iris_server_profiles`; `iris_server_info` confirmed as a dev-only Atelier build-info tool — not extended).
  - [x] Author the tool as a `ToolDefinition` (name, title, LLM-optimized `description` with explicit **call-first** guidance, `inputSchema`, `annotations` with `readOnlyHint: true`, `scope: "NONE"`, `mutates: "read"`).
  - [x] `inputSchema`: optional `profile` + optional `allProfiles`; no `server` field (framework-injected via `withServerParam`).
  - [x] Registered centrally in `server-base.ts` (constructor, after the package-tools loop); appears on all five servers without touching any package `tools/index.ts`.
- [x] **Task 2 — Build the roster via an allow-list (redaction)** (AC: 2)
  - [x] `buildRosterEntry` explicitly names the non-secret fields (`name`, `isDefault`, `host`, `port`, `username`, `namespace`, `https`, `baseUrl`, `timeout`). No spread/delete of `password`.
  - [x] Roster sourced from `this.profiles` (the `ProfileRegistry`).
- [x] **Task 3 — Compute the effective policy via the shared engine** (AC: 3)
  - [x] `computeServerDiscovery` calls `getEffectivePolicy(profileName, config, governedKeys, mutatesLookup)` — identical to the D6 resource's `buildGovernancePolicyResult`.
  - [x] `allProfiles` → `{ [profileName]: policyMap }`; else single `profile` (default `default`); unknown name → `ProfileResolutionError` → structured error.
- [x] **Task 4 — Wire the handler without requiring a live IRIS connection** (AC: 1, 6)
  - [x] Special-cased in `handleToolCall` after the governance gate, before `getOrCreateClient` — reads `this.profiles`/`this.governanceConfig`/`this.governedKeys`/`this.mutatesLookup`; no connection established.
  - [x] Governance gate still applies (read → enabled-by-default; a disable test confirms the gate fires when an operator opts in).
- [x] **Task 5 — MCP `instructions` field** (AC: 5)
  - [x] `instructions: SERVER_DISCOVERY_INSTRUCTIONS` set on the `McpServer` constructor. Verified the SDK option name (`ServerOptions.instructions`, sdk 1.29.0) and that it is carried into the `initialize` result (`Server._instructions` → result). Unit test asserts it is set.
- [x] **Task 6 — Optional resource-enumeration companion** (AC: 7) — SHIPPED.
  - [x] The `iris-governance://{profile}` `ResourceTemplate` `list` callback now enumerates one concrete `iris-governance://<profile>` entry per configured profile. Covered by a test (`resources/list` includes the per-profile entries).
- [x] **Task 7 — Tests** (AC: 6, 8)
  - [x] Roster shape + password-absence (incl. multi-profile `IRIS_PROFILES`).
  - [x] Policy correctness: `toEqual getEffectivePolicy(...)` (non-drift).
  - [x] Optional-`profile` + `allProfiles`.
  - [x] Default-only back-compat (AC 19.0.6) + no existing tool/output changed.
  - [x] Presence-on-a-representative-server.
  - [x] Governance classification: registration does not throw; key is `mutates: "read"`; baseline git-clean + `gen:governance-baseline:check` exit 0.
  - [x] All new tests in the DEFAULT vitest suite (`server-discovery.test.ts`, plain `*.test.ts`).
- [x] **Task 8 — Docs rollup** (AC: 9)
  - [x] Root `README.md`, every per-package README, `tool_support.md`, `iris-mcp-all` README: documented the framework tool, call-first guidance, and read-enabled-by-default (Rule #30).
  - [x] Advertised tool counts bumped (package totals unchanged; advertised = +1/server, suite 98 → 103 advertised) + CHANGELOG entry dated 2026-06-18.
  - [x] NO `BOOTSTRAP_VERSION` bump. NO `governance-baseline.ts` change (both verified git-clean).

## Dev Notes

### Scope & invariants
- **TypeScript-only, entirely in `@iris-mcp/shared`.** No ObjectScript, no `BOOTSTRAP_VERSION` bump, no `governance-baseline.ts` change (the new read key is non-baseline but classified). [Source: epics.md#Epic-19; sprint-change-proposal-2026-06-18.md §2 Technical Impact]
- **Strictly additive (Rule #19/#23):** absent both `IRIS_PROFILES` and `IRIS_GOVERNANCE`, behavior is byte-for-byte today's PLUS the new (optional-to-call) tool. The back-compat proof is AC 19.0.6's mechanical test. [Source: feedback_additive_no_breaking_changes; project-rules.md#19]
- **Frozen governance baseline (Rule #23/#25):** `GOVERNANCE_BASELINE` stays `1e62c5ad5bf7` (141 keys). Do NOT run the bare `gen-governance-baseline.mjs` generator (it regrows the frozen file — Rule #25 footgun); use `gen:governance-baseline:check` (no-write) to confirm exit 0. [Source: project-rules.md#23, #25]

### Architecture — mirror D2/D6 central registration (decision E1)
The discovery tool is **framework-provided**, wired once in `server-base.ts` exactly like the D2 `server`-param injection and the D6 governance resource — never in a package `tools/index.ts`. This gives uniform cross-server coverage and automatic inheritance of future profiles/governance. [Source: sprint-change-proposal-2026-06-18.md §4.2 ADR E1; epics.md#Epic-19 Implementation Notes]

**Single source of truth (no drift):**
- Roster ← `this.profiles` (`ProfileRegistry`), built in `start()` from `loadProfileRegistry()` / `buildProfileRegistry()`. [Source: packages/shared/src/profiles.ts:244-318]
- Policy ← `getEffectivePolicy(profile, this.governanceConfig, this.governedKeys, this.mutatesLookup)` — the IDENTICAL call the D6 resource uses in `buildGovernancePolicyResult`. [Source: packages/shared/src/server-base.ts:468-508; packages/shared/src/governance.ts:468-489]

### Redaction (the one safety-critical line) — AC 19.0.2
`IrisProfile` is `{ name, host, port, username, password, namespace, https, baseUrl, timeout }` (extends `IrisConnectionConfig`). [Source: packages/shared/src/profiles.ts:48-51, 208-218] Build each roster entry by **allow-listing** the non-secret fields explicitly — `{ name, isDefault: p.name === DEFAULT_PROFILE_NAME, host, port, username, namespace, https, baseUrl, timeout }`. Do NOT `{ ...p, password: undefined }` / `delete` — a future field added to `IrisProfile` must not silently appear in discovery output. Per the stakeholder decision, `username` and all other non-password fields ARE exposed (acceptable for this self-hosted, operator-configured suite). [Source: sprint-change-proposal-2026-06-18.md §2 + §4.2 Authentication & Security]

### Handler wiring — special-case in `handleToolCall` (recommended)
The standard handler path (`registerTool` → `handleToolCall` → `getOrCreateClient` → `tool.handler(args, ctx)`) (a) only gives the handler a `ToolContext` (HTTP client / namespace), NOT the server-base policy/profile internals the discovery tool needs, and (b) ALWAYS establishes the profile's IRIS connection after the governance gate (`server-base.ts:837`). Discovery should report in-memory config and **must not require a live IRIS connection**.

Recommended approach: in `handleToolCall`, after the governance gate (`server-base.ts:826`) and BEFORE `getOrCreateClient` (`server-base.ts:828-855`), short-circuit when `tool.name === <discovery tool name>` and return the roster+policy built from `this`. This:
- keeps the read-enabled governance gate applying (consistent enforcement),
- avoids a wasted connect and lets discovery work even when the target IRIS is down,
- gives direct access to `this.profiles` / `this.governanceConfig` / `this.governedKeys` / `this.mutatesLookup`.

The `handleToolCall` "Server not initialised" guard (`server-base.ts:744`) requires `this.profiles` — i.e. `start()` must have run; that is acceptable (discovery is called against a running server). An alternative (a `ToolDefinition` whose handler closes over `this`, registered as a framework tool, plus a connection-skip) is possible but heavier; choose the cleanest path and record it in Completion Notes.

### `server` (framework, injected) vs `profile` (tool's own arg)
`withServerParam` injects an optional `server` field into EVERY tool's advertised schema (the connection profile selector) and `handleToolCall` strips it before the handler. [Source: server-base.ts:86-127, 735-741] The discovery tool ALSO needs its OWN `profile`/`allProfiles` args to select which profile's *policy* to report. These are distinct: `server` (irrelevant to discovery, since it does not connect) vs `profile` (drives the policy map). Do NOT declare a `server` field on the tool (`withServerParam` throws on a collision — `server-base.ts:118-125`). Document the distinction in the tool description so a client is not confused by both fields appearing.

### Governance classification — AC 19.0.4 (Rule #28)
`mutates: "read"` is MANDATORY even though it is a read — `assertGovernanceClassification` throws at registration for any non-baseline key lacking a class (`server-base.ts:447-449`, `governance.ts:356-377`). A `read` resolves to enabled-by-default via `defaultSeed` (only `write` → disabled). [Source: project-rules.md#28; governance.ts:401-411] Because the tool has no `action` enum, its governance key is the bare tool name (single key). Confirm `rebuildGovernedKeys` / `rebuildMutatesLookup` pick it up (they iterate `this.tools.values()` — so the discovery tool must be in `this.tools`, i.e. registered via the normal `registerTool` path even if its CALL is special-cased). [Source: server-base.ts:401-433]

### `instructions` field — AC 19.0.5
Set the `McpServer` `instructions` constructor option (alongside `capabilities` at `server-base.ts:344-358`) so capable clients surface the call-first guidance at connect time. Verify the option name against the installed `@modelcontextprotocol/sdk` and that it appears in the `initialize` result (a quick unit assertion or live `initialize` check). Keep it generic (no per-server wording) so all five servers share it.

### Docs rollup — framework-tool counting caveat (AC 19.0.9, Rule #30)
A framework tool is NOT in any package's `tools/index.ts` array, so the package `index.test.ts` `toHaveLength(...)` assertions (which count the package array) will NOT change. But the tool IS advertised on every server (`tools/list`). Decide how to represent counts: keep package-array length tests as-is, and bump the **advertised/suite** counts in the docs prose, documenting the framework tool distinctly (it adds +1 to each of the five servers' advertised surface). Flag the chosen representation in Completion Notes. Per Rule #30, state explicitly that the tool is a **read (enabled by default)**. [Source: project-rules.md#30]

### Testing standards
- Vitest, `packages/shared/src/__tests__/` (or the established shared test dir). New tests in the DEFAULT suite (not `*.integration.test.ts`). [Source: project-rules.md#21]
- Prefer constructing a real `McpServerBase` with an injected config / synthetic `env` to exercise registration + the discovery call end-to-end at the unit level (mirrors the Epic 14 governance/resource tests).
- Lead per-story smoke (Rule #22/#26) drives the BUILT `dist` artifact / a real server: confirm the roster EXCLUDES `password` and the policy `toEqual`s the D6 resource read for the same profile. (Lead-side gate — not your task, but author tests so the smoke has a clean surface.)

### Integration AC note (lead gate)
Story 19.0 introduces a new public surface (the framework tool). It is the ONLY story in Epic 19, so there is no later consumer story in-epic. The tool's own ACs (19.0.6 back-compat + 19.0.8 presence/roster/policy tests) exercise the tool end-to-end against a constructed server, satisfying the integration intent (Rule 1 escape: no in-epic consumer; the runtime consumer is the AI client). No separate Integration AC required.

### Project Structure Notes
- Touch points: `packages/shared/src/server-base.ts` (register + wire the tool, `instructions` field, optional resource `list`), a new tool-definition module under `packages/shared/src/` (e.g. `server-discovery.ts` or inline in server-base), `packages/shared/src/index.ts` (export if a standalone module), tests under `packages/shared/src/__tests__/`, and the docs set (root `README.md`, `packages/*/README.md`, `tool_support.md`, `packages/iris-mcp-all/README.md`, `CHANGELOG.md`).
- No `bootstrap-classes.ts` / `BOOTSTRAP_VERSION` change. No `governance-baseline.ts` change.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Epic-19] — epic + Story 19.0 ACs + Implementation Notes.
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-06-18.md] — issue, decision E1, redaction contract, guardrails, success criteria.
- [Source: packages/shared/src/profiles.ts] — `IrisProfile`, `ProfileRegistry`, `DEFAULT_PROFILE_NAME`, `resolveProfile`, `ProfileResolutionError`, `loadProfileRegistry`.
- [Source: packages/shared/src/governance.ts] — `getEffectivePolicy`, `effective`, `defaultSeed`, `assertGovernanceClassification`, `buildMutatesLookup`.
- [Source: packages/shared/src/server-base.ts] — D2 `withServerParam` (86-127), constructor + capabilities (343-393), `rebuildGovernedKeys`/`rebuildMutatesLookup` (401-433), D6 resource (451-563), `registerTool` (574-615), `computeGovernanceKey` (638-671), `handleToolCall` (680-869), `start` (997-1024).
- [Source: packages/shared/src/tool-types.ts] — `ToolDefinition`, `ToolContext`, `ToolResult`, `ToolScope`, `mutates`.
- [Source: .claude/rules/project-rules.md] — Rules #19, #22, #23, #25, #26, #28, #30.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.8 (1M context) — `claude-opus-4-8[1m]`.

### Debug Log References

- `pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/server-discovery.test.ts` — 17/17 pass.
- `pnpm -r test` — all packages green (shared 521, dev 330, admin 439, interop 220, ops 254, data 121).
- `pnpm run gen:governance-baseline:check` — exit 0 (141 frozen foundation keys; live 190; 49 post-foundation allowed; every frozen key still present). Frozen hash `1e62c5ad5bf7` untouched.
- `git status` confirms `packages/shared/src/governance-baseline.ts` and `bootstrap-classes.ts` / `BOOTSTRAP_VERSION` are NOT modified.

### Completion Notes List

- **Final tool name:** `iris_server_profiles` (distinct from the dev-only Atelier `iris_server_info`). Reserved framework name — the constructor throws if a package supplies a same-named tool.
- **Handler wiring (decision recorded):** chose the recommended "special-case in `handleToolCall`" path (after the governance gate, before `getOrCreateClient`) over a `ToolDefinition` handler closing over `this`. The tool is still registered via the normal `registerTool` path (so it is in `this.tools` and `rebuildGovernedKeys`/`rebuildMutatesLookup`/`assertGovernanceClassification` pick it up); only its CALL is intercepted. Its `ToolDefinition.handler` is a guard that throws if ever reached.
- **Redaction:** `buildRosterEntry` is an explicit allow-list (no spread/delete). Password-absence asserted on the roster JSON + secret-value absence on the full output, including under a multi-profile `IRIS_PROFILES` with a per-profile password.
- **Non-drift:** policy computed via the same `getEffectivePolicy(...)` call the D6 resource uses; a test cross-checks the tool's policy `toEqual` `getEffectivePolicy(...)` for the same inputs.
- **`instructions` field:** verified `ServerOptions.instructions` (sdk 1.29.0) is forwarded to `Server._instructions` and emitted in the `initialize` result. Set generically (no per-server wording) on the shared base.
- **AC 19.0.7 (optional companion) — SHIPPED:** the per-profile resource template `list` callback now enumerates `iris-governance://<profile>` per configured profile (reads `this.profiles` at call time; pre-start falls back to the reserved default). No `deferred-work.md` entry needed.
- **Framework-tool counting:** package `tools/index.ts` arrays are unchanged (their `toHaveLength(N)` assertions stay). Tests that assert the SERVER's advertised surface (`toolCount` / `getToolNames`) were updated +1 per server (the tool genuinely IS advertised). Docs distinguish "package total" vs "advertised (+1 framework)"; suite advertises 103 (98 package + 5 framework instances of the one tool).
- **Necessary test updates from the new framework tool:** 13 pre-existing shared/package tests asserted the old advertised counts/policy-map sizes; updated to account for the always-present discovery key (`server-base.test.ts`, `governance-enforcement.test.ts`, `governance-resource.test.ts`, `governance-resource-coverage.test.ts`, and the five package `index.test.ts`). The `governance-resource-coverage.test.ts` "only static gov entry in resources/list" test was reframed because the new template `list` callback (AC 19.0.7) deliberately adds per-profile entries.
- **No NFR tripwire / ADR conflict:** implementation matches decision E1 (central registration, allow-list redaction, `getEffectivePolicy` reuse, `mutates: "read"`, frozen baseline, `instructions`). No planning artifact amendment required.

### File List

**New:**
- `packages/shared/src/server-discovery.ts`
- `packages/shared/src/__tests__/server-discovery.test.ts`

**Modified (source):**
- `packages/shared/src/server-base.ts` (import + register discovery tool centrally; `instructions` field; `handleToolCall` short-circuit; resource template `list` callback)
- `packages/shared/src/index.ts` (barrel exports for the discovery module)

**Modified (tests, count/shape adjustments for the framework tool):**
- `packages/shared/src/__tests__/server-base.test.ts`
- `packages/shared/src/__tests__/governance-enforcement.test.ts`
- `packages/shared/src/__tests__/governance-resource.test.ts`
- `packages/shared/src/__tests__/governance-resource-coverage.test.ts`
- `packages/iris-dev-mcp/src/__tests__/index.test.ts`
- `packages/iris-admin-mcp/src/__tests__/index.test.ts`
- `packages/iris-interop-mcp/src/__tests__/index.test.ts`
- `packages/iris-ops-mcp/src/__tests__/index.test.ts`
- `packages/iris-data-mcp/src/__tests__/index.test.ts`

**Modified (docs):**
- `README.md`
- `tool_support.md`
- `CHANGELOG.md`
- `packages/iris-dev-mcp/README.md`
- `packages/iris-admin-mcp/README.md`
- `packages/iris-interop-mcp/README.md`
- `packages/iris-ops-mcp/README.md`
- `packages/iris-data-mcp/README.md`
- `packages/iris-mcp-all/README.md`

**Modified (process tracking):**
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (19-0 → review)

## Review Findings

Code review 2026-06-18 (bmad-code-review, 3 parallel layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor). Acceptance Auditor confirmed full AC conformance (E1 central registration, allow-list redaction, getEffectivePolicy non-drift, mutates:"read", frozen baseline `1e62c5ad5bf7` git-clean, instructions field, AC 19.0.7 resource list, docs across all surfaces, plain `*.test.ts`). 28 discovery tests pass; full shared suite 533 green; `gen:governance-baseline:check` exit 0.

- [x] [Review][Patch] Prototype-pollution-unsafe policy map for a profile named `__proto__`/`constructor` under `allProfiles:true` [packages/shared/src/server-discovery.ts:computeServerDiscovery] — FIXED. The all-profiles branch built `policies[name] = ...` via plain bracket assignment on a `{}`, so a profile whose name collides with a prototype member (admitted by `buildProfileRegistry`, which rejects only empty names; the registry is a `Map` so it stores `__proto__` fine, and `JSON.parse` of raw `IRIS_PROFILES` yields `__proto__` as an own property) would silently no-op the assignment — dropping that profile's policy from the output (roster/policies inconsistency) or mutating the result's prototype. The existing `getEffectivePolicy` deliberately uses `Object.defineProperty` for exactly this collision (with an explicit invariant comment); the new code did not mirror it. Fix: `Object.defineProperty(policies, name, {value, enumerable, writable, configurable})`. Added regression test "`allProfiles` map is collision-safe for a profile named `__proto__`" (uses a raw JSON literal since `JSON.stringify({__proto__:...})` yields `{}`).
- [x] [Review][~~Defer~~ → RESOLVED in retro 2026-06-18, user-requested] Discovery validates `profile` when `allProfiles:true` [packages/shared/src/server-discovery.ts:computeServerDiscovery] — `{allProfiles:true, profile:"typo"}` now throws `ProfileResolutionError` (validated via `resolveProfile`), matching the single-profile branch; a VALID `profile` is accepted and the full per-profile map is still returned (precedence documented in the `allProfiles` `.describe()`). +2 regression tests; live-re-smoked. (Was deferred LOW CR 19.0-1; addressed during the Epic 19 retrospective.)
- [x] [Review][~~Defer~~ → RESOLVED in retro 2026-06-18, user-requested] Invalid framework `server` arg no longer hard-fails discovery [packages/shared/src/server-base.ts:handleToolCall] — the `server`→profile `ProfileResolutionError` is now caught for the discovery tool ONLY and falls back to the reserved `default` profile (the tool never connects). NON-discovery tools still hard-fail on an unknown `server` (uniform D2 gate unchanged). +1 regression test; live-re-smoked. (Was deferred LOW CR 19.0-2; addressed during the Epic 19 retrospective.)

**Dismissed (noise / false positives):** instructions-field-location (it IS a sibling of `capabilities` in ServerOptions, not nested — verified server-base.ts:367; unit-tested in the initialize result); non-`ProfileResolutionError` rethrow in the short-circuit (consistent with the established `resolveProfile` rethrow at server-base.ts:829; SDK wraps it in an error envelope); `this.profiles` undefined passed to `computeServerDiscovery` (guarded by the "Server not initialised" check at server-base.ts:798 before the short-circuit); discovery tool disableable via IRIS_GOVERNANCE (intentional per AC 19.0.4, explicitly tested by E2E-5); resource-list-callback return-type annotation narrower than returned shape (TS structural typing — extra fields still returned at runtime; no defect).
