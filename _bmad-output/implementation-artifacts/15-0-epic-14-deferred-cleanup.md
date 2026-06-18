# Story 15.0: Epic 14 Deferred Cleanup

Status: done

## Story

As a developer,
I want the governance action-classification machinery hardened (action-enum unwrapping in lock-step across the gate and the baseline generator, a registration-time `mutates`-classification assertion, and fail-fast generator guards) **before** Epic 15 ships its first real governed write tool, plus the open `deferred-work.md` items re-triaged against Epic 15's scope,
so that the very first `mutates: 'write'` action (Story 15.1 `iris_service_manage:create/delete`) lands on a foundation that cannot silently downgrade per-action governance or ship an unclassified write enabled-by-default.

## Context

Epic 14 (Platform Foundation — Multi-Server Profiles & Tool Governance) completed 2026-06-16 (6/6 stories + Story 14.0 triage) and merged to `feature/mgmt-portal-tools`. Its retrospective ([`epic-14-retro-2026-06-16.md`](epic-14-retro-2026-06-16.md)) is the trigger for this retro-review gate.

The Epic 14 retro made one preparation requirement **explicit and load-bearing** for Epic 15 (Action Item 2; "Next Epic Preview"; "What Could Be Better" #1/#2):

> Resolve the deferred `.optional()`-wrapped-action-enum gate/baseline-generator hardening **BEFORE or WITH the first governed write tool** (it becomes reachable the moment a real new write action ships).

Epic 15's **Story 15.1** (`iris_service_manage` with `create`/`delete` actions) is that first governed write tool. Story 15.0 runs first in the epic, so resolving the hardening here puts the corrected machinery in place **before** 15.1 builds on it. This is the de-risking the retro mandates.

Two `deferred-work.md` items converge on the same root cause and are addressed together:
- **[14.4 / LOW]** `computeGovernanceKey` degrades per-action governance to whole-tool governance (and can build a `tool:undefined` key) if a future `action` enum is wrapped in `.optional()` / `.default()` / `.nullable()` (`packages/shared/src/server-base.ts:622-624`; mirror `scripts/gen-governance-baseline.mjs:62-63`).
- **[14.3 / LOW]** Generator + drift-test enumeration silently downgrades several malformed-tool shapes to a bare key (missing `name`/`inputSchema`, empty enum, non-string option, `z.optional(z.enum(...))`), and cross-package duplicate tool names silently merge.

Both deferrals prescribe the SAME fix: unwrap the Zod wrapper before reading `.options` in **BOTH** the gate (`computeGovernanceKey`) and the generator (`gen-governance-baseline.mjs`) so they stay in lock-step, add a registration-time assertion that a non-baseline action carries a valid `mutates` classification, and add generator guards that throw on malformed shapes. The related [14.3 / LOW] items (unclassified-write fail-open; `mutates` typo unvalidated; `__proto__` action key; cross-package name collision) are the same "harden classification before real write tools" cluster and are folded in.

**This is a code-changing cleanup story** (unlike Story 14.0, which was a triage-record-only artifact). It carries real, testable ACs and passes the full dev → QA → code-review → smoke pipeline. It is **TypeScript + generator + tests only** — **no ObjectScript, no `BOOTSTRAP_VERSION` bump** (the Epic-15 bootstrap bump is reserved for Story 15.6).

**Back-compat is a release gate (Rule #19).** The current surface (89 tools → 141 baseline keys, hash `1e62c5ad5bf7`) declares **no** `mutates` on any tool and every `action` is a **required bare** `z.enum(...)`. Therefore every change in this story MUST be a no-op on the current surface: unwrapping a non-wrapped enum is identity; the registration assertion only fires for non-baseline keys (all current keys are in the baseline); the generator guards only throw on shapes that do not currently exist. **Mechanical proof:** regenerating `governance-baseline.ts` after the changes MUST reproduce the identical hash `1e62c5ad5bf7`, and the full `@iris-mcp/shared` suite (450 tests) MUST stay green.

## Acceptance Criteria

1. **AC 15.0.1 — Action-enum unwrap in lock-step (gate + generator).** Both `computeGovernanceKey` (`packages/shared/src/server-base.ts`) and `scripts/gen-governance-baseline.mjs` unwrap `ZodOptional` / `ZodDefault` / `ZodNullable` (via `.unwrap()` / `._def.innerType`, iterating until the inner type is reached) **before** reading `.options`, so an `action: z.enum([...]).optional()` (or `.default(...)` / `.nullable()`) still yields per-action `tool:action` keys rather than collapsing to the bare `tool` key. The two code paths use the SAME unwrap helper/logic so they cannot drift.

2. **AC 15.0.2 — Gate undefined-action guard.** `computeGovernanceKey`'s multi-action branch additionally requires `validatedArgs.action !== undefined` before composing `tool:action`, so the literal key `tool:undefined` can never be built; if `action` is absent it falls back to the bare-tool key.

3. **AC 15.0.3 — Registration-time classification assertion (fail-fast).** Adopt the contract: **every governance key NOT in `GOVERNANCE_BASELINE`** (i.e. every tool/action added after the foundation) **MUST declare a `mutates` classification** (`'read'` or `'write'`). At tool registration / governance initialization, the framework throws a clear, named error (naming the offending tool/action key) if a non-baseline key lacks a `mutates` entry. Baseline / grandfathered tools (all 141 current keys) are **exempt** and may omit `mutates`. This makes "forgot to classify a new tool" — read **or** write — a startup failure rather than a silent enabled-by-default ship, and it removes the ambiguity that an absent `mutates` could mean either "intentional new read" or "forgotten write." **Resolution note (Rule 5, lead 2026-06-16):** the original AC wording ("throw if non-baseline carries no `mutates`") collided with D3's "unclassified ⇒ read, enabled" seed semantics and broke 14 synthetic read fixtures. The strict contract above is the literal reading of the source 14.3 deferred item and is the robust safety net (Option 1 — gating on `annotations.destructiveHint` — was rejected as weaker: a write declaring neither `mutates` nor a hint would slip through). The `defaultSeed` read-default (`governance.ts:265`) REMAINS as defense-in-depth, but a new tool can no longer reach it unclassified. Update the doc comments on the `mutates?` field (`tool-types.ts`) and `defaultSeed` (`governance.ts`) to state this contract.

4. **AC 15.0.4 — `mutates` value + reserved-key validation.** `buildMutatesLookup` (`packages/shared/src/governance.ts`) throws on any `mutates` value not exactly `"read"` or `"write"` (catches a typo like `"wite"` that today silently classifies as a read), and screens record-form action keys against the reserved set (`__proto__`, `constructor`, `prototype`) — mirroring the `RESERVED_KEYS` guard already in `validateLayer` (CR-14.3-1).

5. **AC 15.0.5 — Generator fail-fast guards.** `scripts/gen-governance-baseline.mjs` throws (rather than silently downgrading to a bare key / `"undefined"` key) when a tool is missing `name`, missing `inputSchema`, declares an **empty** `action` enum, declares a **non-string** enum option, or when a **duplicate tool name** (or `tool:action` key) appears across the five `SERVER_PACKAGES`. Each error message names the offending package + tool.

6. **AC 15.0.6 — Edge-case test coverage.** `packages/shared/src/__tests__/governance-edge.test.ts` gains cases proving: (a) `action: z.enum([...]).optional()` / `.default(...)` / `.nullable()` yields per-action keys in **both** the gate path and the generator-introspection path; (b) the registration assertion throws for a NEW (non-baseline) tool — read OR write — that omits `mutates`, and does NOT throw for a baseline key or for a new tool that declares `mutates: 'read'|'write'`; (c) `buildMutatesLookup` throws on an invalid `mutates` value and on a reserved record key; (d) the generator guards throw on missing-`name` / missing-`inputSchema` / empty-enum / non-string-option / duplicate-name shapes.

7. **AC 15.0.7 — Back-compat gate (mechanical, Rule #19/#20).** After all changes, regenerating the baseline via `pnpm run gen:bootstrap`'s sibling `gen:governance-baseline` (or the documented command) reproduces the **identical** `GOVERNANCE_BASELINE_HASH = "1e62c5ad5bf7"` and the identical 141-key set; the `@iris-mcp/shared` suite (450 baseline tests + the new cases) is green; `tsc` strict build and lint are clean. No existing tool's governance key, default-seed result, or effective policy changes.

8. **AC 15.0.8 — Stable doc-drift fix.** `docs/migration-v1-v2.md` line 28 ("Tool naming" row) is corrected from the dotted v2 scheme (`iris.execute.command`, `iris.global.get`) to the shipped **underscore** scheme (`iris_execute_command`, `iris_global_get`, etc.). (The dotted names predate the Epic-9 flattening and are a user-facing inaccuracy in a release doc.)

9. **AC 15.0.9 — Triage record.** [`deferred-work.md`](deferred-work.md) gains a `## Triaged via Story 15.0 (2026-06-16)` closure section recording, append-only, the disposition (INCLUDE / ROUTE / DEFER) of every open item — INCLUDE for the items resolved here, ROUTE for the items assigned to a later Epic 15 story, DEFER (with rationale) for everything with no Epic 15 intersection.

10. **AC 15.0.10 — Scope boundary.** No ObjectScript changes; no `BOOTSTRAP_VERSION` bump (reserved for Story 15.6); `architecture.md` count refresh is **NOT** done here (routed to 15.6, where the final post-Epic-15 suite total is known — fixing it here would set an immediately-stale intermediate value). Touched files limited to: `packages/shared/src/server-base.ts`, `packages/shared/src/governance.ts`, `packages/shared/src/tool-types.ts` (doc-comment reconciliation for the AC 15.0.3 contract), `scripts/gen-governance-baseline.mjs`, `packages/shared/src/governance-baseline.ts` (regenerated — hash unchanged), `packages/shared/src/__tests__/governance-edge.test.ts` and the sibling test files whose synthetic non-baseline fixtures must declare `mutates` under the AC 15.0.3 contract (`server-base.test.ts`, `server-param.test.ts`, `server-param-integration.test.ts` — add `mutates: 'read'`/`'write'` to each non-baseline fixture; this keeps the back-compat suite green per AC 15.0.7 without changing any baseline key or the hash), `docs/migration-v1-v2.md`, `deferred-work.md`, `sprint-status.yaml`, and this story file.

## Triage Table — INCLUDE (resolved in this story)

| # | Source | Item | AC |
|---|---|---|---|
| 1 | CR 14.4 / LOW | `computeGovernanceKey` action-enum `.optional()`/`.default()`/`.nullable()` downgrade + `tool:undefined` | 15.0.1, 15.0.2 |
| 2 | CR 14.3 / LOW | Generator + drift-test silently downgrade malformed shapes (missing name/schema, empty enum, non-string option, wrapped enum) | 15.0.1, 15.0.5 |
| 3 | CR 14.3 / LOW | `defaultSeed` fails OPEN for an unclassified non-baseline key (new write forgetting `mutates` ships enabled) | 15.0.3 |
| 4 | CR 14.3 / LOW | `mutates` typo (`"wite"`) flows through unvalidated as a read | 15.0.4 |
| 5 | CR 14.3 / LOW | `buildMutatesLookup` loses a `__proto__` action key | 15.0.4 |
| 6 | CR 14.3 / LOW | Cross-package tool-name collision silently merged | 15.0.5 |
| 7 | CR 14.6 / LOW | `migration-v1-v2.md:28` documents dotted v2 tool names (pre-Epic-9) | 15.0.8 |

## Triage Table — ROUTE (assigned to a later Epic 15 story)

| # | Source | Item | Routed to |
|---|---|---|---|
| 8 | Epic 14 retro AI#3 | Verify the `mutates:'write'` seed actually disables the first write tool end-to-end (real-tool exercise) | **Story 15.1** (`iris_service_manage` — the first governed write tool; add a back-compat/governance AC) |
| 9 | Epic 14 retro AI#4 | Regenerate `governance-baseline.ts` whenever Epic 15 adds a tool; drift test enforces | **Story 15.6** (BOOTSTRAP bump + verification) **and per new-tool story** |
| 10 | CR 14.6 / LOW | `architecture.md:32` "86 tools" + `:167` "(16 tools)" stale counts | **Story 15.6** (docs/count reconciliation — set to the FINAL post-Epic-15 suite total; ops→17 independent of Epic 15 but reconciled in the same pass) |
| 11 | CR 14.3 / LOW | `SERVER_PACKAGES` list duplicated across generator + drift test (sync-by-comment) | **Story 15.6** (or a future generator-refactor) — maintainability, not a current correctness bug; the duplicate-name guard (AC 15.0.5) reduces the blast radius |
| 12 | CR 14.3 / LOW | Generator has no `--check` mode for CI drift enforcement | **Deferred to a CI story** (mirrors the existing `gen:bootstrap` discipline; out of Epic 15 scope) — see DEFER table |

## Triage Table — DEFER (no Epic 15 intersection; carried forward unchanged)

| # | Source | Item | Rationale |
|---|---|---|---|
| 13 | CR 14.1 / MED | Concurrency race in `getOrCreateClient` first-touch (no in-flight promise cache for mixed callers) | Connection-layer; Epic 15 adds admin **tools**, not new connection callers. Defer to a connection-hardening pass. |
| 14 | CR 14.1 / MED | Non-default first-touch health-check failure caches client, records no meta | Same connection-layer; no admin-tool intersection. |
| 15 | CR 14.1 / LOW | `port`/`timeout` accept `Number()`-coerced strings/booleans/arrays (asymmetric with strict `https`) | Profile-parsing hardening; operator-authored JSON; not reached by Epic 15. |
| 16 | CR 14.1 / LOW | Whitespace-only profile name registered; typo'd profile keys silently ignored | Profile-parsing hardening; not reached by Epic 15. |
| 17 | CR 14.1 / LOW | No `destroyAll()`/shutdown drain on `McpServerBase`; default-vs-override profile construction divergence | Lifecycle/pre-existing; not reached by Epic 15. |
| 18 | CR 14.2 / MED | In-flight establishment Promise ignores `needsBootstrap` variance | Latent — sole caller passes a constant; connection-layer. Not reached by Epic 15. |
| 19 | CR 14.2 / MED | Untrimmed/mis-cased `server` value → confusing-but-safe "unknown profile" error | Tested semantics; profile-resolution hardening pass. Not reached by Epic 15. |
| 20 | CR 14.2 / LOW | `addTools()` re-adding a live name throws after maps mutated (partial state) | Pre-existing caller-error path; server-base hardening pass. |
| 21 | CR 14.2 / INFO | Secondary coalescing branch lacks a dedicated test | Optional coverage nicety; code verified correct. |
| 22 | CR 14.5 / LOW | URL-encoded profile name not decoded in `iris-governance://{profile}` resource template | Advisory resource; realistic names are identity-encoded; no crash. Defer to a URI-policy pass. |
| 23 | Story 14.0 retained | All Epic 11/12 retained-open items (Epic 11 retro #1/#3/#6; CR 10.1/10.2; CR 11.3/11.1; Epic 8.x legacy; CR 12.1–12.5; Story 12.6 alert clear/ack; live-verify 12.4 docdb typed-property population) | Re-affirmed DEFER — none intersect Epic 15 (admin Security/LDAP/X.509/Audit/SQL-privilege tools). Carried forward unchanged. |

## Tasks / Subtasks

- [x] **Task 1 — Lock-step action-enum unwrap (AC 15.0.1, 15.0.2)**
  - [x] Add a small shared unwrap helper (`unwrapActionOptions(field)`) that peels `ZodOptional`/`ZodDefault`/`ZodNullable` to the inner type before `.options` is read. Placed in `governance.ts` (exported); the `.mjs` generator replicates the exact algorithm with a "MUST mirror" comment.
  - [x] Update `computeGovernanceKey` (`server-base.ts`) to unwrap, and require `validatedArgs.action !== undefined` in the multi-action branch. Also updated the third copy, `rebuildGovernedKeys`, to use the same helper (lock-step across all three gate-side readers).
  - [x] Update `gen-governance-baseline.mjs` to unwrap identically (mirrored `unwrapActionOptions`).
- [x] **Task 2 — Registration-time classification assertion (AC 15.0.3, strict contract)**
  - [x] Added `assertGovernanceClassification` (`governance.ts`) + `McpServerBase.assertGovernanceClassified()` wired into construction + `addTools`/`removeTools`: throws (naming the key) when a non-baseline key lacks `mutates`. Verified dormant on the current all-baseline surface (full suite green). Reconciled the strict-contract doc comments on `tool-types.ts` `mutates?` and `governance.ts` `defaultSeed`. Updated ~11 synthetic non-baseline test fixtures to declare `mutates: "read"` (AC 15.0.10 permits these three test files).
- [x] **Task 3 — `mutates` value + reserved-key validation (AC 15.0.4)**
  - [x] In `buildMutatesLookup` (`governance.ts`), throw (via `assertMutationClass`) on a value ∉ {`"read"`,`"write"`} (scalar + per-action) and on a reserved record action key (`__proto__`/`constructor`/`prototype`).
- [x] **Task 4 — Generator fail-fast guards (AC 15.0.5)**
  - [x] In `gen-governance-baseline.mjs`, throw on missing `name`, missing `inputSchema`, empty `action` enum, non-string option, and duplicate key across packages (a `seen` Map turns the prior silent Set merge into a hard error naming both producers).
- [x] **Task 5 — Tests (AC 15.0.6)**
  - [x] Added `governance-edge.test.ts` cases (a)–(d) + a Zod-wrapper-introspection pin; added server-level registration-assertion tests (15.0.6(b)) in `server-base.test.ts`.
- [x] **Task 6 — Regenerate + back-compat proof (AC 15.0.7)**
  - [x] Built `@iris-mcp/shared` + the 5 server packages; regenerated the baseline — hash STILL `1e62c5ad5bf7`, 141 keys, 89 tools, `governance-baseline.ts` byte-identical (empty git diff). Full shared suite green (484 = 450 + 34 new); `tsc` strict + lint clean (monorepo 12/12 type-check, 6/6 lint).
- [x] **Task 7 — Doc fix (AC 15.0.8)**
  - [x] Corrected `docs/migration-v1-v2.md` "Tool naming" row dotted → underscore, and (per the 14.6 deferral's audit note) every remaining dotted v2 tool name in the file (Tool Mapping table, "Additional v2 tools" list, 2 FAQ prose lines). Zero dotted `iris.x.y` names remain.
- [x] **Task 8 — Triage record + sprint status (AC 15.0.9, 15.0.10)**
  - [x] Appended `## Triaged via Story 15.0 (2026-06-16)` to `deferred-work.md` (append-only): 7 INCLUDE / 5 ROUTE / 11 DEFER. Confirmed no ObjectScript, no bootstrap bump, `architecture.md` untouched. Sprint status set to `review`.

## Dev Notes

- **Current-surface reality (verified at story creation):** 89 tools, 141 baseline keys, hash `1e62c5ad5bf7`. No tool declares `mutates`. Every multi-action tool's `action` is a **required bare** `z.enum(...).describe(...)` (21 multi-action tools confirmed across the five packages in the 14.3/14.4 reviews). Therefore all changes here are no-ops on today's surface — that is the back-compat proof, not a hope.
- **Lock-step is the crux (AC 15.0.1).** The gate and the generator MUST read the action enum through the SAME unwrap logic. If only one is patched, an `action: z.enum(...).optional()` tool would make the gate and baseline disagree → the cascade misses → a per-action deny silently never matches (fail-open). Patch both or neither.
- **Zod v4 wrapper introspection (verify empirically per Rules #14/#16):** a bare `z.enum([...])` and `.describe(...)` expose `.options`; `.optional()` → `ZodOptional` (`.unwrap()` → inner), `.default(x)` → `ZodDefault` (`._def.innerType`), `.nullable()` → `ZodNullable` (`.unwrap()`). Confirm the exact unwrap accessor against the installed Zod version before relying on it; add a test that pins it.
- **Registration assertion must not over-fire.** It fires ONLY for a key absent from `GOVERNANCE_BASELINE` that also lacks a `mutates` class. Because every current key is a baseline member, it is dormant today and only activates when Epic 15's genuinely-new tools land — exactly the intended safety net for Story 15.1+.
- **No `BOOTSTRAP_VERSION` bump** — this is TypeScript + generator + docs only. The single Epic-15 bootstrap bump is Story 15.6 (covers all Epic-15 ObjectScript).
- **`architecture.md` deliberately NOT touched here** — its count fix is routed to 15.6 so it lands at the final post-Epic-15 suite total instead of an intermediate value that 15.1–15.5 would immediately invalidate.

## Dev Agent Record

### Completion Notes

All 10 ACs implemented and verified.

- **AC 15.0.1 / 15.0.2 (lock-step unwrap + undefined guard):** added `unwrapActionOptions(field)` to `governance.ts` (exported), peeling `ZodOptional`/`ZodDefault`/`ZodNullable` iteratively (via `.unwrap()` with `._def.innerType` fallback) before reading `.options`. Wired into ALL THREE gate-side readers — `computeGovernanceKey`, `rebuildGovernedKeys` (`server-base.ts`) — and mirrored verbatim in `gen-governance-baseline.mjs` with a "MUST mirror" comment. The gate's multi-action branch now also requires `validatedArgs.action !== undefined`, so `tool:undefined` can never be built. Zod 4.3.6 wrapper introspection verified empirically (probe) and pinned by a test.
- **AC 15.0.3 (registration assertion, STRICT contract per lead's Rule 5 amendment):** `assertGovernanceClassification` + `McpServerBase.assertGovernanceClassified()` throw, naming the key, when any non-baseline tool/action key reaches registration without `mutates`. Baseline keys (all 141) exempt. Doc comments on `tool-types.ts` `mutates?` and `governance.ts` `defaultSeed` reconciled (read-default is now defense-in-depth, unreachable unclassified at registration).
- **AC 15.0.4:** `buildMutatesLookup` throws on a `mutates` value ∉ {read,write} (scalar + per-action) and on a reserved record action key.
- **AC 15.0.5:** generator throws on missing name / missing inputSchema / empty enum / non-string option / cross-package duplicate key (a `seen` Map; the prior silent Set merge is now a hard error).
- **AC 15.0.6:** edge tests for (a) wrapped-enum → per-action keys (gate + generator paths), (b) registration throws for an unclassified new tool (read OR write) and not for baseline/classified (server-level), (c) `buildMutatesLookup` value + reserved-key validation, (d) generator guards; plus a Zod-wrapper-accessor pin.
- **AC 15.0.7 (back-compat gate — mechanical):** baseline regenerated **byte-identical**, hash STILL `1e62c5ad5bf7`, 141 keys, 89 tools (empty git diff on `governance-baseline.ts`). `@iris-mcp/shared` suite green: **484** tests (450 baseline + 34 new). `tsc` strict clean (monorepo 12/12 type-check); lint clean (6/6). No existing tool's governance key / seed / effective policy changed.
- **AC 15.0.8:** `migration-v1-v2.md` dotted v2 tool names → underscore (line-28 row + full Tool Mapping table + "Additional v2 tools" list + 2 FAQ lines); zero `iris.x.y` names remain.
- **AC 15.0.9:** `## Triaged via Story 15.0 (2026-06-16)` appended to `deferred-work.md` (append-only): 7 INCLUDE / 5 ROUTE / 11 DEFER.
- **AC 15.0.10:** no ObjectScript; no `BOOTSTRAP_VERSION` bump; `architecture.md` untouched (routed to 15.6).

**Process note (Rule 5):** the original AC 15.0.3 wording ("throw if non-baseline carries no `mutates`") collided with the project's own D3 seed semantics ("unclassified ⇒ read, enabled") and broke 14 synthetic read fixtures. Halted and surfaced the contradiction rather than working around it; the lead amended the AC in place to the strict contract (every non-baseline tool must classify, read or write) and authorized touching the three fixture test files + `tool-types.ts`. Implemented to the amended AC.

### File List

- `packages/shared/src/governance.ts` (modified — `unwrapActionOptions`, `assertGovernanceClassification`, `assertMutationClass`, `buildMutatesLookup` validation, `defaultSeed` doc)
- `packages/shared/src/server-base.ts` (modified — `computeGovernanceKey` unwrap + undefined guard, `rebuildGovernedKeys` unwrap, `assertGovernanceClassified` wiring, imports)
- `packages/shared/src/tool-types.ts` (modified — `mutates?` strict-contract doc comment)
- `packages/shared/src/index.ts` (modified — export `unwrapActionOptions`, `assertGovernanceClassification`)
- `scripts/gen-governance-baseline.mjs` (modified — mirrored unwrap + fail-fast guards + cross-package dedup)
- `packages/shared/src/governance-baseline.ts` (regenerated — byte-identical, hash `1e62c5ad5bf7` unchanged)
- `packages/shared/src/__tests__/governance-edge.test.ts` (modified — Story 15.0 cases a/c/d + Zod pin)
- `packages/shared/src/__tests__/server-base.test.ts` (modified — registration-assertion tests (15.0.6(b)); `mutates` on non-baseline fixtures)
- `packages/shared/src/__tests__/server-param.test.ts` (modified — `mutates` on `makeEchoTool`)
- `packages/shared/src/__tests__/server-param-integration.test.ts` (modified — `mutates` on `makeEchoTool` + 2 inline fixtures)
- `docs/migration-v1-v2.md` (modified — dotted→underscore tool names)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified — Story 15.0 triage section, append-only)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — status → review)
- `_bmad-output/implementation-artifacts/15-0-epic-14-deferred-cleanup.md` (this file — tasks/notes/status)

## Review Findings (Code Review — 2026-06-16)

Adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor). Acceptance Auditor: all 10 ACs genuinely implemented AND exercised by regression-catching tests on the real `McpServerBase` surface; recommended ACCEPT. One HIGH fail-open found and auto-resolved; remainder deferred as forward-looking robustness (not reachable on a real Zod tool, lock-step preserved).

### HIGH — RESOLVED (auto-fix)

**CR-15.0-1 — `.nullable()` action enum: `action: null` built `tool:null` → per-action governance fail-open.**
- **Source:** Edge Case Hunter (also surfaced by Blind Hunter as the `action !== undefined → bare key` class).
- **Evidence (empirically confirmed via probe):** AC 15.0.2's guard tested `validatedArgs.action !== undefined`. A `.nullable()` action enum (a shape this story explicitly added support for) accepts `action: null`; `null !== undefined` is true, so `computeGovernanceKey` composed `iris_x:null`. That key is in neither the per-action `mutates` lookup nor the generated baseline, so `defaultSeed` resolved it through the read-default → **ENABLED**, silently bypassing any per-action `wipe:false` deny an operator configured. The generator only ever enumerates the enum's string options (never `null`), so the gate could build a key the baseline can never contain — a lock-step violation and a reachable fail-open the moment a `.nullable()` action enum ships (Story 15.1+).
- **Fix (`server-base.ts` `computeGovernanceKey`):** compose `tool:action` only when `options.includes(validatedArgs.action)` — i.e. the validated action is an ACTUAL member of the unwrapped enum, a key the generator could itself produce. This generalizes AC 15.0.2: `null`, an absent/`undefined` action, and any non-member value all fall back to the bare-tool key, keeping the gate key provably in lock-step with the generated baseline. Membership also closes the `action: "undefined"`-string and out-of-enum value edges in one stroke.
- **Regression test (`governance-classification.test.ts`):** two new cases through the REAL gate — (a) a `.nullable()` action set to `null` with the bare key denied is now DENIED on the bare key (never `:null`); (b) a null action does not bypass a per-action `wipe:false` deny. Mutation-verified: reverting the guard to the old `!== undefined` form makes test (a) FAIL at the denial assertion, confirming it catches the regression.
- **Re-verification after fix:** baseline regenerated byte-identical (hash `1e62c5ad5bf7`, 141 keys, 89 tools); `@iris-mcp/shared` suite 500 green (498 + 2 new); `tsc` strict + lint clean (18/18 monorepo). Back-compat gate intact.

### LOW — DEFERRED (forward-looking robustness; not reachable on a real Zod tool; logged in deferred-work.md under Story 15.0 CR)

- **CR-15.0-2 — Gate `unwrapActionOptions` does not validate option element types / non-string `.options` (generator DOES throw).** Asymmetry only reachable via a non-Zod field masquerading with a numeric `.options`; a genuine `z.enum()` is string-only and the generator hard-stops such a tool at build time before any baseline ships. Defer to the Epic 15 generator/drift-test hardening pass.
- **CR-15.0-3 — `unwrapActionOptions` peels only `.unwrap()` / `._def.innerType` (covers `.optional()`/`.default()`/`.nullable()` — the story's declared set); `ZodEffects`/`ZodPipeline` would fall back to the bare key.** Out of the three declared wrappers; project rules forbid `.refine()` on MCP schemas; gate AND generator fail identically (lock-step preserved, no gate/baseline disagreement). Defer to a future wrapper-support story.
- **CR-15.0-4 — `unwrapActionOptions` calls `field.unwrap()` unguarded; a throwing accessor would propagate out of the constructor.** Not reachable for real Zod types. Defer.
- **CR-15.0-5 — Drift test `governance.test.ts:540` derives keys WITHOUT the shared `unwrapActionOptions` (pre-existing, NOT in Story 15.0's changed set).** Harmless on today's all-bare surface, but a real lock-step gap that should close before a wrapped enum ships — same class as the already-ROUTED "SERVER_PACKAGES duplicated across generator + drift test." Fold into the Story 15.6 generator/drift-test de-duplication.
- **CR-15.0-6 — `buildMutatesLookup` silently accepts a `mutates` map key that is not an enum member (stale/typo'd action key).** The missing real action IS caught by the registration assertion; only a dead stale entry is unflagged. Cosmetic. Defer.

### Acceptance Auditor — verdict
All ACs 15.0.1–15.0.10 PASS: code + regression-catching test on the real surface for each. Lock-step `unwrapActionOptions` is byte-for-byte identical between `governance.ts` and the generator with "MUST mirror" comments pinned in both. Registration assertion confirmed dormant on the real 141-key baseline and firing through real `new McpServerBase(...)` for genuinely-new unclassified tools (incl. partial-mutates-map). Hash/baseline pinned in-suite by the drift + hash tests. New tests are all `.test.ts` (default suite), not `.integration.test.ts`.

## Change Log

| Date | Change |
|---|---|
| 2026-06-16 | Story 15.0 authored as Epic 14 retro-review gate. INCLUDE: governance action-classification hardening (lock-step action-enum unwrap, gate undefined guard, registration-time `mutates` assertion, `mutates` value/reserved-key validation, generator fail-fast guards, edge tests) + `migration-v1-v2.md` dotted→underscore fix. ROUTE: 5 items → 15.1 / 15.6. DEFER: 11 connection/profile-layer + retained items. TypeScript + generator + tests + docs only; no ObjectScript; no BOOTSTRAP_VERSION bump; baseline hash unchanged (`1e62c5ad5bf7`). |
| 2026-06-16 | Dev implementation complete (status → review). AC 15.0.3 amended in place by lead (Rule 5) to the strict-classification contract after a dev-surfaced contradiction with D3 seed semantics. All 10 ACs verified: baseline byte-identical (hash `1e62c5ad5bf7`, 141 keys, 89 tools); shared suite 484 green (+34 new); `tsc` strict + lint clean. |
| 2026-06-16 | Code review (3 adversarial layers). Acceptance Auditor: ACCEPT — all 10 ACs implemented + regression-tested on the real `McpServerBase` surface. One HIGH fail-open found and auto-resolved (CR-15.0-1: `.nullable()` `action: null` → `tool:null` per-action governance bypass; fixed in `computeGovernanceKey` via enum-membership guard, mutation-verified regression test added). 5 LOW items deferred (CR-15.0-2..6, logged in deferred-work.md; CR-15.0-5 folded into 15.6). Re-verified post-fix: baseline byte-identical (hash `1e62c5ad5bf7`, 141 keys, 89 tools); shared suite **500** green (+2 new); `tsc` strict + lint clean (18/18). |
