# Story 15.1: `iris_service_manage` — IRIS Service Configuration

Status: done

## Story

As an administrator,
I want to list and toggle IRIS services and their auth settings via the agent,
so that I can harden an instance (e.g. disable `%Service_Telnet`) — with the mutating actions safely opt-in under governance.

## Context

Epic 15 (Security & Admin Tools) builds new `@iris-mcp/admin` tools on the Epic 14 governance foundation. **Story 15.1 is the FIRST real governed write tool in the entire suite** — it is the first consumer of the `mutates`/default-seed machinery hardened in Story 15.0 (Epic 14 retro Action Item 3: "verify the `mutates:'write'` seed actually disables it by default end-to-end").

Building it surfaced an **architectural decision** about how the governance baseline evolves (resolved by the Project Lead 2026-06-16, **frozen-foundation model** — see AC 15.1.7): the Epic-14 drift test asserted `GOVERNANCE_BASELINE == live tool surface` bidirectionally, but a new write must be **absent** from the baseline for `defaultSeed` to default-disable it. These cannot both hold once a new tool ships. **Resolution:** `GOVERNANCE_BASELINE` is a **frozen Epic-14 foundation snapshot** (141 keys, hash `1e62c5ad5bf7`) — new Epic 15+ tool keys are intentionally NOT added to it; the drift test is relaxed to one-directional (every foundation key must still exist in the live surface; new live keys outside the foundation are expected and allowed).

**User-visible behavior (intended, safe-by-default):** with no `IRIS_GOVERNANCE` config, `list`/`get` (reads) are enabled out of the box; `enable`/`disable`/`set` (writes) are **disabled by default** and return a structured `GOVERNANCE_DISABLED` denial until the operator opts in via `IRIS_GOVERNANCE`. This does NOT break back-compat (the tool is new; "no config = today's behavior" still holds for all pre-existing tools).

**Bootstrap policy (clarified by the lead 2026-06-16, Option A):** Story 15.1 edits two BOOTSTRAPPED classes (`Security.cls`, `Dispatch.cls`). The bootstrap drift test (`bootstrap.test.ts`) mechanically asserts on-disk `.cls` == embedded `bootstrap-classes.ts` AND `BOOTSTRAP_VERSION` == SHA-256 of the on-disk classes — so editing a bootstrapped class REQUIRES regenerating `bootstrap-classes.ts` (`pnpm run gen:bootstrap`, Rule #18 — never hand-edit) and the version moves to the new content hash. The epics.md "one BOOTSTRAP_VERSION bump at 15.6" framing is therefore reinterpreted: the version moves INCREMENTALLY with each ObjectScript-touching Epic-15 story; **Story 15.6 is the FINAL consolidated state + live verification + docs rollup, not the sole bump.** This same reinterpretation applies to Epics 16/17 (whose plans use the identical "one bump at the closing story" language).

## Acceptance Criteria

1. **AC 15.1.1 — Tool surface.** Tool `iris_service_manage` in `@iris-mcp/admin`. Single multi-action tool; `action` is a required bare `z.enum(["list","get","enable","disable","set"])`. Tool-level `annotations.readOnlyHint: false` (the tool can mutate); the per-action read/write distinction is realized through `mutates` (the governance layer), since MCP annotations are tool-scoped. Tool does NOT declare a `server` field (the framework injects it — D2). Tool is added to `packages/iris-admin-mcp/src/tools/index.ts`'s exported `tools` array.

2. **AC 15.1.2 — Governance classification (the headline AI#3 verification).** `mutates: { list: "read", get: "read", enable: "write", disable: "write", set: "write" }` (ALL five action keys classified, per Story 15.0's strict contract — a new tool whose keys are absent from the frozen baseline must classify every key). Under **empty `IRIS_GOVERNANCE`**: `iris_service_manage:enable|disable|set` resolve **disabled** (`effective() === false`) and `:list|:get` resolve **enabled**. A real end-to-end test through `McpServerBase.handleToolCall` asserts a disabled write returns the structured `GOVERNANCE_DISABLED` denial (keyed `iris_service_manage:enable`) and the handler is NOT invoked; an explicit `IRIS_GOVERNANCE` enable flips it.

3. **AC 15.1.3 — ObjectScript handler.** New methods `ServiceList` + `ServiceManage` on `ExecuteMCPv2.REST.Security` (or an adjacent class), backed by `%SYS` `Security.Services` (`List` query, `Get(name, .props)`, `Modify(name, .props)`). Namespace save/restore via `Set tOrigNS = $NAMESPACE` / `Set $NAMESPACE = "%SYS"` / restore — **NEVER** `New $NAMESPACE` (project rule). Catch block restores namespace as its first line.

4. **AC 15.1.4 — I/O contract.** Input: `action`, `name` (service, e.g. `%Service_SQL`), `settings` (object — for `set`/auth fields like `enabled`, `autheEnabled`, `clientSystems`), `server` (profile, framework-injected), `namespace`. Output: a service list (for `list`) / service properties (for `get`) / a structured `{action, name, ...}` result (for `enable`/`disable`/`set`), returned as `{ content:[text], structuredContent }`.

5. **AC 15.1.5 — Error handling.** Errors propagate via `##class(ExecuteMCPv2.Utils).SanitizeError(tSC)` (Rule #9) — the `%Status` text is preserved (e.g. "service does not exist"), not replaced by a generic message. Avoid `[Deprecated]`/`Internal` `Security.Services` properties (Rule #4): use `Enabled`, `Description`, `AutheEnabled`, `ClientSystems`; do NOT touch `Capabilities`/`AutheEnabledCapabilities`.

6. **AC 15.1.6 — Unit/integration tests.** `@iris-mcp/admin` tests: `list`, `get`, `enable`/`disable` round-trip (mocked HTTP), `set` settings application; AND the governance-default-disabled assertion (AC 15.1.2) — a real-runtime test exercising the actual gate, in the DEFAULT vitest suite (not `.integration.test.ts`).

7. **AC 15.1.7 — Frozen-foundation governance baseline (architecture decision, lead 2026-06-16).** `GOVERNANCE_BASELINE` remains the immutable Epic-14 foundation snapshot (141 keys, hash `1e62c5ad5bf7`) — `iris_service_manage`'s 5 keys are **NOT** added to it. The drift test in `packages/shared/src/__tests__/governance.test.ts` ("governance baseline drift check") is changed from bidirectional equality to **one-directional**: assert every committed foundation key still exists in the live derived surface (the `extra` / removed-foundation-key check is RETAINED — a vanished foundation key is still a real regression), but the `missing` assertion (live keys not in the committed baseline) is REPLACED with an explicit allowance + comment ("new post-foundation tool keys are expected outside the frozen baseline; they are governed by `mutates`+defaultSeed, not baseline membership"). The hash-self-consistency test (baseline ↔ `GOVERNANCE_BASELINE_HASH`) and the sorted-keys test are RETAINED unchanged. `governance-baseline.ts`'s header is updated from "regenerate after any tool change" to "FROZEN Epic-14 foundation — do NOT regenerate to add post-foundation tools." `scripts/gen-governance-baseline.mjs` gains a prominent note that it produced the frozen foundation and must not be re-run to grow the committed baseline (it may still be run to RE-VERIFY the foundation hash).

8. **AC 15.1.8 — Back-compat gate (Rule #19) + bootstrap regen (Option A).** With no `IRIS_PROFILES` and no `IRIS_GOVERNANCE`: every PRE-EXISTING tool/action behaves byte-for-byte as before; the 141 foundation keys all still resolve enabled; `GOVERNANCE_BASELINE_HASH` stays `1e62c5ad5bf7`. Full monorepo suite green; `tsc` strict + lint clean across `@iris-mcp/shared` and `@iris-mcp/admin`. **Because Story 15.1 edits bootstrapped classes, `bootstrap-classes.ts` IS regenerated via `pnpm run gen:bootstrap` (Rule #18 — never hand-edit the embedded file) and `BOOTSTRAP_VERSION` moves to the new on-disk content hash** (the bootstrap drift test requires this — deferring the regen while keeping the suite green is not possible). Record the new `BOOTSTRAP_VERSION` (from → to) in the story Completion notes; Story 15.6 does the FINAL regen/verification covering 15.2–15.5's ObjectScript too.

9. **AC 15.1.9 — Live verification.** The `ServiceList`/`ServiceManage` ObjectScript is deployed to live HSCUSTOM via `iris_doc_load` (glob-prefixed path, Rule #17) and compiled; a live `list` returns real services and a `get` on a known service (e.g. `%Service_CallIn`) returns its properties — captured as evidence in the lead smoke. (No destructive enable/disable against the live instance unless on a safe, restorable service.)

## Tasks / Subtasks

- [x] **Task 1 — Frozen-foundation governance model (AC 15.1.7)** — do this FIRST; it's the prerequisite for governing the new tool.
  - [x] Relax the `governance.test.ts` drift check to one-directional (retain `extra`/removed-foundation assertion + hash + sorted tests; replace the `missing` assertion with an explicit allowance + comment).
  - [x] Update `governance-baseline.ts` header comment (frozen foundation) and add the must-not-regenerate-to-grow note to `gen-governance-baseline.mjs`.
  - [x] Confirm `GOVERNANCE_BASELINE` stays 141 keys / hash `1e62c5ad5bf7` (unchanged).
- [x] **Task 2 — TypeScript tool (AC 15.1.1, 15.1.2, 15.1.4)** — mirror `packages/iris-admin-mcp/src/tools/role.ts`; single multi-action tool with the `mutates` record; wire `ctx.http`/`ctx.paginate`/`toStructured`; register in `index.ts`.
- [x] **Task 3 — ObjectScript handler (AC 15.1.3, 15.1.5)** — add `ServiceList` + `ServiceManage` to `src/ExecuteMCPv2/REST/Security.cls` (read `irissys/Security/Services.cls` first, Rule #2); add `/security/service` GET+POST routes to `src/ExecuteMCPv2/REST/Dispatch.cls`; namespace save/restore; `SanitizeError`.
- [x] **Task 4 — Tests (AC 15.1.6, 15.1.2)** — admin tool unit tests + the real-gate governance-default-disabled integration test (default suite).
- [x] **Task 5 — Deploy + verify (AC 15.1.9)** — `iris_doc_load` the `.cls` to HSCUSTOM (glob path), compile, live `list`/`get`.
- [x] **Task 6 — Back-compat proof (AC 15.1.8)** — full monorepo build/test/lint green; governance hash unchanged (`1e62c5ad5bf7`); `bootstrap-classes.ts` regenerated per Option A (`BOOTSTRAP_VERSION` 8f0cf75be984 → fae7cadc22fb).

### Review Findings (code review 2026-06-16)

Three reviewer layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor) ran. All 9 ACs audited SATISFIED. The two highest-severity correctness findings (single-`get` `enabled` always-false via `BooleanYN` coercion) were DISMISSED by live IRIS probe (Rule #14): `Security.Services.Get()` populates `tProps("Enabled")` with the LOGICAL value `0`/`1` — verified `%Service_Bindings`→`1`, `%Service_CallIn`→`0`, `AutheEnabled`→`48`/`32`. Only the `List` *query* projects the `Yes`/`No` display form, and the handler correctly reads `EnabledBoolean` there. No coercion bug exists.

Patches applied inline (auto-fixed):

- [x] [Review][Patch] `get` with empty/missing `name` silently listed all services — now rejected before the GET [packages/iris-admin-mcp/src/tools/service.ts] (+ 1 dev test, 1 QA-coverage test updated)
- [x] [Review][Patch] `set` with no/empty/unknown `settings` issued a no-op `Modify` reported as `success:true` — now rejected in the TS tool AND the ObjectScript handler (`'$Data(tProps)` guard, defense in depth) [packages/iris-admin-mcp/src/tools/service.ts, src/ExecuteMCPv2/REST/Security.cls:ServiceManage] (+ 2 dev tests)
- [x] [Review][Patch] required-`name` guard added for all write actions in the TS tool (was server-only) [packages/iris-admin-mcp/src/tools/service.ts] (+ 1 dev test)
- [x] [Review][Patch] stale Dev-Notes bootstrap line contradicting the resolved AC 15.1.8 (Option A) — reconciled [this story file]

Deferred (see deferred-work.md → Story 15.1):

- [x] [Review][Defer] `ServiceList` does not `tRS.Close()` on the in-loop exception path [src/ExecuteMCPv2/REST/Security.cls:ServiceList] — pre-existing pattern shared across all list methods; codebase-wide hardening pass
- [x] [Review][Defer] `ClientSystems` get→set round-trip format unverified (list-vs-string) [src/ExecuteMCPv2/REST/Security.cls] — needs a live safe-service round-trip; fold into Story 15.6 live verification

Post-fix verification: bootstrap regenerated (`BOOTSTRAP_VERSION` fae7cadc22fb → **d0cf367c3cfc**); updated `Security.cls` redeployed + compiled clean on live HSCUSTOM; governance hash unchanged **1e62c5ad5bf7** (141 keys, `iris_service_manage` absent); full monorepo build + test (shared 500/500, admin 255/255) + lint green.

## Dev Notes

- **`Security.Services` API (from `irissys/Security/Services.cls`):** `List` ROWSPEC ≈ `Name, Enabled, Public, Description, EnabledBoolean`. Writable props: `Name` (read-only after create), `Enabled` (BooleanYN), `Description`, `AutheEnabled` (bit-mask integer of auth methods), `ClientSystems` (list). `Get(name, .props)` / `Modify(name, .props)` (Kill `props` before populating; only set provided fields). `Exists(name, .svc, .sc)`. No password fields. AVOID `Capabilities`/`AutheEnabledCapabilities` (Internal — Rule #4).
- **`mutates` is wired for the FIRST time here** — `packages/shared/src/tool-types.ts` `mutates?: "read" | "write" | Record<string,"read"|"write">`. The Record form maps action→class; `buildMutatesLookup` produces `iris_service_manage:enable → write` etc. Story 15.0's registration assertion requires EVERY key classified (all 5), since none are in the frozen baseline.
- **No `server` field in the tool** (D2 — the framework injects + strips it). No two-tool split (epics.md mandates a single `iris_service_manage` with the action enum), unlike `role.ts`'s manage+list pattern.
- **Bootstrap:** deploy to live IRIS for testing via `iris_doc_load path="c:/git/iris-execute-mcp-v2/src/**/Security.cls" compile=true namespace=HSCUSTOM` (glob-prefixed, Rule #17). **[SUPERSEDED by the resolved AC 15.1.8, Option A — lead 2026-06-16]** This story DOES regenerate `bootstrap-classes.ts` (`pnpm run gen:bootstrap`, Rule #18) and `BOOTSTRAP_VERSION` moves to the new on-disk content hash, because the bootstrap drift test fails otherwise once `Security.cls`/`Dispatch.cls` change on disk. The version moves incrementally per ObjectScript-touching Epic-15 story; Story 15.6 is the FINAL consolidated regen + verification, not the sole bump. (The original "do NOT bump — 15.6 does the single bump" framing was the NFR tripwire the lead resolved; see Dev Agent Record → Debug Log.)
- **Frozen-foundation rationale (architecture decision):** the governance baseline's role is "the Epic-14 grandfather set," not "a live mirror of every tool." Drift detection still meaningfully guards against a FOUNDATION key disappearing; new tools are governed by `mutates`+`defaultSeed`. This decision should be recorded in `architecture.md` / an ADR during Story 15.6's docs rollup (routed). It governs all of Epics 15-17.
- **Dispatch route pattern (from `Dispatch.cls`):** `<Route Url="/security/service" Method="GET" Call="ExecuteMCPv2.REST.Security:ServiceList" />` + `Method="POST" ... :ServiceManage`.

## Dev Agent Record

### Debug Log

**2026-06-16 — NFR tripwire (skill-rules Rule 5): AC 15.1.8 self-conflict for a bootstrapped `.cls` edit. BLOCKER — awaiting lead decision.**

Tasks 1–5 are complete and verified:
- Task 1 (frozen-foundation governance) — `governance.test.ts` drift check relaxed to one-directional; `governance-baseline.ts` header + `gen-governance-baseline.mjs` note updated; baseline stays 141 keys / hash `1e62c5ad5bf7` (header prose only — no key/hash line changed). `governance.test.ts` 41/41 pass.
- Task 2 (`iris_service_manage` tool) — single multi-action tool, `mutates: {list:read,get:read,enable:write,disable:write,set:write}`, no `server` field, registered in `index.ts` (admin now 23 tools).
- Task 3 (ObjectScript) — `ServiceList`/`ServiceManage` on `Security.cls` + GET/POST `/security/service` Dispatch routes.
- Task 4 (tests) — `service.test.ts` (13) + `service-governance.test.ts` (4, the AC 15.1.2 AI#3 real-gate proof through `McpServerBase.handleToolCall`) + `index.test.ts` count bumps. All pass.
- Task 5 (live verify) — deployed `Security.cls`/`Dispatch.cls` to HSCUSTOM (compiled clean); live `Security.Services:List` returns 17 real services and `Security.Services.Get("%Service_CallIn")` returns `{enabled:false, description:"Controls the Call-In Interface", autheEnabled:48, clientSystems:""}`. Temp probe class created on disk + IRIS, then deleted from both.

Monorepo `build` ✅ and `lint` ✅ are fully green. The ONLY failures are **two `bootstrap.test.ts` drift tests**:
- `embedded class contents match disk .cls files`
- `BOOTSTRAP_VERSION matches SHA-256 hash of concatenated disk contents` (committed `8f0cf75be984` vs disk-derived `fae7cadc22fb`).

> **RESOLVED — lead chose Option A (2026-06-16).** Regenerated `bootstrap-classes.ts` via `pnpm run gen:bootstrap` (Rule #18 — never hand-edit). `BOOTSTRAP_VERSION` moved **`8f0cf75be984` → `fae7cadc22fb`** (the new on-disk content hash). Both bootstrap drift tests now pass; full monorepo build/test/lint green; governance frozen-foundation hash UNCHANGED at `1e62c5ad5bf7` (a separate artifact, untouched by the bootstrap regen). The "one bump at 15.6" framing is reinterpreted: the version moves incrementally per ObjectScript-touching story; 15.6 is the final consolidated regen + verification + docs. (My earlier note inverted the from→to; the committed-before value was `8f0cf75be984`.)

**Root cause — AC 15.1.8 contains two mutually-exclusive requirements for this story:**
1. "Full monorepo suite green."
2. "No `BOOTSTRAP_VERSION` bump; `bootstrap-classes.ts` not regenerated (deferred to 15.6)."

`bootstrap.test.ts` mechanically asserts on-disk `Security.cls`/`Dispatch.cls` are byte-identical to the embedded `bootstrap-classes.ts`, and that `BOOTSTRAP_VERSION` equals the SHA-256 of the current disk contents. Task 3 (AC 15.1.3, in-scope and required) edits both `.cls` files on disk. The moment a bootstrapped `.cls` is edited, the embedded copy and the version hash are stale — and the embedded content cannot be refreshed without ALSO changing `BOOTSTRAP_VERSION` (the version IS the content hash). So "edit a bootstrapped `.cls` + don't regenerate `bootstrap-classes.ts` + keep the suite green" is impossible. The story's bootstrap-deferral note (Dev Notes / AC 15.1.9) did not account for the drift test (Rule #16 — a spec assumption that doesn't hold against the real test surface).

Per Rule 5, the tripwire was escalated to the lead rather than worked around in code. **The lead chose Option A and amended AC 15.1.8 + the Context bootstrap-policy paragraph in place.** Resolution applied above (regenerate, version moved `8f0cf75be984` → `fae7cadc22fb`).

### Completion Notes

All 9 ACs satisfied; all 6 tasks complete.

- **AC 15.1.1 / 15.1.4 — tool surface + I/O.** `iris_service_manage` in `@iris-mcp/admin` (`packages/iris-admin-mcp/src/tools/service.ts`): single multi-action tool, bare `action: z.enum(["list","get","enable","disable","set"])`, `annotations.readOnlyHint:false`, no `server` field (framework injects), registered in `tools/index.ts` (admin 22 → 23 tools). `list`→GET (paginated), `get`→GET `?name=`, `enable`/`disable`/`set`→POST `{action,name[,settings]}`; returns `{content:[text], structuredContent}`.
- **AC 15.1.2 — governance classification (AI#3).** `mutates: {list:read, get:read, enable:write, disable:write, set:write}`. `service-governance.test.ts` drives the REAL `McpServerBase.handleToolCall` gate: under empty `IRIS_GOVERNANCE`, `enable`/`disable`/`set` return structured `{code:"GOVERNANCE_DISABLED", action:"iris_service_manage:<action>", server:"default"}` with the handler NOT invoked; `list` is allowed; an explicit `IRIS_GOVERNANCE` global enable of `iris_service_manage:enable` flips that one key to allowed while `disable` stays denied (per-action granularity). Default vitest suite (not `.integration.test.ts`).
- **AC 15.1.3 / 15.1.5 — ObjectScript.** `ServiceList` + `ServiceManage` on `ExecuteMCPv2.REST.Security`; namespace save/restore via `Set tOrigNS=$NAMESPACE` / `Set $NAMESPACE="%SYS"` / restore (never `New $NAMESPACE`; catch restores NS first line); `SanitizeError` for all error paths (Rule #9). Reads/writes only `Enabled`, `Description`, `AutheEnabled`, `ClientSystems` — avoids the Internal `Capabilities`/`AutheEnabledCapabilities` (Rule #4). GET+POST `/security/service` routes added to `Dispatch.cls`.
- **AC 15.1.6 — tests.** `service.test.ts` (13) covers list/get/enable/disable/set + error propagation + metadata; `service-governance.test.ts` (4) is the real-gate proof; `index.test.ts` counts bumped 22→23.
- **AC 15.1.7 — frozen-foundation governance.** `governance.test.ts` drift check made one-directional (retain vanished-foundation-key + hash-self-consistency + sorted tests; replace the `missing` assertion with an explicit allowance for post-foundation keys). `governance-baseline.ts` header → "FROZEN Epic-14 foundation — do NOT regenerate to grow"; `gen-governance-baseline.mjs` gains a prominent frozen-foundation note. `GOVERNANCE_BASELINE` unchanged: 141 keys, hash `1e62c5ad5bf7`.
- **AC 15.1.8 — back-compat + bootstrap (Option A).** No `IRIS_PROFILES`/`IRIS_GOVERNANCE` ⇒ pre-existing tools byte-for-byte; 141 foundation keys all enabled; governance hash stays `1e62c5ad5bf7`. `bootstrap-classes.ts` regenerated via `pnpm run gen:bootstrap`; **`BOOTSTRAP_VERSION`: `8f0cf75be984` → `fae7cadc22fb`.** Full monorepo build ✅ / test ✅ (shared 500/500) / lint ✅.
- **AC 15.1.9 — live verification.** Deployed `Security.cls`/`Dispatch.cls` to live HSCUSTOM via `iris_doc_load` (glob-prefixed, Rule #17), compiled clean. Live `Security.Services:List` returns 17 real services; `Security.Services.Get("%Service_CallIn")` → `{enabled:false, description:"Controls the Call-In Interface", autheEnabled:48, clientSystems:""}`. No destructive enable/disable run. A temp `ExecuteMCPv2.Temp.ServiceProbe` probe (exercising the handler's exact API path) was created on disk + IRIS then deleted from both.

### File List

New:
- `packages/iris-admin-mcp/src/tools/service.ts`
- `packages/iris-admin-mcp/src/__tests__/service.test.ts`
- `packages/iris-admin-mcp/src/__tests__/service-governance.test.ts`

Modified:
- `packages/iris-admin-mcp/src/tools/index.ts`
- `packages/iris-admin-mcp/src/__tests__/index.test.ts`
- `packages/shared/src/__tests__/governance.test.ts`
- `packages/shared/src/governance-baseline.ts` (header comment only; keys + hash unchanged)
- `packages/shared/src/bootstrap-classes.ts` (regenerated; `BOOTSTRAP_VERSION` 8f0cf75be984 → fae7cadc22fb)
- `scripts/gen-governance-baseline.mjs`
- `src/ExecuteMCPv2/REST/Security.cls`
- `src/ExecuteMCPv2/REST/Dispatch.cls`

## Change Log

| Date | Change |
|---|---|
| 2026-06-16 | Story 15.1 authored. First governed write tool (`iris_service_manage`, actions list/get/enable/disable/set). Architectural decision baked in (AC 15.1.7): frozen-foundation governance baseline + one-directional drift test (lead, resolving the new-tool-vs-baseline contradiction; user confirmed frozen-foundation). Per-action `mutates` (writes default-disabled, AI#3 verification). ObjectScript `ServiceList`/`ServiceManage` on `Security.cls` + Dispatch route; no BOOTSTRAP_VERSION bump (→15.6). |
| 2026-06-16 | Dev: Tasks 1–5 implemented + verified (governance frozen-foundation, tool, ObjectScript, tests, live HSCUSTOM verify). Task 6 surfaced an NFR tripwire (Rule 5): AC 15.1.8 self-conflicts for a bootstrapped `.cls` edit — "suite green" vs "no bootstrap-classes.ts regen / no version bump" cannot both hold once `Security.cls`/`Dispatch.cls` change on disk. Halted for lead decision; see Dev Agent Record → Debug Log. |
| 2026-06-16 | Lead resolved the tripwire (Option A): AC 15.1.8 + Context bootstrap-policy paragraph amended in place. Dev completed Task 6 — regenerated `bootstrap-classes.ts` (`BOOTSTRAP_VERSION` 8f0cf75be984 → fae7cadc22fb); full monorepo build/test/lint green (shared 500/500; admin service.test 13 + service-governance 4); governance frozen-foundation hash unchanged at `1e62c5ad5bf7`. All 9 ACs + 6 tasks complete. Status → review. |
